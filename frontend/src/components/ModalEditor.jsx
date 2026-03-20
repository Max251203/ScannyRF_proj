import { useEffect, useRef, useState } from 'react'
import { ensureCKE422, ensureMammothCDN } from '../utils/scriptLoader'
import { toast } from './Toast.jsx'

export default function ModalEditor({
  open, onClose,
  title = 'Редактор',
  initialTitle = '',
  initialHTML = '',
  onSave,
  allowImport = true,
  width = 'min(900px,96vw)',
  protectTitle = false,
  requireTitle = true,
}) {
  const [locTitle, setLocTitle] = useState(initialTitle || '')
  const [lockTitle, setLockTitle] = useState(!!protectTitle)

  // Генерируем уникальный ID для textarea
  const areaIdRef = useRef('editor-' + Math.random().toString(36).slice(2))
  const instRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => { if (open) setLocTitle(initialTitle || '') }, [initialTitle, open])

  useEffect(() => {
    if (!open) return
    let canceled = false

    const init = async () => {
      try {
        await ensureCKE422() // Теперь грузит локальный CKEditor
        await new Promise(r => setTimeout(r, 0))
        if (canceled) return

        // Уничтожаем старый инстанс, если был
        try { 
          if (window.CKEDITOR.instances[areaIdRef.current]) {
            window.CKEDITOR.instances[areaIdRef.current].destroy(true);
          }
        } catch {}
        instRef.current = null

        const el = document.getElementById(areaIdRef.current)
        if (!el || !window.CKEDITOR) {
          console.error('CKEDITOR not found or element missing');
          return
        }

        // Инициализация с настройками для сохранения форматирования
        const inst = window.CKEDITOR.replace(areaIdRef.current, {
          height: 360,
          width: '100%',
          
          // ВАЖНО: Разрешаем любой HTML, чтобы не резались стили и теги
          allowedContent: true,
          
          // Настройка переносов строк
          // ENTER_P = новый абзац <p>, ENTER_BR = перенос строки <br>
          // Обычно ENTER_P лучше для форматирования, но если нужно "как в блокноте" - ставьте ENTER_BR
          enterMode: window.CKEDITOR.ENTER_P, 
          shiftEnterMode: window.CKEDITOR.ENTER_BR,
          
          // Отключаем лишние плагины, если они мешают (опционально)
          removePlugins: 'elementspath,resize', 
          
          // Не добавлять <p>&nbsp;</p> в пустой редактор автоматически (иногда мешает)
          fillEmptyBlocks: false,
          
          // Убираем вкладки, которые обычно не нужны обычному юзеру
          removeDialogTabs: 'image:advanced;link:advanced',
        })

        instRef.current = inst
        
        inst.on('instanceReady', () => {
          if (initialHTML) {
            inst.setData(initialHTML)
          }
        })

        // Синхронизация данных при изменениях (на всякий случай)
        inst.on('change', () => {
           // можно сохранять во временное состояние, если нужно
        })

      } catch (e) {
        console.error('[ModalEditor] CKEditor init error:', e)
        toast('Не удалось инициализировать редактор', 'error')
      }
    }

    init()

    return () => {
      canceled = true
      try { 
        if (instRef.current) instRef.current.destroy() 
      } catch {}
      instRef.current = null
    }
  }, [open])

  // Обновление данных при смене пропса (например, загрузка другого вопроса)
  useEffect(() => {
    if (open && instRef.current && initialHTML !== undefined) {
      // Проверяем, отличается ли контент, чтобы курсор не прыгал, если бы мы это делали на change
      const current = instRef.current.getData()
      if (current !== initialHTML) {
        instRef.current.setData(initialHTML || '')
      }
    }
  }, [initialHTML, open])

  const importFile = async e => {
    const f = e.target.files?.[0]; if (!f) return
    const ext = (f.name.split('.').pop() || '').toLowerCase()
    try {
      if (ext === 'txt') {
        const t = await f.text()
        // Превращаем переносы строк в <br> для HTML
        instRef.current?.setData(`<p>${t.replace(/\n/g,'<br>')}</p>`)
      } else if (ext === 'docx') {
        await ensureMammothCDN()
        const ab = await f.arrayBuffer()
        const res = await window.mammoth.convertToHtml({ arrayBuffer: ab })
        instRef.current?.setData(res.value || '')
      } else {
        toast('Поддерживаются TXT и DOCX','error')
      }
    } catch (err) {
      console.error('[ModalEditor] import error:', err)
      toast('Ошибка импорта файла','error')
    } finally {
      e.target.value = ''
    }
  }

  const handleSave = () => {
    const htmlFromEditor = instRef.current?.getData?.()
    // Если редактор не загрузился, пытаемся взять из textarea
    const raw = document.getElementById(areaIdRef.current)?.value || ''
    const html = (typeof htmlFromEditor === 'string') ? htmlFromEditor : raw
    
    const finalTitle = (protectTitle && lockTitle) ? (initialTitle || '') : (locTitle || '').trim()

    if (requireTitle && !finalTitle) { toast('Введите заголовок','error'); return }
    if (!html || !html.trim()) { toast('Текст пустой','error'); return }
    
    onSave?.({ title: finalTitle, html })
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-editor" onClick={e => e.stopPropagation()} style={{maxWidth: width}}>
        <button className="modal-x" onClick={onClose}>×</button>
        <h3 className="modal-title">{title}</h3>

        <div className="form-row">
          <div style={{ display:'flex', alignItems:'center', gap:12, width:'100%', flexWrap:'wrap' }}>
            <input
              placeholder="Заголовок"
              value={locTitle}
              onChange={e => setLocTitle(e.target.value)}
              disabled={protectTitle && lockTitle}
              style={{ flex:'1 1 260px' }}
            />
            {protectTitle && (
              <label className="agree-line" title="Разрешить редактирование заголовка" style={{whiteSpace:'nowrap'}}>
                <input
                  type="checkbox"
                  checked={!lockTitle}
                  onChange={(e) => setLockTitle(!e.target.checked)}
                />
                <span className="agree-text">Разрешить редактирование</span>
              </label>
            )}
          </div>
        </div>

        <div className="form-row editor-area">
          <textarea id={areaIdRef.current} style={{width:'100%',height:'100%'}} defaultValue=""/>
        </div>

        <div className="form-row two footer-row">
          {allowImport && (
            <label className="btn btn-lite" style={{cursor:'pointer'}}>
              <input ref={fileRef} type="file" hidden accept=".txt,.docx" onChange={importFile}/>
              <span className="label">Загрузить текст (TXT/DOCX)</span>
            </label>
          )}
          <button className="btn" onClick={handleSave}><span className="label">Сохранить</span></button>
        </div>
      </div>
    </div>
  )
}