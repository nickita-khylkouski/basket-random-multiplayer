// mp-network.js — PeerJS Networking Layer
// Handles P2P connection, room codes, and data exchange

const MPNetwork = {
  peer: null,
  conn: null,
  isHost: false,
  isConnected: false,
  roomCode: '',
  _onDataCallback: null,
  _onConnectCallback: null,
  _onDisconnectCallback: null,
  _onErrorCallback: null,
  _pingInterval: null,
  _lastPingTime: 0,
  latency: 0,

  // PeerJS server config - use local server if available, else cloud
  _peerConfig: null,

  _getPeerOptions() {
    const opts = {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          // Free TURN relay for NAT traversal
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
        ]
      },
      debug: 1 // 0=none, 1=errors, 2=warnings, 3=all
    };

    // Check if local PeerJS server is available (set via mp-config or auto-detect)
    if (this._peerConfig) {
      opts.host = this._peerConfig.host;
      opts.port = this._peerConfig.port;
      opts.path = this._peerConfig.path || '/';
      opts.secure = this._peerConfig.secure || false;
    }

    return opts;
  },

  // Configure to use a custom PeerJS server
  setServer(host, port, path, secure) {
    this._peerConfig = { host, port, path: path || '/', secure: secure || false };
  },

  // Generate a random 6-char room code
  _generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  },

  // Create a room as host
  createRoom() {
    return new Promise((resolve, reject) => {
      this.roomCode = this._generateCode();
      const peerId = 'basket-rnd-' + this.roomCode;
      this.isHost = true;

      this.peer = new Peer(peerId, this._getPeerOptions());

      this.peer.on('open', (id) => {
        console.log('[MP-Net] Host room created:', this.roomCode);
        resolve(this.roomCode);
      });

      this.peer.on('connection', (conn) => {
        console.log('[MP-Net] Incoming connection from client');
        this.conn = conn;
        this._setupConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('[MP-Net] Peer error:', err.type, err.message || err);
        if (err.type === 'unavailable-id') {
          // Room code collision - try again
          this.destroy();
          this.createRoom().then(resolve).catch(reject);
        } else {
          if (this._onErrorCallback) this._onErrorCallback(err);
          reject(err);
        }
      });

      this.peer.on('disconnected', () => {
        console.warn('[MP-Net] Disconnected from signaling server');
      });
    });
  },

  // Join an existing room as client
  joinRoom(code) {
    return new Promise((resolve, reject) => {
      this.roomCode = code.toUpperCase().trim();
      const peerId = 'basket-rnd-' + this.roomCode;
      this.isHost = false;

      // Generate a unique client ID
      const clientId = 'basket-cli-' + this.roomCode + '-' + Math.random().toString(36).substr(2, 4);

      this.peer = new Peer(clientId, this._getPeerOptions());

      let resolved = false;

      this.peer.on('open', () => {
        console.log('[MP-Net] Client registered, connecting to room:', this.roomCode);
        const conn = this.peer.connect(peerId, {
          reliable: true,
          serialization: 'json'
        });
        this.conn = conn;

        this._setupConnection(conn, () => {
          // Called when connection is established
          if (!resolved) {
            resolved = true;
            resolve(this.roomCode);
          }
        });
      });

      this.peer.on('error', (err) => {
        console.error('[MP-Net] Peer error:', err.type, err.message || err);
        if (this._onErrorCallback) this._onErrorCallback(err);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Connection timeout'));
        }
      }, 15000);
    });
  },

  _setupConnection(conn, onOpenCallback) {
    // Check if already open (can happen with fast connections)
    if (conn.open) {
      console.log('[MP-Net] Connection already open!');
      this.isConnected = true;
      if (this._onConnectCallback) this._onConnectCallback();
      if (onOpenCallback) onOpenCallback();
      this._startPing();
    }

    conn.on('open', () => {
      this.isConnected = true;
      console.log('[MP-Net] Connection established! (DataChannel open)');
      if (this._onConnectCallback) this._onConnectCallback();
      if (onOpenCallback) onOpenCallback();
      this._startPing();
    });

    conn.on('data', (data) => {
      // Handle ping/pong
      if (data && data._ping) {
        this.send({ _pong: data._ping });
        return;
      }
      if (data && data._pong) {
        this.latency = Date.now() - data._pong;
        return;
      }
      if (this._onDataCallback) this._onDataCallback(data);
    });

    conn.on('close', () => {
      this.isConnected = false;
      console.log('[MP-Net] Connection closed');
      this._stopPing();
      if (this._onDisconnectCallback) this._onDisconnectCallback();
    });

    conn.on('error', (err) => {
      console.error('[MP-Net] Connection error:', err);
      if (this._onErrorCallback) this._onErrorCallback(err);
    });

    // Log ICE connection state changes for debugging
    if (conn.peerConnection) {
      conn.peerConnection.oniceconnectionstatechange = () => {
        console.log('[MP-Net] ICE state:', conn.peerConnection.iceConnectionState);
      };
    }
  },

  // Send data to the other peer
  send(data) {
    if (this.conn && this.conn.open) {
      try {
        this.conn.send(data);
      } catch (e) {
        console.warn('[MP-Net] Send failed:', e);
      }
    }
  },

  // Ping measurement
  _startPing() {
    this._pingInterval = setInterval(() => {
      if (this.isConnected) {
        this.send({ _ping: Date.now() });
      }
    }, 2000);
  },

  _stopPing() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  },

  // Event handlers
  onData(cb) { this._onDataCallback = cb; },
  onConnect(cb) { this._onConnectCallback = cb; },
  onDisconnect(cb) { this._onDisconnectCallback = cb; },
  onError(cb) { this._onErrorCallback = cb; },

  // Get share link
  getShareLink() {
    const url = new URL(window.location.href);
    url.hash = this.roomCode;
    return url.toString();
  },

  // Check if URL has a room code
  getRoomFromURL() {
    const hash = window.location.hash.replace('#', '').trim();
    if (hash && hash.length >= 4 && hash.length <= 8) {
      return hash.toUpperCase();
    }
    return null;
  },

  // Clean up
  destroy() {
    this._stopPing();
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.isConnected = false;
    this.isHost = false;
    this.roomCode = '';
  }
};

window.MPNetwork = MPNetwork;
