// Загрузка внешних скриптов/стилей с кэшем и ожиданием готовности
const cache = new Map();
const styleCache = new Map();

function loadScript(src) {
  if (cache.get(src)) return cache.get(src);
  const p = new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.async = true;
    tag.onload = () => resolve(src);
    tag.onerror = () => { cache.delete(src); reject(new Error(`Не удалось загрузить ${src}`)); };
    document.body.appendChild(tag);
  });
  cache.set(src, p);
  return p;
}
function loadStyle(href) {
  if (styleCache.get(href)) return styleCache.get(href);
  const p = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve(href);
    link.onerror = () => { styleCache.delete(href); reject(new Error(`Не удалось загрузить ${href}`)); };
    document.head.appendChild(link);
  });
  styleCache.set(href, p);
  return p;
}

export function ensureScripts(urls = []) { return Promise.all(urls.map(loadScript)); }

async function waitFor(check, timeoutMs = 8000, stepMs = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (check()) return true; } catch {}
    await new Promise(r => setTimeout(r, stepMs));
  }
  return false;
}

function parseVer(v = '') {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [parseInt(m[1],10), parseInt(m[2],10), parseInt(m[3],10)] : [0,0,0];
}
function lt(v, req='4.22.1') {
  const a = parseVer(v), b = parseVer(req);
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] < b[2];
}
function absDir(url){
  const u = new URL(url, window.location.origin);
  return u.href.replace(/[^/?#]+(\?.*)?$/, '');
}

async function loadCk(url) {
  const base = absDir(url);
  window.CKEDITOR_BASEPATH = base;
  try { if (window.CKEDITOR) delete window.CKEDITOR; } catch {}
  await loadScript(url);
  let ready = false;
  try { window.CKEDITOR.on('loaded', () => { ready = true; }); } catch {}
  await waitFor(() => ready || (window.CKEDITOR && window.CKEDITOR.status === 'loaded'), 8000, 50);
  if (!window.CKEDITOR) throw new Error('CKEditor не инициализировался');
  const ver = window.CKEDITOR.version || '';
  if (lt(ver, '4.22.1')) throw new Error(`Ожидалась 4.22.1, загружена ${ver}`);
  try { window.CKEDITOR.basePath = base; } catch {}
  return true;
}

// CKEditor 4.22.1 standard: локально по /static, затем CDN
export async function ensureCKE422() {
  if (window.CKEDITOR && window.CKEDITOR.status === 'loaded' && !lt(window.CKEDITOR.version, '4.22.1')) return;
  const localStatic = `${window.location.origin}/static/vendor/ckeditor/ckeditor.js`;
  const variants = [
    localStatic,
    'https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js',
    'https://cdnjs.cloudflare.com/ajax/libs/ckeditor/4.22.1/ckeditor.js',
  ];
  let lastErr = null;
  for (const url of variants) {
    try { await loadCk(url); return; } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Не удалось загрузить CKEditor 4.22.1');
}

/* Остальные ensure* — без изменений */
export async function ensureMammothCDN(){ if(window.mammoth) return; const cdn=['https://unpkg.com/mammoth@1.7.1/mammoth.browser.min.js','https://cdn.jsdelivr.net/npm/mammoth@1.7.1/mammoth.browser.min.js']; let err=null; for(const u of cdn){ try{ await loadScript(u); const ok=await waitFor(()=>!!window.mammoth,4000,50); if(ok) return; }catch(e){err=e} } throw err||new Error('Не удалось загрузить mammoth');}
export async function ensureFabric(){ if(window.fabric) return; const cdn=['https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js','https://unpkg.com/fabric@5.3.0/dist/fabric.min.js']; let err=null; for(const u of cdn){ try{ await loadScript(u); const ok=await waitFor(()=>!!window.fabric,5000,50); if(ok) return; }catch(e){err=e} } throw err||new Error('Не удалось загрузить fabric.js');}
export async function ensurePDFJS(){ if(window.pdfjsLib) return; const ver='3.11.174',lib=[`https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.min.js`,`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${ver}/pdf.min.js`],wrk=[`https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.worker.min.js`,`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${ver}/pdf.worker.min.js`]; let err=null; for(let i=0;i<lib.length;i++){ try{ await loadScript(lib[i]); const ok=await waitFor(()=>!!window.pdfjsLib,5000,50); if(!ok) continue; await loadScript(wrk[i]); try{ window.pdfjsLib.GlobalWorkerOptions.workerSrc = wrk[i]; }catch{} return; }catch(e){err=e} } throw err||new Error('Не удалось загрузить pdfjs-dist');}
export async function ensureHtml2Canvas(){ if(window.html2canvas) return; const cdn=['https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js','https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js']; let err=null; for(const u of cdn){ try{ await loadScript(u); const ok=await waitFor(()=>!!window.html2canvas,4000,50); if(ok) return; }catch(e){err=e} } throw err||new Error('Не удалось загрузить html2canvas');}
export async function ensureSheetJS(){ if(window.XLSX) return; const cdn=['https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js','https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js']; let err=null; for(const u of cdn){ try{ await loadScript(u); const ok=await waitFor(()=>!!window.XLSX,4000,50); if(ok) return; }catch(e){err=e} } throw err||new Error('Не удалось загрузить SheetJS');}
export async function ensureJsPDF(){ if(window.jspdf&&window.jspdf.jsPDF) return; const cdn=['https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js','https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js']; let err=null; for(const u of cdn){ try{ await loadScript(u); const ok=await waitFor(()=>!!(window.jspdf&&window.jspdf.jsPDF),4000,50); if(ok) return; }catch(e){err=e} } throw err||new Error('Не удалось загрузить jsPDF');}
export async function ensureCropper(){ if(window.Cropper) return; const css=['https://cdn.jsdelivr.net/npm/cropperjs@1.6.1/dist/cropper.min.css','https://unpkg.com/cropperjs@1.6.1/dist/cropper.min.css'],js=['https://cdn.jsdelivr.net/npm/cropperjs@1.6.1/dist/cropper.min.js','https://unpkg.com/cropperjs@1.6.1/dist/cropper.min.js']; let err=null; for(let i=0;i<css.length;i++){ try{ await loadStyle(css[i]); await loadScript(js[i]); const ok=await waitFor(()=>!!window.Cropper,4000,50); if(ok) return; }catch(e){err=e} } throw err||new Error('Не удалось загрузить Cropper.js');}
export async function ensureJSZip(){ if(window.JSZip) return; const cdn=['https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js','https://unpkg.com/jszip@3.10.1/dist/jszip.min.js']; let err=null; for(const u of cdn){ try{ await loadScript(u); const ok=await waitFor(()=>!!window.JSZip,4000,50); if(ok) return; }catch(e){err=e} } throw err||new Error('Не удалось загрузить JSZip');}

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
    } catch (e) {
      return null;
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
  setBillingConfig(free_daily_quota) {
    return requestAuthed('/billing/config/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ free_daily_quota }),
    });
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
    // Теперь бэкенд возвращает объединённый список: пользовательские + дефолтные (без скрытых)
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