// frontend/src/utils/wsClient.js

// Lightweight WebSocket client for Editor events.
// Подключается лениво при первой отправке, повторные попытки ограничены по времени.

function apiBaseToWsBase(apiBase) {
  try {
    const u = new URL(apiBase);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = u.host;
    const basePath = u.pathname.replace(/\/api\/?$/, '') || '/';
    return `${proto}//${host}${basePath}`.replace(/\/+$/, '');
  } catch {
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
    this.queue = [];        // сообщения до открытия соединения
    this.onmessage = null;  // внешняя обработка onmessage
    this._nextAllowed = 0;  // троттлинг попыток подключения
    this._connecting = false;
  }

  get url() {
    if (!this.clientId) return null;
    const q = this.token ? `?token=${encodeURIComponent(this.token)}` : '';
    return `${this.wsBase}/ws/editor/${encodeURIComponent(this.clientId)}/${q}`;
  }

  _connectIfNeeded() {
    if (this.ready || this.socket || this._connecting) return;
    const url = this.url;
    if (!url) return;

    const now = Date.now();
    if (now < this._nextAllowed) return; // ждём окно

    this._connecting = true;
    try {
      this.socket = new WebSocket(url);
    } catch {
      this.socket = null;
      this._connecting = false;
      this._nextAllowed = now + 2000;
      return;
    }

    this.socket.onopen = () => {
      this.ready = true;
      this._connecting = false;
      try {
        for (const msg of this.queue) this.socket?.send(JSON.stringify(msg));
      } catch {}
      this.queue = [];
    };

    this.socket.onmessage = (ev) => {
      if (typeof this.onmessage === 'function') {
        try { this.onmessage(ev); } catch {}
      }
    };

    const onEnd = () => {
      this.ready = false;
      this._connecting = false;
      this.socket = null;
      this._nextAllowed = Date.now() + 2000; // не чаще раза в 2 секунды
    };
    this.socket.onclose = onEnd;
    this.socket.onerror = onEnd;
  }

  _send(msg) {
    if (!this.clientId) return;
    if (!this.ready || !this.socket) {
      this.queue.push(msg);
      this._connectIfNeeded();
      return;
    }
    try {
      this.socket.send(JSON.stringify(msg));
    } catch {
      this.ready = false;
      try { this.socket.close(); } catch {}
      this.socket = null;
      this.queue.push(msg);
      this._connectIfNeeded();
    }
  }

  setToken(token) {
    this.token = String(token || '');
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
    const safe = Array.isArray(events) ? events.map(e => ({
      kind: String(e?.kind || 'unknown'),
      payload: (e && e.payload) || {},
    })) : [];
    this._send({ type: 'events', events: safe });
  }

  commit(snapshot) {
    this._send({ type: 'commit', snapshot: snapshot || {} });
  }

  ping() {
    this._send({ type: 'ping' });
  }

  close() {
    this.queue = [];
    this.ready = false;
    this._connecting = false;
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
    }
  }
}

export default EditorWS;