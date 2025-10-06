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

// CKEditor 4.22.1 (standard)
export async function ensureCKE422() {
  if (window.CKEDITOR && window.CKEDITOR.status === 'loaded') return;
  if (window.CKEDITOR && window.CKEDITOR.status !== 'loaded') { try { delete window.CKEDITOR; } catch {} }
  window.CKEDITOR_BASEPATH = 'https://cdn.ckeditor.com/4.22.1/standard/';
  await loadScript('https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js');
  if (!window.CKEDITOR || window.CKEDITOR.status !== 'loaded') {
    let loadedFired = false;
    try { window.CKEDITOR.on('loaded', () => { loadedFired = true; }); } catch {}
    await waitFor(() => loadedFired || (window.CKEDITOR && window.CKEDITOR.status === 'loaded'), 8000, 50);
  }
}

// Mammoth (DOCX->HTML)
export async function ensureMammothCDN() {
  if (window.mammoth) return;
  const cdns = [
    'https://unpkg.com/mammoth@1.7.1/mammoth.browser.min.js',
    'https://cdn.jsdelivr.net/npm/mammoth@1.7.1/mammoth.browser.min.js',
  ];
  let lastErr = null;
  for (const url of cdns) {
    try {
      await loadScript(url);
      const ok = await waitFor(() => !!window.mammoth, 4000, 50);
      if (ok) return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Не удалось загрузить mammoth с CDN');
}

/* ===== Библиотеки для редактора документов ===== */

// fabric.js — холст и объекты
export async function ensureFabric() {
  if (window.fabric) return;
  const cdns = [
    'https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js',
    'https://unpkg.com/fabric@5.3.0/dist/fabric.min.js',
  ];
  let lastErr = null;
  for (const url of cdns) {
    try {
      await loadScript(url);
      const ok = await waitFor(() => !!window.fabric, 5000, 50);
      if (ok) return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Не удалось загрузить fabric.js');
}

// PDF.js — рендер PDF
export async function ensurePDFJS() {
  if (window.pdfjsLib) return;
  const ver = '3.11.174';
  const libUrls = [
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.min.js`,
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${ver}/pdf.min.js`,
  ];
  const workerUrls = [
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.worker.min.js`,
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${ver}/pdf.worker.min.js`,
  ];
  let lastErr = null;
  for (let i=0;i<libUrls.length;i++) {
    try {
      await loadScript(libUrls[i]);
      const ok = await waitFor(() => !!window.pdfjsLib, 5000, 50);
      if (!ok) continue;
      await loadScript(workerUrls[i]);
      try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrls[i]; } catch {}
      return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Не удалось загрузить pdfjs-dist');
}

// html2canvas — «снимок» DOM
export async function ensureHtml2Canvas() {
  if (window.html2canvas) return;
  const cdns = [
    'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js',
  ];
  let lastErr = null;
  for (const url of cdns) {
    try {
      await loadScript(url);
      const ok = await waitFor(() => !!window.html2canvas, 4000, 50);
      if (ok) return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Не удалось загрузить html2canvas');
}

// SheetJS — XLS/XLSX
export async function ensureSheetJS() {
  if (window.XLSX) return;
  const cdns = [
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
  ];
  let lastErr = null;
  for (const url of cdns) {
    try {
      await loadScript(url);
      const ok = await waitFor(() => !!window.XLSX, 4000, 50);
      if (ok) return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Не удалось загрузить SheetJS (xlsx)');
}

// jsPDF — генерация PDF
export async function ensureJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return;
  const cdns = [
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js',
  ];
  let lastErr = null;
  for (const url of cdns) {
    try {
      await loadScript(url);
      const ok = await waitFor(() => !!(window.jspdf && window.jspdf.jsPDF), 4000, 50);
      if (ok) return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Не удалось загрузить jsPDF');
}

// Cropper.js — модалка обрезки подписи/печати
export async function ensureCropper() {
  if (window.Cropper) return;
  const cssCdn = [
    'https://cdn.jsdelivr.net/npm/cropperjs@1.6.1/dist/cropper.min.css',
    'https://unpkg.com/cropperjs@1.6.1/dist/cropper.min.css',
  ];
  const jsCdn = [
    'https://cdn.jsdelivr.net/npm/cropperjs@1.6.1/dist/cropper.min.js',
    'https://unpkg.com/cropperjs@1.6.1/dist/cropper.min.js',
  ];
  let lastErr = null;
  for (let i=0;i<cssCdn.length;i++){
    try {
      await loadStyle(cssCdn[i]);
      await loadScript(jsCdn[i]);
      const ok = await waitFor(() => !!window.Cropper, 4000, 50);
      if (ok) return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Не удалось загрузить Cropper.js');
}