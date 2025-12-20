// frontend/src/utils/customCanvasEngine.js

import icDelete from '../assets/icons/x-close.svg'
import icRotate from '../assets/icons/rotate-handle.svg'
import icScale from '../assets/icons/scale-handle.svg'
import icEdit from '../assets/icons/edit-text.svg' // зарезервировано

const deleteImg = new Image()
deleteImg.src = icDelete
const rotateImg = new Image()
rotateImg.src = icRotate
const scaleImg = new Image()
scaleImg.src = icScale
const editImg = new Image()
editImg.src = icEdit

function rotateVec (x, y, c, s) {
  return { x: x * c - y * s, y: x * s + y * c }
}

function rotatePoint (x, y, angleRad) {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return rotateVec(x, y, c, s)
}

function cloneOverlay (ov) {
  if (!ov || typeof ov !== 'object') return ov
  return { ...ov, data: ov.data ? { ...ov.data } : {} }
}

function isDrawable (img) {
  if (!img) return false
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return true
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return true
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) return true
  return false
}

// --- ПРАВИЛО ---
// text overlay НИКОГДА не хранит масштаб в scaleX/scaleY.
// Масштаб текста = fontSize + w/h, scaleX/scaleY всегда 1.
function normalizeTextOverlay (ov) {
  if (!ov || ov.type !== 'text') return ov

  const sx = typeof ov.scaleX === 'number' ? ov.scaleX : 1
  const sy = typeof ov.scaleY === 'number' ? ov.scaleY : 1

  const d = ov.data || (ov.data = {})
  const fs0 = Number(d.fontSize || 48)

  // Если был scale — переносим его в fontSize и геометрию
  if (sx !== 1 || sy !== 1) {
    const fs1 = Math.max(6, Math.round(fs0 * (sy || 1)))
    ov.w = Math.max(1, Number(ov.w || 1) * (sx || 1))
    ov.h = Math.max(1, Number(ov.h || 1) * (sy || 1))
    d.fontSize = fs1
  } else {
    d.fontSize = Math.max(6, Math.round(fs0))
  }

  ov.scaleX = 1
  ov.scaleY = 1
  return ov
}

function cloneOverlaysDeep (arr) {
  return (arr || []).map(o => ({ ...o, data: { ...(o.data || {}) } }))
}

export class CustomCanvasEngine {
  constructor (canvas, opts = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')

    this.onBeforeOverlayChange = opts.onBeforeOverlayChange || (() => {})
    this.onOverlayChange = opts.onOverlayChange || (() => {})
    this.onOverlayDelete = opts.onOverlayDelete || (() => {})
    this.onSelectionChange = opts.onSelectionChange || (() => {})
    this.onTextEditRequest = opts.onTextEditRequest || (() => {})
    this.onBlankClick = opts.onBlankClick || (() => {})
    this.onInteractionEnd = opts.onInteractionEnd || (() => {})

    this.docWidth = 1000
    this.docHeight = 1414
    this.backgroundImage = null
    this.overlays = []

    this.rotation = 0
    this.pageWidth = this.docWidth
    this.pageHeight = this.docHeight

    const isMobileInitial =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 960px)').matches

    this.rotationAffectsTransform = isMobileInitial

    this.viewWidth = canvas.clientWidth || canvas.width || 1
    this.viewHeight = canvas.clientHeight || canvas.height || 1
    this.pixelRatio = Math.max(window.devicePixelRatio || 1, 2)
    this.viewMargin = typeof opts.viewMargin === 'number' ? Math.max(0, opts.viewMargin) : 24

    this.scale = 1
    this.offsetX = 0
    this.offsetY = 0

    this.activeId = null
    this.activeHandle = null
    this.dragState = null
    this.isPointerDown = false
    this.pointerId = null
    this._lastControlPositions = null
    this._cursor = 'default'

    this.editingId = null

    this.handleRadius = isMobileInitial ? 16 : 14
    this.hitRadius = isMobileInitial ? 34 : 28
    this.borderColor = '#3C6FD8'
    this.handleFill = '#FFFFFF'
    this.handleStroke = '#E26D5C'

    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerMove = this._onPointerMove.bind(this)
    this._onPointerUp = this._onPointerUp.bind(this)
    this._onPointerCancel = this._onPointerCancel.bind(this)

