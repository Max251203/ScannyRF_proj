// Lightweight WebSocket client for Editor events without timers.
// Lazily connects on first send; if socket is closed, next send will reconnect.
// No auto-heartbeats or intervals.

function apiBaseToWsBase(apiBase) {
  // apiBase like: http://127.0.0.1:8000/api
  try {
    const u = new URL(apiBase);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = u.host;
    // strip trailing /api
    const basePath = u.pathname.replace(/\/api\/?$/, '') || '/';
    return `${proto}//${host}${basePath}`.replace(/\/+$/, '');
  } catch {
    // fallback to current location
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = location.host;
    return `${proto}//${host}`;
  }
}

export class EditorWS {
  constructor({ clientId, token, apiBase }) {
    this.clientId = String(clientId || '');
    this.token = String(token || '');
    this.wsBase = apiBaseToWsBase(apiBase || (import.meta?.env?.VITE_API_URL || ''));
    this.socket = null;
    this.ready = false;
    this.queue = []; // queued messages until 'open'
    this.closing = false;
  }

  get url() {
    if (!this.clientId) return null;
    const q = this.token ? `?token=${encodeURIComponent(this.token)}` : '';
    return `${this.wsBase}/ws/editor/${encodeURIComponent(this.clientId)}/${q}`;
  }

  connectIfNeeded() {
    if (this.ready || this.socket) return;
    const url = this.url;
    if (!url) return;

    try {
      this.socket = new WebSocket(url);
    } catch {
      this.socket = null;
      return;
    }

    this.socket.onopen = () => {
      this.ready = true;
      // flush queue
      try {
        for (const msg of this.queue) {
          this.socket?.send(JSON.stringify(msg));
        }
      } catch {}
      this.queue = [];
    };

    this.socket.onmessage = (ev) => {
      // Consumers may attach external handler if needed
      if (typeof this.onmessage === 'function') {
        try { this.onmessage(ev); } catch {}
      }
    };

    this.socket.onclose = () => {
      this.ready = false;
      this.socket = null;
      // no auto-reconnect here — next send() will connect lazily
    };

    this.socket.onerror = () => {
      // Just drop; next send() will try to reconnect
    };
  }

  _send(msg) {
    if (!this.clientId) return;
    if (!this.ready || !this.socket) {
      this.queue.push(msg);
      this.connectIfNeeded();
      return;
    }
    try {
      this.socket.send(JSON.stringify(msg));
    } catch {
      // fallback to queue and reconnect on next call
      this.ready = false;
      try { this.socket.close(); } catch {}
      this.socket = null;
      this.queue.push(msg);
    }
  }

  setToken(token) {
    // Token can be rotated by JWT refresh
    this.token = String(token || '');
    // Reconnect on next send to apply new token
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
      this.ready = false;
    }
  }

  setClientId(clientId) {
    this.clientId = String(clientId || '');
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
      this.ready = false;
    }
  }

  sendEvent(kind, payload = {}) {
    this._send({ type: 'event', kind, payload });
  }

  sendEvents(events = []) {
    // events: [{ kind, payload }, ...]
    const safe = Array.isArray(events) ? events.map(e => ({
      kind: String(e?.kind || 'unknown'),
      payload: (e && e.payload) || {},
    })) : [];
    this._send({ type: 'events', events: safe });
  }

  commit(snapshot) {
    // Final snapshot (full serializeDocument)
    this._send({ type: 'commit', snapshot: snapshot || {} });
  }

  ping() {
    this._send({ type: 'ping' });
  }

  close() {
    this.queue = [];
    this.ready = false;
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
    }
  }
}