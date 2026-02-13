// mp-ui.js — Multiplayer UI Overlay Manager
// Creates and manages HTML overlay on top of C3 canvas

const MPUI = {
  _el: null,
  _pingUpdateInterval: null,

  init() {
    this._createOverlay();
    this._setupAutoShow();
    this._checkURLJoin();
  },

  _createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'mp-overlay';
    overlay.innerHTML = `
      <!-- Play Online button (shown on menu) -->
      <button id="mp-play-btn">Play Online</button>

      <!-- Back button -->
      <button id="mp-back-btn">Back</button>

      <!-- Connection status -->
      <div id="mp-status">
        <span id="mp-status-dot"></span>
        <span id="mp-status-text">Offline</span>
        <span id="mp-ping"></span>
      </div>

      <!-- Lobby panel -->
      <div id="mp-lobby">
        <h2>Online Play</h2>
        <div class="mp-lobby-buttons" id="mp-lobby-main">
          <button class="mp-btn mp-btn-primary" id="mp-create-btn">Create Room</button>
          <button class="mp-btn" id="mp-join-btn">Join Room</button>
        </div>

        <!-- Join section -->
        <div id="mp-join-section">
          <input type="text" id="mp-join-input" placeholder="CODE" maxlength="6" autocomplete="off" />
          <button class="mp-btn mp-btn-primary" id="mp-join-confirm">Join</button>
        </div>

        <!-- Room info (after creating) -->
        <div id="mp-room-info">
          <p>Room Code:</p>
          <div id="mp-room-code"></div>
          <p id="mp-room-status">Waiting for opponent...</p>
          <button class="mp-btn" id="mp-copy-link">Copy Link</button>
        </div>
      </div>

      <!-- Disconnect modal -->
      <div id="mp-disconnect">
        <div id="mp-disconnect-box">
          <h3>Disconnected</h3>
          <p>Your opponent has left the game.</p>
          <button class="mp-btn" id="mp-disconnect-ok">Back to Menu</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._el = overlay;
    this._bindEvents();
  },

  // --- Block/unblock game canvas ---
  // When lobby is open, block ALL interaction with the game behind it
  _blockGame() {
    this._el.classList.add('mp-blocking');
    // Freeze the game by setting pause
    if (MPRuntime._ready) {
      MPRuntime.setVar('pause', 1);
    }
  },

  _unblockGame() {
    this._el.classList.remove('mp-blocking');
    if (MPRuntime._ready) {
      MPRuntime.setVar('pause', 0);
    }
  },

  // Programmatically start a 2-player game match
  // Replicates what happens when the user clicks startButton2
  _triggerGameStart() {
    if (!MPRuntime._ready) return;

    // Set 2P mode
    MPRuntime.cpu = 0;

    // Trigger game start (menu=5 transitions from menu to gameplay)
    MPRuntime.setVar('menu', 5);

    // Initialize game state after a short delay (game needs time to transition)
    setTimeout(() => {
      MPRuntime.setVar('goal', 4);
      MPRuntime.setVar('p1Score', 0);
      MPRuntime.setVar('p2Score', 0);
      MPRuntime.setVar('P1Control', 4); // 4 = released
      MPRuntime.setVar('P2Control', 4);
      MPRuntime.setVar('pause', 0); // Unpause
    }, 200);
  },

  _bindEvents() {
    // Play Online button
    document.getElementById('mp-play-btn').addEventListener('click', () => {
      this.showLobby();
    });

    // Back button
    document.getElementById('mp-back-btn').addEventListener('click', () => {
      this.hideLobby();
      this._unblockGame();
      MPGame.stop();
    });

    // Create Room
    document.getElementById('mp-create-btn').addEventListener('click', async () => {
      const btn = document.getElementById('mp-create-btn');
      btn.disabled = true;
      btn.textContent = 'Creating...';

      try {
        const code = await MPNetwork.createRoom();
        this._showRoomCreated(code);

        MPNetwork.onConnect(() => {
          this._onOpponentConnected();
        });

        MPNetwork.onDisconnect(() => {
          this.showDisconnect();
        });
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Create Room';
        alert('Failed to create room: ' + e.message);
      }
    });

    // Join Room
    document.getElementById('mp-join-btn').addEventListener('click', () => {
      document.getElementById('mp-lobby-main').style.display = 'none';
      document.getElementById('mp-join-section').style.display = 'block';
      document.getElementById('mp-join-input').focus();
    });

    // Join Confirm
    document.getElementById('mp-join-confirm').addEventListener('click', () => {
      this._doJoin();
    });

    // Enter key in join input
    document.getElementById('mp-join-input').addEventListener('keydown', (e) => {
      if (e.keyCode === 13) this._doJoin();
    });

    // Copy Link
    document.getElementById('mp-copy-link').addEventListener('click', () => {
      const link = MPNetwork.getShareLink();
      navigator.clipboard.writeText(link).then(() => {
        const btn = document.getElementById('mp-copy-link');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy Link'; }, 2000);
      }).catch(() => {
        prompt('Copy this link:', link);
      });
    });

    // Disconnect OK
    document.getElementById('mp-disconnect-ok').addEventListener('click', () => {
      this.hideDisconnect();
      this.hideLobby();
      this._unblockGame();
      MPGame.stop();
      window.location.hash = '';
      window.location.reload();
    });
  },

  async _doJoin() {
    const input = document.getElementById('mp-join-input');
    const code = input.value.trim().toUpperCase();
    if (!code || code.length < 4) {
      input.style.borderColor = '#f44336';
      return;
    }

    const btn = document.getElementById('mp-join-confirm');
    btn.disabled = true;
    btn.textContent = 'Joining...';
    this._showStatus('connecting');

    try {
      await MPNetwork.joinRoom(code);
      // Connected! Hide lobby, start game, start client mode
      this.hideLobby();
      this._showStatus('connected');
      this._startPingDisplay();

      MPNetwork.onDisconnect(() => {
        this.showDisconnect();
      });

      // Start as client — trigger game start then begin syncing
      MPRuntime.onReady(() => {
        this._triggerGameStart();
        // Small delay to let game initialize, then start client sync
        setTimeout(() => {
          this._unblockGame();
          MPGame.startAsClient();
        }, 500);
      });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Join';
      this._showStatus('disconnected');
      alert('Could not join room: ' + e.message);
    }
  },

  _showRoomCreated(code) {
    document.getElementById('mp-lobby-main').style.display = 'none';
    document.getElementById('mp-join-section').style.display = 'none';
    document.getElementById('mp-room-info').style.display = 'block';
    document.getElementById('mp-room-code').textContent = code;
    document.getElementById('mp-room-status').textContent = 'Waiting for opponent...';
    this._showStatus('connecting');
    document.getElementById('mp-back-btn').style.display = 'block';
  },

  _onOpponentConnected() {
    document.getElementById('mp-room-status').textContent = 'Opponent connected!';
    this._showStatus('connected');
    this._startPingDisplay();

    // Wait a moment, then start the actual 2P game
    setTimeout(() => {
      this.hideLobby();
      MPRuntime.onReady(() => {
        // Trigger the game start sequence (same as clicking 2P button)
        this._triggerGameStart();
        // Small delay to let game initialize, then start host sync
        setTimeout(() => {
          this._unblockGame();
          MPGame.startAsHost();
        }, 500);
      });
    }, 1000);
  },

  // --- Show/Hide ---

  showPlayButton() {
    document.getElementById('mp-play-btn').style.display = 'block';
  },

  hidePlayButton() {
    document.getElementById('mp-play-btn').style.display = 'none';
  },

  showLobby() {
    this.hidePlayButton();
    this._blockGame(); // Freeze game + block canvas
    document.getElementById('mp-lobby').style.display = 'block';
    document.getElementById('mp-lobby-main').style.display = 'flex';
    document.getElementById('mp-join-section').style.display = 'none';
    document.getElementById('mp-room-info').style.display = 'none';
    document.getElementById('mp-back-btn').style.display = 'block';

    // Reset buttons
    const createBtn = document.getElementById('mp-create-btn');
    createBtn.disabled = false;
    createBtn.textContent = 'Create Room';

    const joinBtn = document.getElementById('mp-join-confirm');
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join';
  },

  hideLobby() {
    document.getElementById('mp-lobby').style.display = 'none';
    document.getElementById('mp-back-btn').style.display = 'none';
  },

  showDisconnect() {
    document.getElementById('mp-disconnect').style.display = 'flex';
    this._el.classList.add('mp-blocking'); // Block game behind disconnect modal
    this._showStatus('disconnected');
    this._stopPingDisplay();
  },

  hideDisconnect() {
    document.getElementById('mp-disconnect').style.display = 'none';
  },

  _showStatus(state) {
    const statusEl = document.getElementById('mp-status');
    const dotEl = document.getElementById('mp-status-dot');
    const textEl = document.getElementById('mp-status-text');

    statusEl.style.display = 'block';
    dotEl.className = state;

    switch (state) {
      case 'connected': textEl.textContent = 'Online'; break;
      case 'connecting': textEl.textContent = 'Connecting'; break;
      case 'disconnected': textEl.textContent = 'Offline'; break;
    }
  },

  _startPingDisplay() {
    this._pingUpdateInterval = setInterval(() => {
      const pingEl = document.getElementById('mp-ping');
      if (MPNetwork.latency > 0) {
        pingEl.textContent = MPNetwork.latency + 'ms';
      }
    }, 1000);
  },

  _stopPingDisplay() {
    if (this._pingUpdateInterval) {
      clearInterval(this._pingUpdateInterval);
      this._pingUpdateInterval = null;
    }
  },

  // Auto-show the Play Online button when menu is visible
  _setupAutoShow() {
    MPRuntime.onReady(() => {
      // Show button after a short delay (let the game load)
      setTimeout(() => {
        this.showPlayButton();
      }, 500);

      // Periodically check if we're on menu and show/hide button
      setInterval(() => {
        const menu = MPRuntime.menu;
        if (menu !== 5 && MPGame.mode === null) {
          // Menu is showing (not in-game)
          document.getElementById('mp-play-btn').style.display = 'block';
        } else if (MPGame.mode !== null) {
          // In multiplayer game — hide play button
          document.getElementById('mp-play-btn').style.display = 'none';
        }
      }, 500);
    });
  },

  // Check URL for auto-join
  _checkURLJoin() {
    const code = MPNetwork.getRoomFromURL();
    if (code) {
      console.log('[MP-UI] Auto-joining room from URL:', code);
      MPRuntime.onReady(() => {
        setTimeout(() => {
          this.showLobby(); // This will block the game
          document.getElementById('mp-join-input').value = code;
          this._doJoin();
        }, 1500);
      });
    }
  },
};

window.MPUI = MPUI;