    this._attachEvents()
    this.resize(this.viewWidth, this.viewHeight)
  }

  destroy () {
    this._detachEvents()
  }

  _attachEvents () {
    this.canvas.addEventListener('pointerdown', this._onPointerDown)
    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('pointerup', this._onPointerUp)
    window.addEventListener('pointercancel', this._onPointerCancel)
  }

  _detachEvents () {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerup', this._onPointerUp)
    window.removeEventListener('pointercancel', this._onPointerCancel)
  }

  // =============================================================================
  // Public helper API (используется Editor.jsx)
  // =============================================================================

  computePageSize (docW, docH, rotation = 0) {
    const W = Number(docW || 1000)
    const H = Number(docH || 1414)
    const rot = rotation === 90 ? 90 : 0
    if (rot === 0) return { pageW: W, pageH: H }
    if (W > 0) return { pageW: (H * H) / W, pageH: H }
    return { pageW: H, pageH: H }
  }

  // bounds в doc-координатах для конкретной страницы (rotation влияет только на page size,
  // но сам bounds зависит лишь от ov и его scale/angle)
  getOverlayDocBoundsForPage (ov, docW, docH, rotation = 0) {
    return this._getOverlayDocBounds(ov)
  }

  // Попытаться сдвинуть overlay внутрь листа.
  clampOverlayToPage (ov, docW, docH, rotation = 0) {
    const safe = { ...ov, data: { ...(ov?.data || {}) } }
    if (safe?.type === 'text') normalizeTextOverlay(safe)

    const { pageW, pageH } = this.computePageSize(docW, docH, rotation)
    const rect = this._pageRect(docW, docH, pageW, pageH)

    const b0 = this._getOverlayDocBounds(safe)
    if (b0.w > pageW + 0.5 || b0.h > pageH + 0.5) {
      return { ok: false, overlay: safe }
    }

    let dx = 0
    let dy = 0
    if (b0.minX < rect.left) dx = rect.left - b0.minX
    if (b0.maxX > rect.right) dx = rect.right - b0.maxX
    if (b0.minY < rect.top) dy = rect.top - b0.minY
    if (b0.maxY > rect.bottom) dy = rect.bottom - b0.maxY
    safe.cx = Number(safe.cx || 0) + dx
    safe.cy = Number(safe.cy || 0) + dy

    const b1 = this._getOverlayDocBounds(safe)
    const eps = 0.5
    const ok =
      b1.minX >= rect.left - eps &&
      b1.maxX <= rect.right + eps &&
      b1.minY >= rect.top - eps &&
      b1.maxY <= rect.bottom + eps

    return { ok, overlay: safe }
  }

  // =============================================================================
  // Public API
  // =============================================================================

  setDocument (doc) {
    const prevActive = this.activeId

    this.docWidth = doc.docWidth || 1000
    this.docHeight = doc.docHeight || 1414
    this.backgroundImage = doc.backgroundImage || null

    const incoming = cloneOverlaysDeep(doc.overlays || [])
    for (const ov of incoming) normalizeTextOverlay(ov)

    this.overlays = incoming
    this.rotation = doc.rotation === 90 ? 90 : 0

    this._updatePageSize()
    this._updateTransform()

    if (prevActive && this.overlays.some(o => o.id === prevActive)) {
      this.activeId = prevActive
    } else {
      this.activeId = null
    }
    this._draw()
  }

  setOverlays (overlays) {
    const incoming = cloneOverlaysDeep(overlays || [])
    for (const ov of incoming) normalizeTextOverlay(ov)

    this.overlays = incoming
    if (this.activeId && !this.overlays.find(o => o.id === this.activeId)) {
      this.activeId = null
      this.onSelectionChange(null)
    }
    this._draw()
  }

  setEditingOverlayId (id) {
    this.editingId = id || null
    this._draw()
  }

  getOverlays () {
    return this.overlays.map(cloneOverlay)
  }

  getOverlayScreenBoundsById (id) {
    const ov = this.overlays.find(o => o.id === id)
    return ov ? this._getOverlayScreenBounds(ov) : null
  }

  setPageRotation (rotation, recalcTransform = false) {
    const newRot = rotation === 90 ? 90 : 0
    if (this.rotation === newRot && !recalcTransform) return

    this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))

    const prevRotation = this.rotation
    this.rotation = newRot
    if (recalcTransform) this.rotationAffectsTransform = true

    this._updatePageSize()

    if (recalcTransform) {
      const prevScale = this.scale || 1
      this._updateTransform()
      const newScale = this.scale || 1
      const k = newScale ? prevScale / newScale : 1

      if (k && k !== 1) {
        for (const ov of this.overlays) {
          if (ov.type === 'text') {
            const d = ov.data || (ov.data = {})
            const fs = Math.max(6, Math.round(Number(d.fontSize || 48) * k))
            d.fontSize = fs
            ov.w = Math.max(1, Number(ov.w || 1) * k)
            ov.h = Math.max(1, Number(ov.h || 1) * k)
            ov.scaleX = 1
            ov.scaleY = 1
          } else {
            ov.scaleX = (ov.scaleX || 1) * k
            ov.scaleY = (ov.scaleY || 1) * k
          }
        }
      }
    } else {
      this._updateTransform()
    }

    // 90 -> 0: автоужатие по размеру листа
    if (prevRotation === 90 && this.rotation === 0) {
      const maxW = (this.pageWidth || this.docWidth) - 4
      const maxH = (this.pageHeight || this.docHeight) - 4

      for (const ov of this.overlays) {
        const b = this._getOverlayDocBounds(ov)
        const bw = Math.max(1e-6, b.w)
        const bh = Math.max(1e-6, b.h)
        const factor = Math.min(maxW / bw, maxH / bh, 1)

        if (factor < 1) {
          if (ov.type === 'text') {
            const d = ov.data || (ov.data = {})
            const fs0 = Number(d.fontSize || 48)
            const fs1 = Math.max(6, Math.round(fs0 * factor))
            const real = fs0 ? (fs1 / fs0) : factor
            d.fontSize = fs1
            ov.w = Math.max(1, Number(ov.w || 1) * real)
            ov.h = Math.max(1, Number(ov.h || 1) * real)
            ov.scaleX = 1
            ov.scaleY = 1
          } else {
            ov.scaleX = (ov.scaleX || 1) * factor
            ov.scaleY = (ov.scaleY || 1) * factor
          }
        }
      }
    }

    for (const ov of this.overlays) {
      normalizeTextOverlay(ov)
      this._clampOverlay(ov)
      this.onOverlayChange(cloneOverlay(ov))
    }

    this._draw()
    this.onInteractionEnd(this.overlays.map(cloneOverlay))
  }

  setMode (isMobile) {
    this.rotationAffectsTransform = !!isMobile
    this.handleRadius = isMobile ? 16 : 14
    this.hitRadius = isMobile ? 34 : 28
    this._updateTransform()
    this._draw()
  }

  resize (width, height) {
    const safeW = Math.max(1, Math.floor(width || 0))
    const safeH = Math.max(1, Math.floor(height || 0))

    this.viewWidth = safeW
    this.viewHeight = safeH
    this.pixelRatio = Math.max(window.devicePixelRatio || 1, 2)

    this.canvas.width = Math.floor(safeW * this.pixelRatio)
    this.canvas.height = Math.floor(safeH * this.pixelRatio)
    this.canvas.style.width = `${safeW}px`
    this.canvas.style.height = `${safeH}px`

    this._updateTransform()
    this._draw()
  }

  setViewMargin (marginPx) {
    this.viewMargin = Math.max(0, marginPx || 0)
    this._updateTransform()
    this._draw()
  }

  // =============================================================================
  // Geometry & rendering internals
  // =============================================================================

  _updatePageSize () {
    const W = this.docWidth
    const H = this.docHeight
    if (this.rotation === 0) {
      this.pageWidth = W
      this.pageHeight = H
    } else {
      if (W > 0) {
        this.pageHeight = H
        this.pageWidth = (H * H) / W
      } else {
        this.pageHeight = H
        this.pageWidth = H
      }
    }
  }

  _updateTransform () {
    const W = this.docWidth
    const H = this.docHeight
    const cw = this.viewWidth
    const ch = this.viewHeight
    const margin = this.viewMargin || 0

    const isMobileLandscape = this.rotationAffectsTransform && this.rotation === 90

    const extraVerticalMargin = isMobileLandscape ? ch * 0.12 : 0
    const availW0 = Math.max(10, cw - margin * 2)
    const availH0 = Math.max(10, ch - margin - extraVerticalMargin)

    let fitW = availW0
    let fitH = availH0

    if (this.rotationAffectsTransform && this.rotation === 90) {
      const tmp = fitW
      fitW = fitH
      fitH = tmp
    }

    let scale = Math.min(fitW / W, fitH / H) || 1
    let actualW = W * scale
    let actualH = H * scale

    const pageW = this.pageWidth || W
    const maxPageW = cw - margin * 2
    if (pageW * scale > maxPageW) {
      scale = maxPageW / pageW
      actualW = W * scale
      actualH = H * scale
    }

    this.scale = scale
    this.offsetX = (cw - actualW) / 2
    this.offsetY = (ch - actualH) / 2
  }

  _docToScreen (x, y) {
    const s = this.scale
    return { x: this.offsetX + x * s, y: this.offsetY + y * s }
  }

  _screenToDoc (sx, sy) {
    const s = this.scale
    return { x: (sx - this.offsetX) / s, y: (sy - this.offsetY) / s }
  }

  _clear () {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  _draw () {
    const ctx = this.ctx
    this._clear()

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const dpr = this.pixelRatio || 1
    const W = this.docWidth
    const H = this.docHeight
    const pageW = this.pageWidth || W
    const pageH = this.pageHeight || H
    const s = this.scale

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.translate(this.offsetX, this.offsetY)
    ctx.scale(s, s)

    const docCx = W / 2
    const docCy = H / 2
    const halfPW = pageW / 2
    const halfPH = pageH / 2

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(docCx - halfPW, docCy - halfPH, pageW, pageH)

    if (isDrawable(this.backgroundImage)) {
      ctx.drawImage(this.backgroundImage, 0, 0, W, H)
    }

    for (const ov of this.overlays) {
      this._drawOverlay(ov)
    }

    const active = this.overlays.find(o => o.id === this.activeId)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (active) {
      this._drawOverlayControls(active)
    }
  }

  _drawOverlay (ov) {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(ov.cx, ov.cy)
    ctx.rotate(ov.angleRad || 0)

    if (ov.type === 'text') {
      ctx.scale(1, 1)
    } else {
      ctx.scale(ov.scaleX || 1, ov.scaleY || 1)
    }

    const halfW = ov.w / 2
    const halfH = ov.h / 2

    if (ov.type === 'image') {
      const img = ov.data?.image
      if (isDrawable(img)) {
        ctx.drawImage(img, -halfW, -halfH, ov.w, ov.h)
      }
    } else if (ov.type === 'text') {
      const d = ov.data || {}
      if (this.editingId === ov.id) {
        ctx.restore()
        return
      }

      ctx.fillStyle = d.fill || '#000000'
      const fw = d.fontWeight || 'bold'
      const fs = d.fontStyle || 'normal'
      const sz = Math.max(6, Math.round(Number(d.fontSize || 48)))
      const fam = d.fontFamily || 'Arial'
      ctx.font = `${fs} ${fw} ${sz}px ${fam}`

      const align = d.textAlign || 'left'
      ctx.textAlign = align

      // Рисуем от верха, как в HTML textarea
      ctx.textBaseline = 'top'

      let xPos = 0
      if (align === 'left') xPos = -halfW
      else if (align === 'right') xPos = halfW
      else if (align === 'center') xPos = 0

      const text = String(d.text || '')
      const lines = text.split('\n')

      // Множитель 1.0 (компактно)
      const lh = sz * 1
      const totalH = lines.length * lh

      // Старт с самого верха
      let currentY = -totalH / 2

      for (const line of lines) {
        ctx.fillText(line, xPos, currentY)
        currentY += lh
      }
    }

    ctx.restore()
  }

  _drawOverlayControls (ov) {
    const ctx = this.ctx
    const s = this.scale
    const sc = this._docToScreen(ov.cx, ov.cy)

    const sx = ov.type === 'text' ? 1 : (ov.scaleX || 1)
    const sy = ov.type === 'text' ? 1 : (ov.scaleY || 1)

    const halfW = (ov.w * sx * s) / 2
    const halfH = (ov.h * sy * s) / 2
    const ang = ov.angleRad || 0
    const c = Math.cos(ang)
    const si = Math.sin(ang)

    const toGlobal = (lx, ly) => {
      const rx = lx * c - ly * si
      const ry = lx * si + ly * c
      return { x: sc.x + rx, y: sc.y + ry }
    }

    const pTL = toGlobal(-halfW, -halfH)
    const pTR = toGlobal(halfW, -halfH)
    const pBR = toGlobal(halfW, halfH)
    const pBL = toGlobal(-halfW, halfH)

    ctx.beginPath()
    ctx.moveTo(pTL.x, pTL.y)
    ctx.lineTo(pTR.x, pTR.y)
    ctx.lineTo(pBR.x, pBR.y)
    ctx.lineTo(pBL.x, pBL.y)
    ctx.closePath()
    ctx.strokeStyle = this.borderColor
    ctx.lineWidth = 1.5
    ctx.stroke()

    const hr = this.handleRadius
    const drawBtn = (pos, kind) => {
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, hr, 0, Math.PI * 2)
      ctx.fillStyle = this.handleFill
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = this.handleStroke
      ctx.stroke()

      let img = null
      if (kind === 'delete') img = deleteImg
      else if (kind === 'rotate') img = rotateImg
      else if (kind === 'scale') img = scaleImg
      else if (kind === 'edit') img = editImg

      if (img && img.complete) {
        const sz = hr * 1.2
        ctx.drawImage(img, pos.x - sz / 2, pos.y - sz / 2, sz, sz)
      }
    }

    const offset = 24

    const pRotate = toGlobal(0, -halfH - offset - 10)
    drawBtn(pRotate, 'rotate')

    const pDelete = toGlobal(halfW + offset, -halfH - offset)
    drawBtn(pDelete, 'delete')

    const pScale = toGlobal(-halfW - offset, halfH + offset)
    drawBtn(pScale, 'scale')

    this._lastControlPositions = { rotate: pRotate, delete: pDelete, scale: pScale, edit: null }
  }

  // =============================================================================
  // Hit testing / pointer
  // =============================================================================

  _getPointerPos (evt) {
    const rect = this.canvas.getBoundingClientRect()
    return { sx: evt.clientX - rect.left, sy: evt.clientY - rect.top }
  }

  _hitHandle (sx, sy) {
    const pos = this._lastControlPositions
    if (!pos || !this.activeId) return null
    const r2 = this.hitRadius * this.hitRadius

    const check = p => {
      if (!p) return false
      const dx = sx - p.x
      const dy = sy - p.y
      return dx * dx + dy * dy <= r2
    }

    if (check(pos.rotate)) return 'rotate'
    if (check(pos.delete)) return 'delete'
    if (check(pos.scale)) return 'scale'
    return null
  }

  _hitOverlay (sx, sy) {
    for (let i = this.overlays.length - 1; i >= 0; i--) {
      const ov = this.overlays[i]
      if (this._pointInOverlay(ov, sx, sy)) return ov
    }
    return null
  }

  _pointInOverlay (ov, sx, sy) {
    const { x: dx, y: dy } = this._screenToDoc(sx, sy)
    const lx = dx - ov.cx
    const ly = dy - ov.cy
    const ang = -(ov.angleRad || 0)
    const rp = rotateVec(lx, ly, Math.cos(ang), Math.sin(ang))

    const sxOv = ov.type === 'text' ? 1 : (ov.scaleX || 1)
    const syOv = ov.type === 'text' ? 1 : (ov.scaleY || 1)

    const w = ov.w * sxOv
    const h = ov.h * syOv
    const halfW = w / 2
    const halfH = h / 2
    return rp.x >= -halfW && rp.x <= halfW && rp.y >= -halfH && rp.y <= halfH
  }

  _setCursor (cursor) {
    if (this._cursor === cursor) return
    this._cursor = cursor
    this.canvas.style.cursor = cursor
  }

  handleExternalPointerDown (evt) {
    const active = this.overlays.find(o => o.id === this.activeId)
    if (!active) return
    evt.preventDefault()
    const { sx, sy } = this._getPointerPos(evt)

    this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))
    this.isPointerDown = true
    this.pointerId = typeof evt.pointerId === 'number' ? evt.pointerId : null
    this.activeHandle = 'move'
    this.dragState = {
      startScreen: { sx, sy },
      startDoc: this._screenToDoc(sx, sy),
      startOverlay: cloneOverlay(active)
    }
    this._setCursor('grabbing')
  }

  _onPointerDown (evt) {
    if (evt.target === this.canvas) evt.preventDefault()
    if (evt.button !== 0) return

    if (this.isPointerDown && this.pointerId != null && evt.pointerId !== this.pointerId) return

    const { sx, sy } = this._getPointerPos(evt)
    this.isPointerDown = true
    this.pointerId = typeof evt.pointerId === 'number' ? evt.pointerId : null

    const handle = this._hitHandle(sx, sy)
    const active = this.overlays.find(o => o.id === this.activeId)

    if (handle && active) {
      this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))

      if (handle === 'delete') {
        if (window.confirm('Удалить объект?')) {
          const id = active.id
          this.overlays = this.overlays.filter(o => o.id !== id)
          this.activeId = null
          this.onSelectionChange(null)
          this._draw()
          this.onOverlayDelete(id)
          this.onInteractionEnd(this.overlays.map(cloneOverlay))
        }
        this.isPointerDown = false
        this.pointerId = null
        this._setCursor('default')
        return
      }

      this.activeHandle = handle
      this.dragState = {
        startScreen: { sx, sy },
        startDoc: this._screenToDoc(sx, sy),
        startOverlay: cloneOverlay(active)
      }
      this._setCursor(handle === 'rotate' ? 'crosshair' : 'grabbing')
      return
    }

    const ov = this._hitOverlay(sx, sy)
    if (ov) {
      this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))
      this.activeId = ov.id
      this.onSelectionChange(cloneOverlay(ov))
      this.activeHandle = 'move'
      this.dragState = {
        startScreen: { sx, sy },
        startDoc: this._screenToDoc(sx, sy),
        startOverlay: cloneOverlay(ov)
      }
      this._setCursor('grabbing')
      this._draw()

      if (ov.type === 'text') {
        try {
          const bounds = this._getOverlayScreenBounds(ov)
          this.onTextEditRequest(cloneOverlay(ov), bounds)
        } catch {}
      }
    } else {
      if (this.activeId) {
        this.activeId = null
        this.onSelectionChange(null)
        this._draw()
      }
      this._setCursor('default')
      try { this.onBlankClick() } catch {}
    }
  }

  _onPointerMove (evt) {
    if (this.pointerId != null && evt.pointerId !== this.pointerId) return

    if (this.isPointerDown && this.activeHandle) evt.preventDefault()

    const { sx, sy } = this._getPointerPos(evt)

    if (!this.isPointerDown || !this.activeHandle || !this.dragState) {
      const handle = this._hitHandle(sx, sy)
      if (handle === 'rotate') this._setCursor('crosshair')
      else if (['delete', 'scale'].includes(handle)) this._setCursor('pointer')
      else if (this._hitOverlay(sx, sy)) this._setCursor('move')
      else this._setCursor('default')
      return
    }

    const active = this.overlays.find(o => o.id === this.activeId)
    if (!active) return

    if (this.activeHandle === 'move') this._handleMove(active, sx, sy)
    else if (this.activeHandle === 'scale') this._handleScale(active, sx, sy)
    else if (this.activeHandle === 'rotate') this._handleRotate(active, sx, sy)

    normalizeTextOverlay(active)

    this._draw()
    this.onOverlayChange(cloneOverlay(active))
  }

  _onPointerUp (evt) {
    if (this.pointerId != null && evt.pointerId !== this.pointerId) return
    if (!this.isPointerDown) return

    this.isPointerDown = false
    const wasActive = this.activeHandle

    this.activeHandle = null
    this.dragState = null
    this.pointerId = null
    this._setCursor('default')

    if (wasActive) {
      const active = this.overlays.find(o => o.id === this.activeId)
      if (active) {
        normalizeTextOverlay(active)
        this._clampOverlay(active)
        this._draw()
        this.onOverlayChange(cloneOverlay(active))
        this.onInteractionEnd(this.overlays.map(cloneOverlay))
      }
    }
  }

  _onPointerCancel (evt) {
    if (this.pointerId != null && evt.pointerId !== this.pointerId) return
    if (this.isPointerDown) {
      this.isPointerDown = false
      this.activeHandle = null
      this.dragState = null
      this.pointerId = null
      this._setCursor('default')
    }
  }

  // =============================================================================
  // Transform handlers
  // =============================================================================

  _handleMove (ov, sx, sy) {
    const start = this.dragState.startOverlay
    const startDoc = this.dragState.startDoc
    const curDoc = this._screenToDoc(sx, sy)
    ov.cx = start.cx + (curDoc.x - startDoc.x)
    ov.cy = start.cy + (curDoc.y - startDoc.y)
    this._clampOverlay(ov)
  }

  _handleScale (ov, sx, sy) {
    const start = this.dragState.startOverlay
    const center = { x: start.cx, y: start.cy }
    const startDoc = this.dragState.startDoc
    const curDoc = this._screenToDoc(sx, sy)

    const distStart = Math.hypot(startDoc.x - center.x, startDoc.y - center.y) || 1
    const distCur = Math.hypot(curDoc.x - center.x, curDoc.y - center.y) || 1
    let desired = distCur / distStart
    desired = Math.max(0.1, Math.min(5, desired))

    // ограничиваем factor, чтобы оверлей помещался (без сдвига центра)
    const factor = this._limitScaleFactorToPage(start, desired)

    if (ov.type === 'text') {
      const d = ov.data || (ov.data = {})
      const oldFs = Number(start.data?.fontSize || 48)
      const newFs = Math.max(6, Math.round(oldFs * factor))
      const realFactor = oldFs ? (newFs / oldFs) : factor

      d.fontSize = newFs
      ov.w = Math.max(1, Number(start.w || 1) * realFactor)
      ov.h = Math.max(1, Number(start.h || 1) * realFactor)
      ov.scaleX = 1
      ov.scaleY = 1
    } else {
      ov.scaleX = (start.scaleX || 1) * factor
      ov.scaleY = (start.scaleY || 1) * factor
    }

    this._clampOverlay(ov)
  }

  _handleRotate (ov, sx, sy) {
    const { x, y } = this._screenToDoc(sx, sy)
    const dx = x - ov.cx
    const dy = y - ov.cy
    ov.angleRad = Math.atan2(dy, dx) + Math.PI / 2
    this._clampOverlay(ov)
  }

  _limitScaleFactorToPage (startOverlay, desiredFactor) {
    if (desiredFactor <= 1) return desiredFactor

    const pageW = this.pageWidth || this.docWidth
    const pageH = this.pageHeight || this.docHeight
    const rect = this._pageRect(this.docWidth, this.docHeight, pageW, pageH)

    const fits = (f) => {
      const sim = { ...startOverlay, data: { ...(startOverlay.data || {}) } }
      if (sim.type === 'text') {
        const d = sim.data || (sim.data = {})
        const fs0 = Number(d.fontSize || 48)
        const fs1 = Math.max(6, Math.round(fs0 * f))
        const real = fs0 ? (fs1 / fs0) : f
        d.fontSize = fs1
        sim.w = Math.max(1, Number(sim.w || 1) * real)
        sim.h = Math.max(1, Number(sim.h || 1) * real)
        sim.scaleX = 1
        sim.scaleY = 1
      } else {
        sim.scaleX = (sim.scaleX || 1) * f
        sim.scaleY = (sim.scaleY || 1) * f
      }

      const b = this._getOverlayDocBounds(sim)
      const eps = 0.5
      return (
        b.minX >= rect.left - eps &&
        b.maxX <= rect.right + eps &&
        b.minY >= rect.top - eps &&
        b.maxY <= rect.bottom + eps
      )
    }

    if (fits(desiredFactor)) return desiredFactor

    let lo = 0.1
    let hi = desiredFactor
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) lo = mid
      else hi = mid
    }
    return Math.max(0.1, Math.min(desiredFactor, lo))
  }

  // =============================================================================
  // Page rect / bounds / clamp
  // =============================================================================

  _pageRect (docW, docH, pageW, pageH) {
    const W = Number(docW || 1000)
    const H = Number(docH || 1414)
    const pW = Number(pageW || W)
    const pH = Number(pageH || H)
    const docCx = W / 2
    const docCy = H / 2
    return {
      left: docCx - pW / 2,
      right: docCx + pW / 2,
      top: docCy - pH / 2,
      bottom: docCy + pH / 2
    }
  }

  _clampOverlay (ov) {
    const pageW = this.pageWidth || this.docWidth
    const pageH = this.pageHeight || this.docHeight
    const rect = this._pageRect(this.docWidth, this.docHeight, pageW, pageH)

    const bounds = this._getOverlayDocBounds(ov)
    let dx = 0
    let dy = 0
    if (bounds.minX < rect.left) dx = rect.left - bounds.minX
    if (bounds.maxX > rect.right) dx = rect.right - bounds.maxX
    if (bounds.minY < rect.top) dy = rect.top - bounds.minY
    if (bounds.maxY > rect.bottom) dy = rect.bottom - bounds.maxY
    ov.cx = Number(ov.cx || 0) + dx
    ov.cy = Number(ov.cy || 0) + dy
  }

  _getOverlayDocBounds (ov) {
    const sx = ov.type === 'text' ? 1 : (ov.scaleX || 1)
    const sy = ov.type === 'text' ? 1 : (ov.scaleY || 1)

    const w = Number(ov.w || 0) * sx
    const h = Number(ov.h || 0) * sy
    const ang = ov.angleRad || 0
    const hw = w / 2
    const hh = h / 2
    const corners = [
      rotatePoint(-hw, -hh, ang),
      rotatePoint(hw, -hh, ang),
      rotatePoint(hw, hh, ang),
      rotatePoint(-hw, hh, ang)
    ].map(p => ({ x: p.x + Number(ov.cx || 0), y: p.y + Number(ov.cy || 0) }))

    let minX = corners[0].x
    let maxX = corners[0].x
    let minY = corners[0].y
    let maxY = corners[0].y
    for (const p of corners) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY }
  }

  _getOverlayScreenBounds (ov) {
    const s = this.scale
    const center = this._docToScreen(ov.cx, ov.cy)

    const sx = ov.type === 'text' ? 1 : (ov.scaleX || 1)
    const sy = ov.type === 'text' ? 1 : (ov.scaleY || 1)

    const wLocal = ov.w * sx * s
    const hLocal = ov.h * sy * s

    const db = this._getOverlayDocBounds(ov)
    const p1 = this._docToScreen(db.minX, db.minY)
    const p2 = this._docToScreen(db.maxX, db.maxY)

    const effFontScale = s

    return {
      cx: center.x,
      cy: center.y,
      w: wLocal,
      h: hLocal,
      angleRad: ov.angleRad || 0,
      fontSize: Math.max(6, Math.round(Number(ov.data?.fontSize || 48) * effFontScale)),
      bbox: { x: p1.x, y: p1.y, w: p2.x - p1.x, h: p2.y - p1.y }
    }
  }

  getDocumentScreenRect () {
    const s = this.scale
    const pageW = this.pageWidth || this.docWidth
    const pageH = this.pageHeight || this.docHeight
    const docCx = this.docWidth / 2
    const docCy = this.docHeight / 2
    const centerScreen = this._docToScreen(docCx, docCy)
    return {
      x: centerScreen.x - (pageW * s) / 2,
      y: centerScreen.y - (pageH * s) / 2,
      width: pageW * s,
      height: pageH * s
    }
  }

  // =============================================================================
  // Add overlays
  // =============================================================================

  addImageOverlay (img, data = {}) {
    if (!isDrawable(img)) return
    this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))

    const id = data.id || `im_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const w = img.width || img.naturalWidth || 200
    const h = img.height || img.naturalHeight || 100
    const ov = {
      id,
      type: 'image',
      cx: this.docWidth / 2,
      cy: this.docHeight / 2,
      w,
      h,
      scaleX: 1,
      scaleY: 1,
      angleRad: 0,
      data: { src: data.src || null, image: img }
    }

    this.overlays.push(ov)
    this.activeId = id
    this._clampOverlay(ov)
    this.onSelectionChange(cloneOverlay(ov))
    this._draw()
    this.onOverlayChange(cloneOverlay(ov))
    this.onInteractionEnd(this.overlays.map(cloneOverlay))
  }

  addTextOverlay (text = 'Текст', opts = {}) {
    this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))

    const id = opts.id || `tb_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const fontSize = Math.max(6, Math.round(Number(opts.fontSize || 48)))
    // Множитель 1
    const lh = fontSize * 1
    const h = lh

    const ov = {
      id,
      type: 'text',
      cx: this.docWidth / 2,
      cy: this.docHeight / 2,
      w: opts.width || 400,
      h: opts.height || h,
      scaleX: 1,
      scaleY: 1,
      angleRad: 0,
      data: {
        text,
        fontSize,
        fontFamily: opts.fontFamily || 'Arial',
        fontWeight: opts.fontWeight || 'bold',
        fontStyle: opts.fontStyle || 'normal',
        fill: opts.fill || '#000000',
        textAlign: opts.textAlign || 'left'
      }
    }

    normalizeTextOverlay(ov)

    this.overlays.push(ov)
    this.activeId = id
    this._clampOverlay(ov)
    this.onSelectionChange(cloneOverlay(ov))
    this._draw()
    this.onOverlayChange(cloneOverlay(ov))
    this.onInteractionEnd(this.overlays.map(cloneOverlay))

    try {
      const bounds = this._getOverlayScreenBounds(ov)
      this.onTextEditRequest(cloneOverlay(ov), bounds)
    } catch {}
  }
}

export default CustomCanvasEngine