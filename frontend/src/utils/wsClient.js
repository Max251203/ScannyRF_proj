// frontend/src/utils/wsClient.js

// Lightweight WebSocket client for Editor events.
// Подключается лениво при первой отправке, повторные попытки ограничены по времени,
// не коннектится в неактивной вкладке, умеет восстанавливаться при возврате.

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
    this._closed = false;

    // Ограничим размер очереди сообщений (защита от переполнения)
    this._maxQueue = 100;

    // Автовосстановление соединения при возврате во вкладку
    this._onVis = () => {
      if (document.visibilityState === 'visible') {
        this._connectIfNeeded();
      }
    };
    try {
      document.addEventListener('visibilitychange', this._onVis);
    } catch {}
  }

  get url() {
    if (!this.clientId || !this.token) return null;
    const q = `?token=${encodeURIComponent(this.token)}`;
    return `${this.wsBase}/ws/editor/${encodeURIComponent(this.clientId)}/${q}`;
  }

  _connectIfNeeded() {
    if (this._closed) return;
    // не коннектимся в фоновом табе/без токена/клиента/идёт переподключение
    if (this.ready || this.socket || this._connecting) return;
    if (!this.clientId || !this.token) return;
    if (typeof WebSocket === 'undefined') return;
    if (document.visibilityState === 'hidden') return;

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
      this._nextAllowed = now + 2500;
      return;
    }

    this.socket.onopen = () => {
      this.ready = true;
      this._connecting = false;
      try {
        for (const msg of this.queue) this.socket?.send?.(JSON.stringify(msg));
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
      // увеличим «минимальный» бэкофф
      this._nextAllowed = Date.now() + 3000;
    };
    this.socket.onclose = onEnd;
    this.socket.onerror = onEnd;
  }

  _send(msg) {
    if (this._closed) return;
    if (!this.clientId || !this.token) return;
    if (!this.ready || !this.socket) {
      // ограничиваем рост очереди
      if (this.queue.length >= this._maxQueue) {
        this.queue.shift();
      }
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
      if (this.queue.length >= this._maxQueue) {
        this.queue.shift();
      }
      this.queue.push(msg);
      this._connectIfNeeded();
    }
  }

  setToken(token) {
    this.token = String(token || '');
    if (!this.token) {
      // нет токена — больше не пытаемся подключаться
      this.queue = [];
      this.ready = false;
      this._connecting = false;
      try { this.socket?.close?.(); } catch {}
      this.socket = null;
      return;
    }
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
      this.ready = false;
    }
  }

  setClientId(clientId) {
    this.clientId = String(clientId || '');
    if (!this.clientId || !this.token) {
      // нет данных для коннекта — гасим всё
      this.queue = [];
      this.ready = false;
      this._connecting = false;
      try { this.socket?.close?.(); } catch {}
      this.socket = null;
      return;
    }
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
    this._closed = true;
    this.queue = [];
    this.ready = false;
    this._connecting = false;
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
    }
    try {
      document.removeEventListener('visibilitychange', this._onVis);
    } catch {}
  }
}

export default EditorWS;