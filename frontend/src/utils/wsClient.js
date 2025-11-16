// frontend/src/utils/wsClient.js
// Лёгкий WS‑клиент для редактора без авто‑таймеров/авто‑реконнектов.
// Подключаемся только по явному вызову connect() или при первой отправке.
// Имеется очередь сообщений (ограниченная), фолбэк: если нет соединения — сообщения копятся.

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

    this._maxQueue = 100;   // ограничение очереди
  }

  get url() {
    if (!this.clientId || !this.token) return null;
    const q = `?token=${encodeURIComponent(this.token)}`;
    return `${this.wsBase}/ws/editor/${encodeURIComponent(this.clientId)}/${q}`;
  }

  // Явное подключение: вызываем из кода редактора
  connect() {
    this._connectIfNeeded();
  }

  _connectIfNeeded() {
    if (this._closed) return;
    if (this.ready || this.socket || this._connecting) return;
    if (!this.clientId || !this.token) return;
    if (typeof WebSocket === 'undefined') return;

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
      // лёгкий бэкофф чтобы не долбиться постоянно
      this._nextAllowed = Date.now() + 3000;
    };
    this.socket.onclose = onEnd;
    this.socket.onerror = onEnd;
  }

  _enqueue(msg) {
    if (this.queue.length >= this._maxQueue) {
      this.queue.shift();
    }
    this.queue.push(msg);
  }

  _send(msg) {
    if (this._closed) return;
    if (!this.clientId || !this.token) return;
    if (!this.ready || !this.socket) {
      this._enqueue(msg);
      // НЕ автоконнектим здесь — оставляем на явный connect() или на уже открытое соединение
      return;
    }
    try {
      this.socket.send(JSON.stringify(msg));
    } catch {
      this.ready = false;
      try { this.socket.close(); } catch {}
      this.socket = null;
      this._enqueue(msg);
    }
  }

  setToken(token) {
    this.token = String(token || '');
    if (!this.token) {
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

  // API

  sendPatch(ops = []) {
    const safe = Array.isArray(ops) ? ops.map(op => ({ ...op })) : [];
    this._send({ type: 'patch', ops: safe });
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
  }

  destroy() {
    this.close();
  }
}

export default EditorWS;