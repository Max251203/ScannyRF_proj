import icDelete from '../assets/icons/x-close.svg'
import icRotate from '../assets/icons/rotate-handle.svg'
import icScale from '../assets/icons/scale-handle.svg'
import icEdit from '../assets/icons/edit-text.svg'

const deleteImg = new Image()
deleteImg.src = icDelete
const rotateImg = new Image()
rotateImg.src = icRotate
const scaleImg = new Image()
scaleImg.src = icScale
const editImg = new Image()
editImg.src = icEdit

function rotateVec(x, y, c, s) {
  return {
    x: x * c - y * s,
    y: x * s + y * c,
  }
}

function rotatePoint(x, y, angleRad) {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return rotateVec(x, y, c, s)
}

function cloneOverlay(ov) {
  if (!ov || typeof ov !== 'object') return ov
  return {
    ...ov,
    data: ov.data ? { ...ov.data } : {},
  }
}

function isDrawable(img) {
  if (!img) return false
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return true
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return true
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) return true
  return false
}

export class CustomCanvasEngine {
  constructor(canvas, opts = {}) {
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

  destroy() {
    this._detachEvents()
  }

  _attachEvents() {
    this.canvas.addEventListener('pointerdown', this._onPointerDown)
    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('pointerup', this._onPointerUp)
    window.addEventListener('pointercancel', this._onPointerCancel)
  }

  _detachEvents() {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerup', this._onPointerUp)
    window.removeEventListener('pointercancel', this._onPointerCancel)
  }

  setDocument(doc) {
    const prevActive = this.activeId

    this.docWidth = doc.docWidth || 1000
    this.docHeight = doc.docHeight || 1414
    this.backgroundImage = doc.backgroundImage || null
    this.overlays = (doc.overlays || []).map(cloneOverlay)
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

  setOverlays(overlays) {
    this.overlays = (overlays || []).map(cloneOverlay)
    if (this.activeId && !this.overlays.find(o => o.id === this.activeId)) {
      this.activeId = null
      this.onSelectionChange(null)
    }
    this._draw()
  }

  setEditingOverlayId(id) {
    this.editingId = id || null
    this._draw()
  }

  getOverlays() {
    return this.overlays.map(cloneOverlay)
  }

  getOverlayScreenBoundsById(id) {
    const ov = this.overlays.find(o => o.id === id)
    return ov ? this._getOverlayScreenBounds(ov) : null
  }

  setPageRotation(rotation, recalcTransform = false) {
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
        this.overlays.forEach(ov => {
          ov.scaleX = (ov.scaleX || 1) * k
          ov.scaleY = (ov.scaleY || 1) * k
        })
      }
    }

    if (prevRotation === 90 && this.rotation === 0) {
      const maxW = (this.pageWidth || this.docWidth) - 4
      const maxH = (this.pageHeight || this.docHeight) - 4
      this.overlays.forEach(ov => {
        const baseW = ov.w * (ov.scaleX || 1)
        const baseH = ov.h * (ov.scaleY || 1)
        if (baseW <= 0 || baseH <= 0) return
        const factor = Math.min(maxW / baseW, maxH / baseH, 1)
        if (factor < 1) {
          ov.scaleX = (ov.scaleX || 1) * factor
          ov.scaleY = (ov.scaleY || 1) * factor
        }
      })
    }

    this.overlays.forEach(ov => {
      this._clampOverlay(ov)
      this.onOverlayChange(cloneOverlay(ov))
    })

    this._draw()
    this.onInteractionEnd(this.overlays.map(cloneOverlay))
  }

  setMode(isMobile) {
    this.rotationAffectsTransform = !!isMobile
    this.handleRadius = isMobile ? 16 : 14
    this.hitRadius = isMobile ? 34 : 28
    this._updateTransform()
    this._draw()
  }

