// Базовый URL API берётся из .env (VITE_API_URL=http://127.0.0.1:8000/api)
const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

function authHeader() {
  const access = localStorage.getItem('access');
  return access ? { Authorization: `Bearer ${access}` } : {};
}

function parseJsonSafe(text) {
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

function buildError(text) {
  const data = parseJsonSafe(text);
  if (data.detail) return new Error(data.detail);
  if (typeof data === 'object' && data) {
    const parts = [];
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (Array.isArray(v)) parts.push(v.join('\n'));
      else if (typeof v === 'string') parts.push(v);
    }
    if (parts.length) return new Error(parts.join('\n'));
  }
  return new Error('Ошибка запроса');
}

function isTokenProblem(text) {
  const data = parseJsonSafe(text);
  if (!data) return false;
  if (data.code === 'token_not_valid') return true;
  if (data.detail && /token/i.test(String(data.detail)) && /expired|not valid/i.test(String(data.detail))) return true;
  if (Array.isArray(data.messages)) return true;
  return false;
}

async function refreshAccessToken() {
  const refresh = localStorage.getItem('refresh');
  if (!refresh) return null;
  try {
    const res = await fetch(API + '/auth/token/refresh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh })
    });
    const text = await res.text();
    if (!res.ok) return null;
    const data = parseJsonSafe(text);
    if (data && data.access) {
      localStorage.setItem('access', data.access);
      return data.access;
    }
  } catch {}
  return null;
}

async function request(path, options = {}, _retried = false) {
  const url = path.startsWith('http') ? path : (API + path);
  const res = await fetch(url, options);
  const text = await res.text();

  if (res.status === 401 && !_retried && isTokenProblem(text)) {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      const headers = { ...(options.headers || {}), Authorization: `Bearer ${newAccess}` };
      const res2 = await fetch(url, { ...options, headers });
      const text2 = await res2.text();
      if (!res2.ok) throw buildError(text2);
      return parseJsonSafe(text2);
    }
  }

  if (!res.ok) throw buildError(text);
  return parseJsonSafe(text);
}

async function requestAuthed(path, options = {}) {
  const headers = { ...(options.headers || {}), ...authHeader() };
  return request(path, { ...options, headers });
}

// Единые события
function emitUser(u) {
  window.dispatchEvent(new CustomEvent('user:update', { detail: u || null }));
}
function emitBilling(s) {
  window.dispatchEvent(new CustomEvent('billing:update', { detail: s || null }));
}

export const AuthAPI = {
  getApiBase() { return API; },

  authed(path, options = {}) {
    return requestAuthed(path, options);
  },

  async login(identifier, password) {
    const data = await request('/auth/login/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });
    localStorage.setItem('access', data.access);
    localStorage.setItem('refresh', data.refresh);
    localStorage.setItem('user', JSON.stringify(data.user));
    emitUser(data.user);
    try { emitBilling(await this.getBillingStatus()); } catch {}
    return data.user;
  },

  async register(email, username, password) {
    const data = await request('/auth/register/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password })
    });
    localStorage.setItem('access', data.access);
    localStorage.setItem('refresh', data.refresh);
    localStorage.setItem('user', JSON.stringify(data.user));
    emitUser(data.user);
    try { emitBilling(await this.getBillingStatus()); } catch {}
    return data.user;
  },

  async google(id_token) {
    const data = await request('/auth/google/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token })
    });
    localStorage.setItem('access', data.access);
    localStorage.setItem('refresh', data.refresh);
    localStorage.setItem('user', JSON.stringify(data.user));
    emitUser(data.user);
    try { emitBilling(await this.getBillingStatus()); } catch {}
    return data.user;
  },

  async facebook(access_token) {
    const data = await request('/auth/facebook/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token })
    });
    localStorage.setItem('access', data.access);
    localStorage.setItem('refresh', data.refresh);
    localStorage.setItem('user', JSON.stringify(data.user));
    emitUser(data.user);
    try { emitBilling(await this.getBillingStatus()); } catch {}
    return data.user;
  },

  async vk(access_token, email) {
    const data = await request('/auth/vk/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token, email })
    });
    localStorage.setItem('access', data.access);
    localStorage.setItem('refresh', data.refresh);
    localStorage.setItem('user', JSON.stringify(data.user));
    emitUser(data.user);
    try { emitBilling(await this.getBillingStatus()); } catch {}
    return data.user;
  },

  logout() {
    localStorage.removeItem('access');
    localStorage.removeItem('refresh');
    localStorage.removeItem('user');
    emitUser(null);
    emitBilling(null);
  },

  me() {
    return requestAuthed('/auth/me/');
  },

  async updateProfile(formData) {
    const data = await requestAuthed('/auth/profile/', { method: 'POST', body: formData });
    localStorage.setItem('user', JSON.stringify(data));
    emitUser(data);
    return data;
  },

  requestCode(email) {
    return request('/auth/password/request-code/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
  },

  async confirmCode(email, code, new_password) {
    const data = await request('/auth/password/confirm/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, new_password })
    });
    if (data.access) localStorage.setItem('access', data.access);
    if (data.refresh) localStorage.setItem('refresh', data.refresh);
    try { emitBilling(await this.getBillingStatus()); } catch {}
    return data;
  },

  async changePassword(old_password, new_password) {
    const data = await requestAuthed('/auth/password/change/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_password, new_password })
    });
    if (data.access) localStorage.setItem('access', data.access);
    if (data.refresh) localStorage.setItem('refresh', data.refresh);
    return data;
  },

  // ----- Billing -----
  getBillingStatus() {
    return requestAuthed('/billing/status/');
  },

  async recordDownload(kind, pages, doc_name, mode = 'free') {
    // если не авторизован — не дёргаем API (убираем 401 в консоли)
    if (!localStorage.getItem('access')) return null;
    try {
      const s = await requestAuthed('/billing/record/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, pages, doc_name, mode }),
      });
      emitBilling(s);
      return s;
    } catch (e) {
      return null; // не блокируем UX
    }
  },

  startPurchase(plan) {
    return requestAuthed('/payments/create/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
  },
};