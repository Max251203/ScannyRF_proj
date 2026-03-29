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

// Совпадает с LH_FACTOR в Editor.jsx
const LH_FACTOR = 1

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

// text overlay НИКОГДА не хранит масштаб в scaleX/scaleY.
function normalizeTextOverlay (ov) {
  if (!ov || ov.type !== 'text') return ov

  const sx = typeof ov.scaleX === 'number' ? ov.scaleX : 1
  const sy = typeof ov.scaleY === 'number' ? ov.scaleY : 1

  const d = ov.data || (ov.data = {})
  const fs0 = Number(d.fontSize || 48)

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
    this.onLimit = opts.onLimit || (() => {})

    // docWidth/docHeight = размеры ХОЛСТА (рабочей области)
    this.docWidth = 1000
    this.docHeight = 1414

    // contentWidth/contentHeight = размеры КОНТЕНТА внутри холста
    this.contentWidth = 1000
    this.contentHeight = 1414
    this.contentOffsetX = 0
    this.contentOffsetY = 0

    this.backgroundImage = null
    this.backgroundGray = false
    this.overlays = []

    this.viewWidth = canvas.clientWidth || canvas.width || 1
    this.viewHeight = canvas.clientHeight || canvas.height || 1
    this.pixelRatio = Math.max(window.devicePixelRatio || 1, 2)
    this.viewMargin = typeof opts.viewMargin === 'number' ? Math.max(0, opts.viewMargin) : 24

    this.viewportInsets = {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    }

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

    const isMobileInitial =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 960px)').matches

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

  // ---------------------------------------------------------------------------
  // Public helpers
  // ---------------------------------------------------------------------------

  setViewportInsets (insets = {}) {
    this.viewportInsets = {
      top: Math.max(0, Number(insets.top || 0)),
      right: Math.max(0, Number(insets.right || 0)),
      bottom: Math.max(0, Number(insets.bottom || 0)),
      left: Math.max(0, Number(insets.left || 0))
    }
    this._updateTransform()
    this._draw()
  }

  getContentRect () {
    return {
      x: this.contentOffsetX,
      y: this.contentOffsetY,
      w: this.contentWidth,
      h: this.contentHeight
    }
  }

  getOverlayDocBoundsForPage (ov, canvasW, canvasH) {
    return this._getOverlayDocBounds(ov)
  }

  clampOverlayToPage (ov, canvasW = this.docWidth, canvasH = this.docHeight) {
    const safe = { ...ov, data: { ...(ov?.data || {}) } }
    if (safe?.type === 'text') normalizeTextOverlay(safe)

    const rect = {
      left: 0,
      right: Math.max(1, Number(canvasW || this.docWidth || 1)),
      top: 0,
      bottom: Math.max(1, Number(canvasH || this.docHeight || 1))
    }

    const b0 = this._getOverlayDocBounds(safe)
    const w0 = b0.w
    const h0 = b0.h

    if (w0 > rect.right - rect.left + 0.5 || h0 > rect.bottom - rect.top + 0.5) {
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

  _fitOverlayIntoCanvas (ov, fill = 1) {
    const maxW = Math.max(1, this.docWidth * fill - 4)
    const maxH = Math.max(1, this.docHeight * fill - 4)
    const b = this._getOverlayDocBounds(ov)
    const factor = Math.min(
      maxW / Math.max(b.w, 1e-6),
      maxH / Math.max(b.h, 1e-6),
      1
    )

    if (factor >= 1) return ov

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

    return ov
  }

  _limitScaleFactorToPage (startOverlay, desiredFactor) {
    if (desiredFactor <= 1) return desiredFactor

    const pageW = this.docWidth
    const pageH = this.docHeight

    const b0 = this._getOverlayDocBounds(startOverlay)
    const w0 = b0.w
    const h0 = b0.h

    if (!w0 || !h0) return desiredFactor

    const maxFactorW = pageW / w0
    const maxFactorH = pageH / h0
    let fMax = Math.min(maxFactorW, maxFactorH)

    if (!isFinite(fMax) || fMax <= 0) {
      return 1
    }

    fMax = Math.max(0.1, fMax)
    return Math.min(desiredFactor, fMax)
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  setDocument (doc) {
    const prevActive = this.activeId

    this.docWidth = Math.max(1, Number(doc.canvasWidth || doc.docWidth || 1000))
    this.docHeight = Math.max(1, Number(doc.canvasHeight || doc.docHeight || 1414))

    this.contentWidth = Math.max(
      1,
      Number(doc.contentWidth || doc.content_w || doc.backgroundWidth || this.docWidth)
    )
    this.contentHeight = Math.max(
      1,
      Number(doc.contentHeight || doc.content_h || doc.backgroundHeight || this.docHeight)
    )

    // гарантируем, что контент физически не больше холста
    this.docWidth = Math.max(this.docWidth, this.contentWidth)
    this.docHeight = Math.max(this.docHeight, this.contentHeight)

    this._updateContentRect()

    this.backgroundImage = doc.backgroundImage || null
    this.backgroundGray = !!doc.bwContent

    const incoming = cloneOverlaysDeep(doc.overlays || [])
    for (const ov of incoming) normalizeTextOverlay(ov)

    this.overlays = incoming
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

  setMode (isMobile) {
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

  // ---------------------------------------------------------------------------
  // Geometry & rendering
  // ---------------------------------------------------------------------------

  _updateContentRect () {
    this.contentOffsetX = (this.docWidth - this.contentWidth) / 2
    this.contentOffsetY = (this.docHeight - this.contentHeight) / 2
  }

  _updateTransform () {
    const cw = this.viewWidth
    const ch = this.viewHeight
    const margin = this.viewMargin || 0

    const insets = this.viewportInsets || { top: 0, right: 0, bottom: 0, left: 0 }

    const availW = Math.max(10, cw - margin * 2 - insets.left - insets.right)
    const availH = Math.max(10, ch - margin * 2 - insets.top - insets.bottom)

    const scale = Math.min(availW / this.docWidth, availH / this.docHeight) || 1
    const actualW = this.docWidth * scale
    const actualH = this.docHeight * scale

    this.scale = scale
    this.offsetX = insets.left + margin + (availW - actualW) / 2
    this.offsetY = insets.top + margin + (availH - actualH) / 2
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
    const s = this.scale

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.translate(this.offsetX, this.offsetY)
    ctx.scale(s, s)

    // белый холст
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, this.docWidth, this.docHeight)

    // контент внутри холста не вращаем — просто центрируем
    if (isDrawable(this.backgroundImage)) {
      ctx.save()
      if (this.backgroundGray) ctx.filter = 'grayscale(1)'
      ctx.drawImage(
        this.backgroundImage,
        this.contentOffsetX,
        this.contentOffsetY,
        this.contentWidth,
        this.contentHeight
      )
      ctx.restore()
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

    if (ov.type === 'image') {
      const img = ov.data?.image
      if (isDrawable(img)) {
        const sx = ov.scaleX || 1
        const sy = ov.scaleY || 1
        ctx.scale(sx, sy)
        const halfW = ov.w / 2
        const halfH = ov.h / 2
        if (ov.data?.bw) ctx.filter = 'grayscale(1)'
        ctx.drawImage(img, -halfW, -halfH, ov.w, ov.h)
      }
      ctx.restore()
      return
    }

    if (ov.type === 'text') {
      // текст рисуется HTML-слоем поверх canvas
      ctx.restore()
      return
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

  // ---------------------------------------------------------------------------
  // Hit testing / pointer
  // ---------------------------------------------------------------------------

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
      startOverlay: cloneOverlay(active),
      lastOverlay: cloneOverlay(active)
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
        startOverlay: cloneOverlay(active),
        lastOverlay: cloneOverlay(active)
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
        startOverlay: cloneOverlay(ov),
        lastOverlay: cloneOverlay(ov)
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
    else if (this.activeHandle === 'rotate') this._handleRotateWithLimit(active, sx, sy)

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

  // ---------------------------------------------------------------------------
  // Transform handlers
  // ---------------------------------------------------------------------------

  _handleMove (ov, sx, sy) {
    const start = this.dragState.startOverlay
    const startDoc = this.dragState.startDoc
    const curDoc = this._screenToDoc(sx, sy)
    ov.cx = start.cx + (curDoc.x - startDoc.x)
    ov.cy = start.cy + (curDoc.y - startDoc.y)
    this._clampOverlay(ov)
    this.dragState.lastOverlay = cloneOverlay(ov)
  }

  _handleScale (ov, sx, sy) {
    const start = this.dragState.startOverlay
    const center = { x: start.cx, y: start.cy }
    const startDoc = this.dragState.startDoc
    const curDoc = this._screenToDoc(sx, sy)

    const distStart = Math.hypot(startDoc.x - center.x, startDoc.y - center.y) || 1
    const distCur = Math.hypot(curDoc.x - center.x, curDoc.y - center.y) || 1
    let desired = distCur / distStart
    desired = Math.max(0.1, Math.min(50, desired))

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
    this.dragState.lastOverlay = cloneOverlay(ov)
  }

  _handleRotateWithLimit (ov, sx, sy) {
    const curDoc = this._screenToDoc(sx, sy)
    const dx = curDoc.x - ov.cx
    const dy = curDoc.y - ov.cy
    const candidateAngle = Math.atan2(dy, dx) + Math.PI / 2

    const test = cloneOverlay(this.dragState.lastOverlay || ov)
    test.angleRad = candidateAngle

    const { ok, overlay } = this.clampOverlayToPage(
      test,
      this.docWidth,
      this.docHeight
    )

    if (!ok) {
      try { this.onLimit('rotate') } catch {}
      return
    }

    ov.angleRad = overlay.angleRad
    ov.cx = overlay.cx
    ov.cy = overlay.cy
    this.dragState.lastOverlay = cloneOverlay(overlay)
  }

  // ---------------------------------------------------------------------------
  // Bounds / clamp
  // ---------------------------------------------------------------------------

  _clampOverlay (ov, canvasW = this.docWidth, canvasH = this.docHeight) {
    const rect = {
      left: 0,
      right: Math.max(1, Number(canvasW || this.docWidth || 1)),
      top: 0,
      bottom: Math.max(1, Number(canvasH || this.docHeight || 1))
    }

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
    const rawFontPx = Math.max(6, Number(ov.data?.fontSize || 48) * effFontScale)
    const fontPx = Math.round(rawFontPx)

    return {
      cx: center.x,
      cy: center.y,
      w: wLocal,
      h: hLocal,
      angleRad: ov.angleRad || 0,
      fontSize: fontPx,
      bbox: { x: p1.x, y: p1.y, w: p2.x - p1.x, h: p2.y - p1.y }
    }
  }

  getDocumentScreenRect () {
    const topLeft = this._docToScreen(0, 0)
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: this.docWidth * this.scale,
      height: this.docHeight * this.scale
    }
  }

  // ---------------------------------------------------------------------------
  // Add overlays
  // ---------------------------------------------------------------------------

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

    this._fitOverlayIntoCanvas(ov, 0.9)
    this._clampOverlay(ov)

    this.overlays.push(ov)
    this.activeId = id
    this.onSelectionChange(cloneOverlay(ov))
    this._draw()
    this.onOverlayChange(cloneOverlay(ov))
    this.onInteractionEnd(this.overlays.map(cloneOverlay))
  }

  addTextOverlay (text = 'Текст', opts = {}) {
    this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))

    const id = opts.id || `tb_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const fontSize = Math.max(6, Math.round(Number(opts.fontSize || 48)))
    const lh = fontSize * LH_FACTOR
    const h = opts.height || lh

    const ov = {
      id,
      type: 'text',
      cx: this.docWidth / 2,
      cy: this.docHeight / 2,
      w: opts.width || 400,
      h,
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
    this._fitOverlayIntoCanvas(ov, 0.92)
    this._clampOverlay(ov)

    this.overlays.push(ov)
    this.activeId = id
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