  resize(width, height) {
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

  setViewMargin(marginPx) {
    this.viewMargin = Math.max(0, marginPx || 0)
    this._updateTransform()
    this._draw()
  }

  _updatePageSize() {
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

  // старое поведение + фикс: ограничиваем именно ширину страницы (pageWidth * scale),
  // чтобы на мобилке в landscape она гарантированно влезала в экран
  _updateTransform() {
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

    // Ограничиваем видимую ширину листа (pageWidth), а не только docWidth
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

  _docToScreen(x, y) {
    const s = this.scale
    return {
      x: this.offsetX + x * s,
      y: this.offsetY + y * s,
    }
  }

  _screenToDoc(sx, sy) {
    const s = this.scale
    return {
      x: (sx - this.offsetX) / s,
      y: (sy - this.offsetY) / s,
    }
  }

  _clear() {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  _draw() {
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

  _drawOverlay(ov) {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(ov.cx, ov.cy)
    ctx.rotate(ov.angleRad || 0)
    ctx.scale(ov.scaleX || 1, ov.scaleY || 1)

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
      const sz = d.fontSize || 48
      const fam = d.fontFamily || 'Arial'
      ctx.font = `${fs} ${fw} ${sz}px ${fam}`

      const align = d.textAlign || 'left'
      ctx.textAlign = align
      ctx.textBaseline = 'top'

      let xPos = 0
      if (align === 'left') xPos = -halfW
      else if (align === 'right') xPos = halfW
      else if (align === 'center') xPos = 0

      const text = String(d.text || '')
      const lines = text.split('\n')
      const lh = sz * 1.2
      const totalH = lines.length * lh
      let startY = -totalH / 2

      for (let line of lines) {
        ctx.fillText(line, xPos, startY)
        startY += lh
      }
    }

    ctx.restore()
  }

  _drawOverlayControls(ov) {
    const ctx = this.ctx
    const s = this.scale
    const sc = this._docToScreen(ov.cx, ov.cy)

    const halfW = (ov.w * (ov.scaleX || 1) * s) / 2
    const halfH = (ov.h * (ov.scaleY || 1) * s) / 2
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

    this._lastControlPositions = {
      rotate: pRotate,
      delete: pDelete,
      scale: pScale,
      edit: null,
    }
  }

  _getPointerPos(evt) {
    const rect = this.canvas.getBoundingClientRect()
    return {
      sx: evt.clientX - rect.left,
      sy: evt.clientY - rect.top,
    }
  }

  _hitHandle(sx, sy) {
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

  _hitOverlay(sx, sy) {
    for (let i = this.overlays.length - 1; i >= 0; i--) {
      const ov = this.overlays[i]
      if (this._pointInOverlay(ov, sx, sy)) return ov
    }
    return null
  }

  _pointInOverlay(ov, sx, sy) {
    const { x: dx, y: dy } = this._screenToDoc(sx, sy)
    const lx = dx - ov.cx
    const ly = dy - ov.cy
    const ang = -(ov.angleRad || 0)
    const rp = rotateVec(lx, ly, Math.cos(ang), Math.sin(ang))
    const w = ov.w * (ov.scaleX || 1)
    const h = ov.h * (ov.scaleY || 1)
    const halfW = w / 2
    const halfH = h / 2
    return rp.x >= -halfW && rp.x <= halfW && rp.y >= -halfH && rp.y <= halfH
  }

  _setCursor(cursor) {
    if (this._cursor === cursor) return
    this._cursor = cursor
    this.canvas.style.cursor = cursor
  }

  handleExternalPointerDown(evt) {
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
    }
    this._setCursor('grabbing')
  }

  _onPointerDown(evt) {
    if (evt.target === this.canvas) evt.preventDefault()
    if (evt.button !== 0) return

    if (this.isPointerDown && this.pointerId != null && evt.pointerId !== this.pointerId) {
      return
    }

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
      try {
        this.onBlankClick()
      } catch {}
    }
  }

  _onPointerMove(evt) {
    if (this.pointerId != null && evt.pointerId !== this.pointerId) {
      return
    }

    if (this.isPointerDown && this.activeHandle) {
      evt.preventDefault()
    }

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

    this._draw()
    this.onOverlayChange(cloneOverlay(active))
  }

  _onPointerUp(evt) {
    if (this.pointerId != null && evt.pointerId !== this.pointerId) {
      return
    }
    if (this.isPointerDown) {
      this.isPointerDown = false
      const wasActive = this.activeHandle
      this.activeHandle = null
      this.dragState = null
      this.pointerId = null
      this._setCursor('default')

      if (wasActive) {
        const active = this.overlays.find(o => o.id === this.activeId)
        if (active) {
          this.onInteractionEnd(this.overlays.map(cloneOverlay))
        }
      }
    }
  }

  _onPointerCancel(evt) {
    if (this.pointerId != null && evt.pointerId !== this.pointerId) {
      return
    }
    if (this.isPointerDown) {
      this.isPointerDown = false
      this.activeHandle = null
      this.dragState = null
      this.pointerId = null
      this._setCursor('default')
    }
  }

  _handleMove(ov, sx, sy) {
    const start = this.dragState.startOverlay
    const startDoc = this.dragState.startDoc
    const curDoc = this._screenToDoc(sx, sy)
    ov.cx = start.cx + (curDoc.x - startDoc.x)
    ov.cy = start.cy + (curDoc.y - startDoc.y)
    this._clampOverlay(ov)
  }

  _handleScale(ov, sx, sy) {
    const start = this.dragState.startOverlay
    const center = { x: start.cx, y: start.cy }
    const startDoc = this.dragState.startDoc
    const curDoc = this._screenToDoc(sx, sy)

    const distStart = Math.hypot(startDoc.x - center.x, startDoc.y - center.y) || 1
    const distCur = Math.hypot(curDoc.x - center.x, curDoc.y - center.y) || 1
    let factor = distCur / distStart

    factor = Math.max(0.1, Math.min(5, factor))

    try {
      const pageW = this.pageWidth || this.docWidth
      const pageH = this.pageHeight || this.docHeight
      const startBounds = this._getOverlayDocBounds(start)
      const bw = Math.max(1e-6, startBounds.w)
      const bh = Math.max(1e-6, startBounds.h)
      const maxByW = pageW / bw
      const maxByH = pageH / bh
      const maxFactor = Math.max(0.1, Math.min(maxByW, maxByH))
      factor = Math.min(factor, maxFactor)
    } catch {}

    if (ov.type === 'text') {
      const oldFs = start.data?.fontSize || 48
      let newFs = oldFs * factor

      newFs = Math.max(6, newFs)

      const realFactor = newFs / oldFs

      ov.data.fontSize = newFs
      ov.w = start.w * realFactor
      ov.h = start.h * realFactor
      ov.scaleX = 1
      ov.scaleY = 1
    } else {
      ov.scaleX = (start.scaleX || 1) * factor
      ov.scaleY = (start.scaleY || 1) * factor
    }

    this._clampOverlay(ov)
  }

  _handleRotate(ov, sx, sy) {
    const { x, y } = this._screenToDoc(sx, sy)
    const dx = x - ov.cx
    const dy = y - ov.cy
    const newAngle = Math.atan2(dy, dx) + Math.PI / 2

    ov.angleRad = newAngle

    this._clampOverlay(ov)
  }

  _clampOverlay(ov) {
    const pageW = this.pageWidth || this.docWidth
    const pageH = this.pageHeight || this.docHeight
    const docCx = this.docWidth / 2
    const docCy = this.docHeight / 2
    const pLeft = docCx - pageW / 2
    const pRight = docCx + pageW / 2
    const pTop = docCy - pageH / 2
    const pBottom = docCy + pageH / 2

    const bounds = this._getOverlayDocBounds(ov)
    let dx = 0
    let dy = 0
    if (bounds.minX < pLeft) dx = pLeft - bounds.minX
    if (bounds.maxX > pRight) dx = pRight - bounds.maxX
    if (bounds.minY < pTop) dy = pTop - bounds.minY
    if (bounds.maxY > pBottom) dy = pBottom - bounds.maxY
    ov.cx += dx
    ov.cy += dy
  }

  _getOverlayDocBounds(ov) {
    const w = ov.w * (ov.scaleX || 1)
    const h = ov.h * (ov.scaleY || 1)
    const ang = ov.angleRad || 0
    const hw = w / 2
    const hh = h / 2
    const corners = [
      rotatePoint(-hw, -hh, ang),
      rotatePoint(hw, -hh, ang),
      rotatePoint(hw, hh, ang),
      rotatePoint(-hw, hh, ang),
    ].map(p => ({ x: p.x + ov.cx, y: p.y + ov.cy }))
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

  _getOverlayScreenBounds(ov) {
    const s = this.scale
    const center = this._docToScreen(ov.cx, ov.cy)

    const wLocal = ov.w * (ov.scaleX || 1) * s
    const hLocal = ov.h * (ov.scaleY || 1) * s

    const db = this._getOverlayDocBounds(ov)
    const p1 = this._docToScreen(db.minX, db.minY)
    const p2 = this._docToScreen(db.maxX, db.maxY)

    return {
      cx: center.x,
      cy: center.y,
      w: wLocal,
      h: hLocal,
      angleRad: ov.angleRad || 0,
      fontSize: (ov.data?.fontSize || 48) * s,
      bbox: {
        x: p1.x,
        y: p1.y,
        w: p2.x - p1.x,
        h: p2.y - p1.y,
      },
    }
  }

  getDocumentScreenRect() {
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
      height: pageH * s,
    }
  }

  addImageOverlay(img, data = {}) {
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
      data: { src: data.src || null, image: img },
    }
    this.overlays.push(ov)
    this.activeId = id
    this._clampOverlay(ov)
    this.onSelectionChange(cloneOverlay(ov))
    this._draw()
    this.onOverlayChange(cloneOverlay(ov))
    this.onInteractionEnd(this.overlays.map(cloneOverlay))
  }

  addTextOverlay(text = 'Текст', opts = {}) {
    this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))
    const id = opts.id || `tb_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const fontSize = opts.fontSize || 48
    const lh = fontSize * 1.2
    const totalH = lh
    const h = totalH
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
        textAlign: opts.textAlign || 'left',
      },
    }
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