// Загрузка внешних скриптов/стилей с кэшем и ожиданием готовности
// (оставлено без изменений; используется в ряде компонентов)
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
  // basePath ОБЯЗАТЕЛЬНО до загрузки
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
  if (window.CKEDITOR && window.CKEDITOR.status === 'loaded' && !lt(window.CKITOR?.version || window.CKEDITOR.version, '4.22.1')) return;
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