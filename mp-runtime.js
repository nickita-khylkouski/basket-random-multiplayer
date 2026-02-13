// mp-runtime.js — Construct 3 Runtime Hooking Layer
// Provides read/write access to game variables and physics state

const MPRuntime = {
  _runtime: null,
  _ready: false,
  _readyCallbacks: [],

  // Wait for C3 runtime to be available
  init() {
    const check = () => {
      try {
        const ri = window.c3_runtimeInterface;
        if (ri && ri._localRuntime) {
          const lr = ri._localRuntime;
          // The scripting runtime (IRuntime) is on _iRuntime
          if (lr._iRuntime && lr._iRuntime.globalVars) {
            this._runtime = lr._iRuntime;
            this._ready = true;
            console.log('[MP] C3 runtime hooked successfully');
            console.log('[MP] Global vars available:', Object.keys(this._runtime.globalVars));
            this._readyCallbacks.forEach(cb => cb());
            this._readyCallbacks = [];
            return;
          }
        }
      } catch (e) { /* not ready yet */ }
      setTimeout(check, 100);
    };
    check();
  },

  onReady(cb) {
    if (this._ready) cb();
    else this._readyCallbacks.push(cb);
  },

  // --- Global Variable Access ---

  getVar(name) {
    if (!this._ready) return undefined;
    return this._runtime.globalVars[name];
  },

  setVar(name, value) {
    if (!this._ready) return;
    this._runtime.globalVars[name] = value;
  },

  // Convenience getters/setters
  get p1Control() { return this.getVar('P1Control'); },
  set p1Control(v) { this.setVar('P1Control', v); },

  get p2Control() { return this.getVar('P2Control'); },
  set p2Control(v) { this.setVar('P2Control', v); },

  get cpu() { return this.getVar('CPU'); },
  set cpu(v) { this.setVar('CPU', v); },

  get p1Score() { return this.getVar('p1Score'); },
  get p2Score() { return this.getVar('p2Score'); },

  get goal() { return this.getVar('goal'); },
  get pause() { return this.getVar('pause'); },
  get menu() { return this.getVar('menu'); },

  // Round config
  get rndBall() { return this.getVar('rndBall'); },
  set rndBall(v) { this.setVar('rndBall', v); },
  get rndPlace() { return this.getVar('rndPlace'); },
  set rndPlace(v) { this.setVar('rndPlace', v); },
  get rndChar() { return this.getVar('rndChar'); },
  set rndChar(v) { this.setVar('rndChar', v); },
  get rndGoal() { return this.getVar('rndGoal'); },
  set rndGoal(v) { this.setVar('rndGoal', v); },
  get rndArm() { return this.getVar('rndArm'); },
  set rndArm(v) { this.setVar('rndArm', v); },

  // --- Object Instance Access ---

  _getObj(name) {
    if (!this._ready) return null;
    try {
      return this._runtime.objects[name];
    } catch (e) {
      return null;
    }
  },

  _getFirst(name) {
    const obj = this._getObj(name);
    if (!obj) return null;
    return obj.getFirstInstance();
  },

  _getAll(name) {
    const obj = this._getObj(name);
    if (!obj) return [];
    return obj.getAllInstances();
  },

  // Read position/angle of a named object's first instance
  getBodyState(name) {
    const inst = this._getFirst(name);
    if (!inst) return null;
    return {
      x: inst.x,
      y: inst.y,
      angle: inst.angle
    };
  },

  // Write position/angle to a named object's first instance
  setBodyState(name, state) {
    const inst = this._getFirst(name);
    if (!inst) return;
    if (state.x !== undefined) inst.x = state.x;
    if (state.y !== undefined) inst.y = state.y;
    if (state.angle !== undefined) inst.angle = state.angle;
  },

  // --- Full Game State Snapshot ---

  // Bodies we track for multiplayer sync
  SYNC_BODIES: ['body', 'body2', 'body3', 'body4'],
  SYNC_BALLS: ['heavyBall', 'normalBall', 'kamesBall', 'smallBall'],
  SYNC_EXTRAS: ['head', 'head2', 'head3', 'head4', 'arm', 'arm2', 'arm3', 'arm4'],

  // Get full state snapshot for network sync
  getFullState() {
    if (!this._ready) return null;

    const state = {
      vars: {
        p1Score: this.p1Score,
        p2Score: this.p2Score,
        goal: this.goal,
        pause: this.pause,
        menu: this.menu,
      },
      bodies: {},
      t: Date.now()
    };

    // Sync main bodies
    for (const name of this.SYNC_BODIES) {
      const s = this.getBodyState(name);
      if (s) state.bodies[name] = s;
    }

    // Sync active ball (only one is active at a time)
    for (const name of this.SYNC_BALLS) {
      const s = this.getBodyState(name);
      if (s) state.bodies[name] = s;
    }

    // Sync heads and arms
    for (const name of this.SYNC_EXTRAS) {
      const s = this.getBodyState(name);
      if (s) state.bodies[name] = s;
    }

    return state;
  },

  // Apply received state (client mode)
  applyFullState(state) {
    if (!this._ready || !state) return;

    // Apply body positions
    if (state.bodies) {
      for (const [name, bodyState] of Object.entries(state.bodies)) {
        this.setBodyState(name, bodyState);
      }
    }
  },

  // Get round config to send at round start
  getRoundConfig() {
    return {
      rndBall: this.rndBall,
      rndPlace: this.rndPlace,
      rndChar: this.rndChar,
      rndGoal: this.rndGoal,
      rndArm: this.rndArm,
    };
  },

  applyRoundConfig(cfg) {
    if (!cfg) return;
    this.rndBall = cfg.rndBall;
    this.rndPlace = cfg.rndPlace;
    this.rndChar = cfg.rndChar;
    this.rndGoal = cfg.rndGoal;
    this.rndArm = cfg.rndArm;
  },
};

window.MPRuntime = MPRuntime;
