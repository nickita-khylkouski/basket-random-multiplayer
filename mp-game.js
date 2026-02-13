// mp-game.js — Host/Client Game Logic
// Orchestrates multiplayer: host sends state, client sends input

const MPGame = {
  mode: null, // 'host', 'client', or null (local)
  _syncInterval: null,
  _inputState: false, // current local key state
  _remoteInputState: false, // received from remote
  _lastGoal: 0,
  _lastRoundConfig: null,
  SYNC_RATE: 33, // ~30 Hz state sync

  // Start multiplayer game as host
  startAsHost() {
    this.mode = 'host';
    console.log('[MP-Game] Starting as HOST');

    // Disable CPU (we want 2P mode)
    MPRuntime.onReady(() => {
      MPRuntime.cpu = 0;
    });

    // Listen for client input
    MPNetwork.onData((data) => {
      this._handleHostData(data);
    });

    MPNetwork.onDisconnect(() => {
      this.stop();
      MPUI.showDisconnect();
    });

    // Start sending state at 30Hz
    this._syncInterval = setInterval(() => {
      this._hostTick();
    }, this.SYNC_RATE);

    // Listen for local P1 input (host is always P1)
    this._setupHostInput();
  },

  // Start multiplayer game as client
  startAsClient() {
    this.mode = 'client';
    console.log('[MP-Game] Starting as CLIENT');

    MPRuntime.onReady(() => {
      // Disable CPU
      MPRuntime.cpu = 0;
    });

    // Listen for host state
    MPNetwork.onData((data) => {
      this._handleClientData(data);
    });

    MPNetwork.onDisconnect(() => {
      this.stop();
      MPUI.showDisconnect();
    });

    // Setup client input (client controls P2 via W key locally, sends to host)
    this._setupClientInput();

    // Client-side rendering loop for interpolation
    this._startClientRender();
  },

  // --- HOST LOGIC ---

  _hostTick() {
    if (!MPRuntime._ready || !MPNetwork.isConnected) return;

    // Apply remote input to P2Control
    MPRuntime.p2Control = this._remoteInputState ? 5 : 4;

    // Get full game state
    const state = MPRuntime.getFullState();
    if (!state) return;

    // Send state as JSON (PeerJS handles serialization)
    // Using JSON mode because PeerJS DataChannel may not support raw ArrayBuffer well
    MPNetwork.send({ type: 'state', data: state });

    // Check for round changes (goal scored)
    const currentGoal = MPRuntime.goal;
    if (currentGoal !== this._lastGoal) {
      this._lastGoal = currentGoal;
      // Send round config when a new round starts
      if (currentGoal === 0 || currentGoal === 4) {
        const cfg = MPRuntime.getRoundConfig();
        if (JSON.stringify(cfg) !== JSON.stringify(this._lastRoundConfig)) {
          this._lastRoundConfig = cfg;
          MPNetwork.send({ type: 'roundConfig', data: cfg });
        }
      }
    }
  },

  _handleHostData(rawData) {
    // Process message
    const msg = this._parseMessage(rawData);
    if (!msg) return;

    if (msg.type === 'input') {
      this._remoteInputState = msg.data.pressed;
    }
  },

  _setupHostInput() {
    // Host plays as P1 (Up Arrow) - this already works natively
    // Nothing extra needed - the game handles P1 input via Keyboard plugin
  },

  // --- CLIENT LOGIC ---

  _handleClientData(rawData) {
    const msg = this._parseMessage(rawData);
    if (!msg) return;

    if (msg.type === 'state' && msg.data) {
      // Push to interpolation buffer
      MPSync.pushState(msg.data);

      // Apply variable state immediately (scores, etc)
      if (msg.data.vars) {
        // We only apply scores visually, don't fight the local engine
      }
    }

    if (msg.type === 'roundConfig' && msg.data) {
      MPRuntime.applyRoundConfig(msg.data);
    }
  },

  _setupClientInput() {
    // Client controls with W key (same as P2 locally)
    // But we need to ALSO send input to host
    let lastSent = false;

    const checkInput = () => {
      if (this.mode !== 'client') return;

      // Check both W key (87) and Up Arrow (38) for client convenience
      const pressed = this._inputState;

      if (pressed !== lastSent) {
        lastSent = pressed;
        MPNetwork.send({ type: 'input', data: { pressed } });
      }

      requestAnimationFrame(checkInput);
    };

    // Track W key AND Up Arrow for client
    document.addEventListener('keydown', (e) => {
      if (this.mode !== 'client') return;
      if (e.keyCode === 87 || e.keyCode === 38) { // W or Up Arrow
        this._inputState = true;
      }
    });

    document.addEventListener('keyup', (e) => {
      if (this.mode !== 'client') return;
      if (e.keyCode === 87 || e.keyCode === 38) {
        this._inputState = false;
      }
    });

    // Touch support for mobile
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener('touchstart', (e) => {
        if (this.mode !== 'client') return;
        this._inputState = true;
      });
      canvas.addEventListener('touchend', (e) => {
        if (this.mode !== 'client') return;
        this._inputState = false;
      });
    }

    requestAnimationFrame(checkInput);
  },

  _startClientRender() {
    const render = () => {
      if (this.mode !== 'client') return;

      // Get interpolated state from buffer
      const state = MPSync.getInterpolatedState();
      if (state) {
        MPRuntime.applyFullState(state);
      }

      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  },

  // --- SHARED ---

  _parseMessage(rawData) {
    // Handle pre-parsed objects (PeerJS auto-deserializes)
    if (rawData && typeof rawData === 'object') {
      if (rawData.type && rawData.data) {
        return rawData;
      }
    }
    // Try MPSync message router
    return MPSync.unpackMessage(rawData);
  },

  stop() {
    this.mode = null;
    this._inputState = false;
    this._remoteInputState = false;

    if (this._syncInterval) {
      clearInterval(this._syncInterval);
      this._syncInterval = null;
    }

    MPSync.clearBuffer();
    MPNetwork.destroy();
    console.log('[MP-Game] Multiplayer stopped');
  },
};

window.MPGame = MPGame;
