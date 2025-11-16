import { useEffect, useRef, useState } from 'react'
import { ensureCropper } from '../utils/scriptLoader'
import { toast } from './Toast.jsx'

/**
 * Универсальная модалка кадрирования + очистки белого фона.
 * Props:
 * - open: boolean
 * - src: string (dataURL исходного изображения)
 * - defaultKind: 'signature' | 'sig_seal' | 'round_seal'
 * - defaultThreshold: 0..100 (процент)
 * - onClose(): void
 * - onConfirm(kind: string, dataUrl: string): void
 */
export default function CropModal({
  open,
  src,
  defaultKind = 'signature',
  defaultThreshold = 40,
  onClose,
  onConfirm,
}) {
  const [kind, setKind] = useState(defaultKind)
  const [thresh, setThresh] = useState(defaultThreshold)
  const imgRef = useRef(null)
  const cropperRef = useRef(null)
  const [currentSrc, setCurrentSrc] = useState(src || '')

  useEffect(() => {
    if (!open) return
    setKind(defaultKind)
    setThresh(defaultThreshold)
    setCurrentSrc(src || '')
  }, [open, src, defaultKind, defaultThreshold])

  useEffect(() => {
    if (!open || !currentSrc) return
    let cancelled = false
    ;(async () => {
      try {
        await ensureCropper()
        await new Promise(r => requestAnimationFrame(r))
        if (cancelled) return
        if (cropperRef.current) {
          try { cropperRef.current.destroy() } catch {}
          cropperRef.current = null
        }
        const img = imgRef.current
        if (!img) return
        // eslint-disable-next-line no-undef
        const inst = new Cropper(img, {
          viewMode: 1,
          dragMode: 'move',
          guides: true,
          background: false,
          autoCrop: true,
        })
        cropperRef.current = inst
      } catch (e) {
        // ignore
      }
    })()
    return () => {
      cancelled = true
      if (cropperRef.current) {
        try { cropperRef.current.destroy() } catch {}
        cropperRef.current = null
      }
    }
  }, [open, currentSrc])

  useEffect(() => {
    if (!open || !cropperRef.current || !currentSrc) return
    ;(async () => {
      const thr = Math.round(255 * (thresh / 100))
      try {
        const url = await removeWhiteBackground(currentSrc, thr)
        try { cropperRef.current.replace(url, true) } catch {}
      } catch { /* no-op */ }
    })()
  }, [thresh, open, currentSrc])

  async function removeWhiteBackground(src, threshold = 245) {
    return new Promise((resolve, reject) => {
      try {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          const w = img.naturalWidth || img.width
          const h = img.naturalHeight || img.height
          const c = document.createElement('canvas')
          c.width = w; c.height = h
          const ctx = c.getContext('2d', { willReadFrequently: true })
          try { ctx.textBaseline = 'alphabetic' } catch {}
          ctx.drawImage(img, 0, 0)
          const data = ctx.getImageData(0, 0, w, h)
          const d = data.data
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i+1], b = d[i+2]
            if (r > threshold && g > threshold && b > threshold) {
              d[i+3] = 0
            } else {
              const avg = (r + g + b) / 3
              if (avg > 220) d[i+3] = Math.max(0, d[i+3] - 120)
            }
          }
          ctx.putImageData(data, 0, 0)
          resolve(c.toDataURL('image/png'))
        }
        img.onerror = reject
        img.src = src
      } catch (e) {
        reject(e)
      }
    })
  }

  const confirm = async () => {
    try {
      const cr = cropperRef.current
      if (!cr) return
      const c = cr.getCroppedCanvas({ imageSmoothingEnabled: true, imageSmoothingQuality: 'high' })
      let dataUrl = c.toDataURL('image/png')
      const thr = Math.round(255 * (thresh / 100))
      dataUrl = await removeWhiteBackground(dataUrl, thr)
      onConfirm?.(kind, dataUrl)
    } catch (e) {
      toast(e.message || 'Не удалось обработать изображение', 'error')
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal crop-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>×</button>
        <h3 className="modal-title">1. Выделите область</h3>
        <div className="crop-row">
          <select value={kind} onChange={e => setKind(e.target.value)}>
            <option value="signature">подпись</option>
            <option value="sig_seal">подпись + печать</option>
            <option value="round_seal">круглая печать</option>
          </select>
        </div>
        <div className="crop-area">
          <img ref={imgRef} src={currentSrc} alt="" style={{ maxWidth: '100%', maxHeight: '46vh' }} />
        </div>
        <div className="crop-controls">
          <h4>2. Настройте прозрачность фона:</h4>
          <div className="thr-row">
            <input type="range" min="0" max="100" value={thresh} onChange={e => setThresh(Number(e.target.value))} />
            <input type="number" min="0" max="100" value={thresh} onChange={e => {
              const v = Math.max(0, Math.min(100, Number(e.target.value) || 0))
              setThresh(v)
            }} />
            <span>%</span>
          </div>
          <button className="btn" onClick={confirm}><span className="label">Готово</span></button>
        </div>
      </div>
    </div>
  )
}