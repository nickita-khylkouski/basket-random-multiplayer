// mp-sync.js — State Serialization & Interpolation
// Binary pack/unpack for physics state, interpolation buffer for smooth rendering

const MPSync = {
  // Binary serialization for compact state transfer
  // Format: [msgType(1)] [timestamp(4)] [varBlock(5)] [bodyCount(1)] [bodies...]
  // Each body: [nameIdx(1)] [x(4)] [y(4)] [angle(4)] = 13 bytes

  // Body name index mapping (compact encoding)
  BODY_NAMES: [
    'body', 'body2', 'body3', 'body4',
    'head', 'head2', 'head3', 'head4',
    'arm', 'arm2', 'arm3', 'arm4',
    'heavyBall', 'normalBall', 'kamesBall', 'smallBall',
  ],

  MSG_STATE: 1,
  MSG_INPUT: 2,
  MSG_ROUND_CONFIG: 3,
  MSG_GAME_EVENT: 4,

  // --- Serialization (Host sends) ---

  packState(state) {
    if (!state || !state.bodies) return null;

    const bodyEntries = Object.entries(state.bodies);
    // Header: type(1) + time(4) + p1Score(1) + p2Score(1) + goal(1) + pause(1) + menu(1) + bodyCount(1)
    const headerSize = 11;
    const bodySize = 13; // nameIdx(1) + x(4) + y(4) + angle(4)
    const totalSize = headerSize + bodyEntries.length * bodySize;

    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    let offset = 0;

    // Header
    view.setUint8(offset++, this.MSG_STATE);
    view.setUint32(offset, state.t & 0xFFFFFFFF, true); offset += 4;
    view.setUint8(offset++, state.vars.p1Score || 0);
    view.setUint8(offset++, state.vars.p2Score || 0);
    view.setUint8(offset++, state.vars.goal || 0);
    view.setUint8(offset++, state.vars.pause || 0);
    view.setUint8(offset++, state.vars.menu || 0);
    view.setUint8(offset++, bodyEntries.length);

    // Bodies
    for (const [name, body] of bodyEntries) {
      const nameIdx = this.BODY_NAMES.indexOf(name);
      view.setUint8(offset++, nameIdx === -1 ? 255 : nameIdx);
      view.setFloat32(offset, body.x, true); offset += 4;
      view.setFloat32(offset, body.y, true); offset += 4;
      view.setFloat32(offset, body.angle, true); offset += 4;
    }

    return buf;
  },

  unpackState(buf) {
    if (!buf || !(buf instanceof ArrayBuffer)) return null;

    const view = new DataView(buf);
    let offset = 0;

    const msgType = view.getUint8(offset++);
    if (msgType !== this.MSG_STATE) return null;

    const state = {
      t: view.getUint32(offset, true), offset: offset += 4,
      vars: {
        p1Score: view.getUint8(offset++),
        p2Score: view.getUint8(offset++),
        goal: view.getUint8(offset++),
        pause: view.getUint8(offset++),
        menu: view.getUint8(offset++),
      },
      bodies: {}
    };
    delete state.offset;

    const bodyCount = view.getUint8(offset++);
    for (let i = 0; i < bodyCount; i++) {
      const nameIdx = view.getUint8(offset++);
      const x = view.getFloat32(offset, true); offset += 4;
      const y = view.getFloat32(offset, true); offset += 4;
      const angle = view.getFloat32(offset, true); offset += 4;

      const name = this.BODY_NAMES[nameIdx];
      if (name) {
        state.bodies[name] = { x, y, angle };
      }
    }

    return state;
  },

  // Pack input message (Client sends)
  packInput(pressed) {
    const buf = new ArrayBuffer(2);
    const view = new DataView(buf);
    view.setUint8(0, this.MSG_INPUT);
    view.setUint8(1, pressed ? 1 : 0);
    return buf;
  },

  unpackInput(buf) {
    if (!buf || !(buf instanceof ArrayBuffer)) return null;
    const view = new DataView(buf);
    if (view.getUint8(0) !== this.MSG_INPUT) return null;
    return { pressed: view.getUint8(1) === 1 };
  },

  // Pack round config (Host sends at round start)
  packRoundConfig(cfg) {
    const buf = new ArrayBuffer(7);
    const view = new DataView(buf);
    view.setUint8(0, this.MSG_ROUND_CONFIG);
    view.setInt8(1, cfg.rndBall || 0);
    view.setInt8(2, cfg.rndPlace || 0);
    view.setInt8(3, cfg.rndChar || 0);
    view.setInt8(4, cfg.rndGoal || 0);
    view.setInt8(5, cfg.rndArm || 0);
    view.setUint8(6, 0); // reserved
    return buf;
  },

  unpackRoundConfig(buf) {
    if (!buf || !(buf instanceof ArrayBuffer)) return null;
    const view = new DataView(buf);
    if (view.getUint8(0) !== this.MSG_ROUND_CONFIG) return null;
    return {
      rndBall: view.getInt8(1),
      rndPlace: view.getInt8(2),
      rndChar: view.getInt8(3),
      rndGoal: view.getInt8(4),
      rndArm: view.getInt8(5),
    };
  },

  // Pack game event (score, game over, etc)
  packGameEvent(eventType, data) {
    // Simple JSON for game events (infrequent, reliability matters)
    return JSON.stringify({ _t: this.MSG_GAME_EVENT, event: eventType, data });
  },

  // --- Interpolation Buffer (Client-side) ---

  _buffer: [],
  _bufferSize: 3, // Keep last 3 states for interpolation
  _renderTime: 0,
  _interpolationDelay: 50, // ms behind latest state

  pushState(state) {
    this._buffer.push(state);
    if (this._buffer.length > this._bufferSize) {
      this._buffer.shift();
    }
  },

  // Get interpolated state for smooth rendering
  getInterpolatedState() {
    if (this._buffer.length < 2) {
      return this._buffer.length > 0 ? this._buffer[this._buffer.length - 1] : null;
    }

    // Use the two most recent states
    const prev = this._buffer[this._buffer.length - 2];
    const curr = this._buffer[this._buffer.length - 1];

    if (!prev || !curr) return curr;

    const dt = curr.t - prev.t;
    if (dt <= 0) return curr;

    // Calculate interpolation factor
    const now = Date.now();
    const targetTime = curr.t;
    const elapsed = now - targetTime;
    const t = Math.max(0, Math.min(1, 1 + elapsed / dt));

    // Interpolate body positions
    const interpolated = {
      t: now,
      vars: curr.vars, // vars don't interpolate
      bodies: {}
    };

    for (const name of Object.keys(curr.bodies)) {
      const cBody = curr.bodies[name];
      const pBody = prev.bodies[name];

      if (!pBody) {
        interpolated.bodies[name] = cBody;
        continue;
      }

      interpolated.bodies[name] = {
        x: this._lerp(pBody.x, cBody.x, t),
        y: this._lerp(pBody.y, cBody.y, t),
        angle: this._lerpAngle(pBody.angle, cBody.angle, t),
      };
    }

    return interpolated;
  },

  _lerp(a, b, t) {
    return a + (b - a) * t;
  },

  _lerpAngle(a, b, t) {
    // Handle angle wrapping
    let diff = b - a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return a + diff * t;
  },

  clearBuffer() {
    this._buffer = [];
  },

  // --- Message Router ---
  // Determines message type and unpacks accordingly

  unpackMessage(rawData) {
    // Handle ArrayBuffer
    if (rawData instanceof ArrayBuffer) {
      const type = new DataView(rawData).getUint8(0);
      switch (type) {
        case this.MSG_STATE: return { type: 'state', data: this.unpackState(rawData) };
        case this.MSG_INPUT: return { type: 'input', data: this.unpackInput(rawData) };
        case this.MSG_ROUND_CONFIG: return { type: 'roundConfig', data: this.unpackRoundConfig(rawData) };
      }
    }

    // Handle JSON string (game events)
    if (typeof rawData === 'string') {
      try {
        const parsed = JSON.parse(rawData);
        if (parsed._t === this.MSG_GAME_EVENT) {
          return { type: 'gameEvent', data: parsed };
        }
      } catch (e) { /* not JSON */ }
    }

    // Handle plain objects (PeerJS may deserialize automatically)
    if (rawData && typeof rawData === 'object' && !(rawData instanceof ArrayBuffer)) {
      // PeerJS serializes ArrayBuffers to objects, check for our format
      if (rawData.type === 'state' || rawData.type === 'input' || rawData.type === 'roundConfig') {
        return rawData;
      }
      // It might be a deserialized game event
      if (rawData._t === this.MSG_GAME_EVENT) {
        return { type: 'gameEvent', data: rawData };
      }
      // Treat as a generic state object (JSON mode fallback)
      if (rawData.bodies) {
        return { type: 'state', data: rawData };
      }
      if (rawData.pressed !== undefined) {
        return { type: 'input', data: rawData };
      }
      if (rawData.rndBall !== undefined) {
        return { type: 'roundConfig', data: rawData };
      }
    }

    return { type: 'unknown', data: rawData };
  }
};

window.MPSync = MPSync;
