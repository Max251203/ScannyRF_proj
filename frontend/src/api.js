// ----------------------------- API core helpers -----------------------------

// Базовый URL API
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

function clearTokens() {
  localStorage.removeItem('access');
  localStorage.removeItem('refresh');
  localStorage.removeItem('user');
  emitUser(null);
  emitBilling(null);
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
    } else {
      clearTokens();
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

// ----------------------------- API -----------------------------

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

  logout() { clearTokens(); },

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

  // Публичные цены (для гостей и в целом для динамики на лендинге)
  async getPublicPrices() {
    const d = await request('/billing/public/');
    return {
      single: Number(d?.price_single ?? 99),
      month: Number(d?.price_month ?? 399),
      year: Number(d?.price_year ?? 3999),
    };
  },

  async recordDownload(kind, pages, doc_name, mode = 'free') {
    if (!localStorage.getItem('access')) return null;
    try {
      const s = await requestAuthed('/billing/record/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, pages, doc_name, mode }),
      });
      emitBilling(s);
      return s;
    } catch {
      return null;
    }
  },

  // История загрузок (временное хранилище, хранится на бэкенде)
  async recordUpload(client_id, doc_name, pages) {
    if (!localStorage.getItem('access')) return null;
    try {
      const s = await requestAuthed('/uploads/record/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, doc_name, pages }),
      });
      try { emitBilling(await this.getBillingStatus()); } catch {}
      return s;
    } catch {
      return null;
    }
  },

  async deleteUploadsByClient(client_id) {
    if (!localStorage.getItem('access')) return null;
    try {
      await requestAuthed('/uploads/delete/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id }),
      });
      try { emitBilling(await this.getBillingStatus()); } catch {}
      return true;
    } catch {
      return false;
    }
  },

  // ----- Покупки -----
  startPurchase(plan, promo = '') {
    return requestAuthed('/payments/create/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, promo }),
    });
  },

  validatePromo(code) {
    return request('/billing/promo/validate/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  },

  // ----- Админ: конфиг биллинга и промокоды -----
  getBillingConfig() {
    return requestAuthed('/billing/config/');
  },

  // ВАЖНО: после изменения конфигурации — эмитим billing:update, чтобы цены/лимиты обновились везде
  async setBillingConfig(payload) {
    const data = await requestAuthed('/billing/config/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // Пытаемся получить свежий статус биллинга (свободные лимиты и т.д.), если не выйдет — шлём то, что вернул PUT
    try {
      const st = await this.getBillingStatus();
      emitBilling(st);
    } catch {
      emitBilling({
        // Прокинем то, что точно нужно для динамических цен/TTL:
        draft_ttl_hours: Number(data?.draft_ttl_hours ?? 24),
        price_single: Number(data?.price_single ?? 99),
        price_month: Number(data?.price_month ?? 399),
        price_year: Number(data?.price_year ?? 3999),
        free_daily_quota: Number(data?.free_daily_quota ?? 3),
      });
    }
    return data;
  },

  setDraftTTL(draft_ttl_hours) {
    return this.setBillingConfig({ draft_ttl_hours });
  },

  getPromos() {
    return requestAuthed('/billing/promos/');
  },
  createPromo({ code, discount_percent, active = true, note = '' }) {
    return requestAuthed('/billing/promos/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, discount_percent, active, note }),
    });
  },
  updatePromo(id, { code, discount_percent, active = true, note = '' }) {
    return requestAuthed(`/billing/promos/${id}/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, discount_percent, active, note }),
    });
  },
  deletePromo(id) {
    return requestAuthed(`/billing/promos/${id}/`, { method: 'DELETE' });
  },

  // ----- Библиотека подписей/печати -----
  listSigns() {
    // Бэкенд возвращает объединённый список: пользовательские + дефолтные (без скрытых)
    return requestAuthed('/library/signs/');
  },
  addSign({ kind = 'signature', data_url = null, file = null }) {
    const fd = new FormData();
    fd.append('kind', kind);
    if (file) fd.append('image', file);
    else if (data_url) fd.append('data_url', data_url);
    else throw new Error('Ожидается file или data_url');
    return requestAuthed('/library/signs/', { method: 'POST', body: fd });
  },
  deleteSign(id) {
    return requestAuthed(`/library/signs/${id}/`, { method: 'DELETE' });
  },

  // Скрыть/показать дефолтный элемент в своей библиотеке
  hideDefaultSign(globalId) {
    return requestAuthed('/library/default-signs/hide/', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ sign_id: globalId, hide: true }),
    });
  },
  unhideDefaultSign(globalId) {
    return requestAuthed('/library/default-signs/hide/', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ sign_id: globalId, hide: false }),
    });
  },

  // ----- Админ: глобальные подписи/печати -----
  adminListDefaults() {
    return requestAuthed('/library/default-signs/');
  },
  adminAddDefault({ kind = 'signature', data_url = null, file = null }) {
    const fd = new FormData();
    fd.append('kind', kind);
    if (file) fd.append('image', file);
    else if (data_url) fd.append('data_url', data_url);
    else throw new Error('Ожидается file или data_url');
    return requestAuthed('/library/default-signs/', { method: 'POST', body: fd });
  },
  adminDeleteDefault(id) {
    return requestAuthed(`/library/default-signs/${id}/`, { method: 'DELETE' });
  },

  // ----- Черновик документа (серверное хранилище) -----
  getDraft() {
    return requestAuthed('/draft/get/');
  },
  saveDraft(data) {
    return requestAuthed('/draft/save/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
  },
  clearDraft() {
    return requestAuthed('/draft/clear/', { method: 'POST' });
  },

  // ----- Автосессия при старте приложения -----
  async bootstrap() {
    const hasRefresh = !!localStorage.getItem('refresh');
    if (!hasRefresh) return;
    try {
      if (!localStorage.getItem('access')) {
        const ok = await refreshAccessToken();
        if (!ok) { clearTokens(); return; }
      }
      const me = await this.me();
      localStorage.setItem('user', JSON.stringify(me));
      emitUser(me);
      try { emitBilling(await this.getBillingStatus()); } catch {}
    } catch {
      clearTokens();
    }
  },
};