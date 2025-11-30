// frontend/src/utils/customCanvasEngine.js
//
// Кастомный движок редактирования поверх <canvas>.
// - Документное пространство (docWidth x docHeight)
// - Фон-страница (imageBitmap/HTMLImageElement/HTMLCanvasElement)
// - Оверлеи: image / text
// - Рамка и контроллы (delete, rotate, scale)
// - Поворот страницы 0 / 90 градусов
// - Коллбеки:
//     onBeforeOverlayChange(snapshot)
//     onOverlayChange(overlay)
//     onOverlayDelete(id)
//     onSelectionChange(overlayOrNull)

function rotatePoint (x, y, angleRad) {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return {
    x: x * c - y * s,
    y: x * s + y * c
  }
}

function cloneOverlay (ov) {
  return JSON.parse(JSON.stringify(ov))
}

function isDrawable (img) {
  if (!img) return false
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return true
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return true
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) return true
  return false
}

export class CustomCanvasEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} opts
   * @param {(snapshot: Object[]) => void} opts.onBeforeOverlayChange
   * @param {(overlay: Object) => void} opts.onOverlayChange
   * @param {(id: string) => void} opts.onOverlayDelete
   * @param {(overlayOrNull: Object|null) => void} opts.onSelectionChange
   */
  constructor (canvas, opts = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')

    this.onBeforeOverlayChange = opts.onBeforeOverlayChange || (() => {})
    this.onOverlayChange = opts.onOverlayChange || (() => {})
    this.onOverlayDelete = opts.onOverlayDelete || (() => {})
    this.onSelectionChange = opts.onSelectionChange || (() => {})

    // Документ
    this.docWidth = 1000
    this.docHeight = 1414
    this.backgroundImage = null
    this.overlays = []
    this.rotation = 0 // 0 или 90
    this.scale = 1
    this.offsetX = 0
    this.offsetY = 0

    // Состояние
    this.activeId = null
    this.activeHandle = null // 'move' | 'scale' | 'rotate'
    this.dragState = null
    this.isPointerDown = false

    // UI контроллы (в экранных пикселях)
    this.handleRadius = 14
    this.hitRadius = 24
    this.borderColor = '#3C6FD8'
    this.handleFill = '#E26D5C'
    this.handleStroke = '#FFFFFF'

    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerMove = this._onPointerMove.bind(this)
    this._onPointerUp = this._onPointerUp.bind(this)

    this._attachEvents()
    this._draw()
  }

  destroy () {
    this._detachEvents()
  }

  _attachEvents () {
    this.canvas.addEventListener('pointerdown', this._onPointerDown)
    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('pointerup', this._onPointerUp)
  }

  _detachEvents () {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerup', this._onPointerUp)
  }

  // ---------- Публичный API ----------

  setDocument (doc) {
    this.docWidth = doc.docWidth || 1000
    this.docHeight = doc.docHeight || 1414
    this.backgroundImage = doc.backgroundImage || null
    this.overlays = (doc.overlays || []).map(cloneOverlay)
    this.activeId = null
    this.rotation = doc.rotation === 90 ? 90 : 0
    this._updateTransform()
    this._draw()
  }

  setOverlays (overlays) {
    this.overlays = (overlays || []).map(cloneOverlay)
    if (this.activeId && !this.overlays.find(o => o.id === this.activeId)) {
      this.activeId = null
      this.onSelectionChange(null)
    }
    this._draw()
  }

  getOverlays () {
    return this.overlays.map(cloneOverlay)
  }

  resize (width, height) {
    if (!width || !height) return
    this.canvas.width = Math.max(1, Math.floor(width))
    this.canvas.height = Math.max(1, Math.floor(height))
    this._updateTransform()
    this._draw()
  }

  toggleRotation () {
    this.rotation = this.rotation === 0 ? 90 : 0
    this._updateTransform()
    this._draw()
  }

  addImageOverlay (img, data = {}) {
    this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))
    const id = data.id || `im_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const w = img.width || img.naturalWidth || 200
    const h = img.height || img.naturalHeight || 100
    const cx = this.docWidth / 2
    const cy = this.docHeight / 2
    const ov = {
      id,
      type: 'image',
      cx,
      cy,
      w,
      h,
      scaleX: 1,
      scaleY: 1,
      angleRad: 0,
      data: {
        src: data.src || null,
        image: img
      }
    }
    this.overlays.push(ov)
    this.activeId = id
    this.onSelectionChange(cloneOverlay(ov))
    this._draw()
    this.onOverlayChange(cloneOverlay(ov))
  }

  addTextOverlay (text = 'Текст', opts = {}) {
    this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))
    const id = opts.id || `tb_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const cx = this.docWidth / 2
    const cy = this.docHeight / 2
    const fontSize = opts.fontSize || 48
    const fontFamily = opts.fontFamily || 'Arial'
    const w = opts.width || 400
    const h = opts.height || fontSize * 1.4

    const ov = {
      id,
      type: 'text',
      cx,
      cy,
      w,
      h,
      scaleX: 1,
      scaleY: 1,
      angleRad: 0,
      data: {
        text,
        fontSize,
        fontFamily,
        fontWeight: opts.fontWeight || 'bold',
        fontStyle: opts.fontStyle || 'normal',
        fill: opts.fill || '#000000',
        textAlign: opts.textAlign || 'center'
      }
    }
    this.overlays.push(ov)
    this.activeId = id
    this.onSelectionChange(cloneOverlay(ov))
    this._draw()
    this.onOverlayChange(cloneOverlay(ov))
  }

  // ---------- Геометрия и трансформ ----------

  _updateTransform () {
    const W = this.docWidth
    const H = this.docHeight
    const cw = this.canvas.width
    const ch = this.canvas.height

    const rot = this.rotation
    const docWrot = rot === 0 ? W : H
    const docHrot = rot === 0 ? H : W

    const scale = Math.min(cw / docWrot, ch / docHrot) || 1
    const offsetX = (cw - docWrot * scale) / 2
    const offsetY = (ch - docHrot * scale) / 2

    this.scale = scale
    this.offsetX = offsetX
    this.offsetY = offsetY
  }

  _docToScreen (x, y) {
    const W = this.docWidth
    const rot = this.rotation
    const s = this.scale
    const ox = this.offsetX
    const oy = this.offsetY

    if (rot === 0) {
      return {
        x: ox + x * s,
        y: oy + y * s
      }
    } else {
      const u = y
      const v = W - x
      return {
        x: ox + u * s,
        y: oy + v * s
      }
    }
  }

  _screenToDoc (sx, sy) {
    const W = this.docWidth
    const rot = this.rotation
    const s = this.scale
    const ox = this.offsetX
    const oy = this.offsetY

    if (rot === 0) {
      return {
        x: (sx - ox) / s,
        y: (sy - oy) / s
      }
    } else {
      const u = (sx - ox) / s
      const v = (sy - oy) / s
      return {
        x: W - v,
        y: u
      }
    }
  }

  // ---------- Отрисовка ----------

  _clear () {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  _draw () {
    const ctx = this.ctx
    this._clear()

    const W = this.docWidth
    const H = this.docHeight
    const s = this.scale
    const ox = this.offsetX
    const oy = this.offsetY

    ctx.save()

    if (this.rotation === 0) {
      ctx.setTransform(s, 0, 0, s, ox, oy)
    } else {
      // 90° по часовой для всего листа
      ctx.setTransform(0, -s, s, 0, ox, oy + s * W)
    }

    if (isDrawable(this.backgroundImage)) {
      ctx.drawImage(this.backgroundImage, 0, 0, W, H)
    } else {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
    }

    for (const ov of this.overlays) {
      this._drawOverlay(ov, false)
    }

    const active = this.overlays.find(o => o.id === this.activeId)
    if (active) {
      this._drawOverlay(active, true)
      this._drawOverlayControls(active)
    }

    ctx.restore()
  }

  _drawOverlay (ov, isActive) {
    const ctx = this.ctx

    ctx.save()
    ctx.translate(ov.cx, ov.cy)
    ctx.rotate(ov.angleRad || 0)
    ctx.scale(ov.scaleX || 1, ov.scaleY || 1)

    const w = ov.w
    const h = ov.h
    const halfW = w / 2
    const halfH = h / 2

    if (ov.type === 'image') {
      const img = ov.data?.image
      if (isDrawable(img)) {
        ctx.drawImage(img, -halfW, -halfH, w, h)
      }
    } else if (ov.type === 'text') {
      const d = ov.data || {}
      ctx.fillStyle = d.fill || '#000000'
      const fontWeight = d.fontWeight || 'bold'
      const fontStyle = d.fontStyle || 'normal'
      const fontSize = d.fontSize || 48
      const fontFamily = d.fontFamily || 'Arial'
      ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
      ctx.textAlign = d.textAlign || 'center'
      ctx.textBaseline = 'middle'
      const text = d.text || ''
      ctx.fillText(text, 0, 0)
    }

    if (isActive) {
      ctx.strokeStyle = 'rgba(60,111,216,0.9)'
      ctx.lineWidth = 2 / this.scale
      ctx.strokeRect(-halfW, -halfH, w, h)
    }

    ctx.restore()
  }

  _drawOverlayControls (ov) {
    const ctx = this.ctx
    const w = ov.w * (ov.scaleX || 1)
    const h = ov.h * (ov.scaleY || 1)
    const angle = ov.angleRad || 0
    const halfW = w / 2
    const halfH = h / 2

    const cornersDoc = [
      rotatePoint(-halfW, -halfH, angle),
      rotatePoint(halfW, -halfH, angle),
      rotatePoint(halfW, halfH, angle),
      rotatePoint(-halfW, halfH, angle)
    ].map(p => ({ x: p.x + ov.cx, y: p.y + ov.cy }))

    const [p0, p1, p2, p3] = cornersDoc

    const p0s = this._docToScreen(p0.x, p0.y)
    const p1s = this._docToScreen(p1.x, p1.y)
    const p2s = this._docToScreen(p2.x, p2.y)
    const p3s = this._docToScreen(p3.x, p3.y)

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    // рамка
    ctx.beginPath()
    ctx.moveTo(p0s.x, p0s.y)
    ctx.lineTo(p1s.x, p1s.y)
    ctx.lineTo(p2s.x, p2s.y)
    ctx.lineTo(p3s.x, p3s.y)
    ctx.closePath()
    ctx.strokeStyle = this.borderColor
    ctx.lineWidth = 1.5
    ctx.stroke()

    const hr = this.handleRadius
    const drawHandle = (x, y) => {
      ctx.beginPath()
      ctx.arc(x, y, hr, 0, Math.PI * 2)
      ctx.fillStyle = this.handleFill
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = this.handleStroke
      ctx.stroke()
    }

    // scale: правый нижний угол
    drawHandle(p2s.x, p2s.y)

    // rotate: над верхней гранью
    const topMid = {
      x: (p0s.x + p1s.x) / 2,
      y: (p0s.y + p1s.y) / 2
    }
    const rotatePos = {
      x: topMid.x,
      y: topMid.y - 48
    }
    drawHandle(rotatePos.x, rotatePos.y)

    // delete: правый верхний угол
    const rightTop = {
      x: (p1s.x + p2s.x) / 2 + 28,
      y: (p1s.y + p2s.y) / 2 - 28
    }
    drawHandle(rightTop.x, rightTop.y)

    ctx.restore()

    this._lastControlPositions = {
      overlayId: ov.id,
      scale: p2s,
      rotate: rotatePos,
      delete: rightTop
    }
  }

  // ---------- Хит-тест и события ----------

  _getPointerPos (evt) {
    const rect = this.canvas.getBoundingClientRect()
    const sx = ((evt.clientX - rect.left) * this.canvas.width) / rect.width
    const sy = ((evt.clientY - rect.top) * this.canvas.height) / rect.height
    return { sx, sy }
  }

  _hitHandle (sx, sy) {
    const pos = this._lastControlPositions
    if (!pos || !this.activeId) return null
    const r2 = this.hitRadius * this.hitRadius

    const dist2 = (p) => {
      const dx = sx - p.x
      const dy = sy - p.y
      return dx * dx + dy * dy
    }

    if (dist2(pos.delete) <= r2) return 'delete'
    if (dist2(pos.rotate) <= r2) return 'rotate'
    if (dist2(pos.scale) <= r2) return 'scale'
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
    const a = -(ov.angleRad || 0)
    const rp = rotatePoint(lx, ly, a)
    const sxInv = 1 / (ov.scaleX || 1)
    const syInv = 1 / (ov.scaleY || 1)
    const ux = rp.x * sxInv
    const uy = rp.y * syInv
    const halfW = ov.w / 2
    const halfH = ov.h / 2
    return ux >= -halfW && ux <= halfW && uy >= -halfH && uy <= halfH
  }

  _onPointerDown (evt) {
    if (evt.button !== 0) return
    this.isPointerDown = true
    const { sx, sy } = this._getPointerPos(evt)

    const handle = this._hitHandle(sx, sy)
    const active = this.overlays.find(o => o.id === this.activeId) || null

    if (handle && active) {
      this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))

      if (handle === 'delete') {
        const id = active.id
        this.overlays = this.overlays.filter(o => o.id !== id)
        this.activeId = null
        this.onSelectionChange(null)
        this._draw()
        this.onOverlayDelete(id)
        this.isPointerDown = false
        return
      }

      this.activeHandle = handle
      this.dragState = {
        startScreen: { sx, sy },
        startOverlay: cloneOverlay(active)
      }
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
        startOverlay: cloneOverlay(ov)
      }
      this._draw()
    } else {
      if (this.activeId) {
        this.activeId = null
        this.onSelectionChange(null)
        this._draw()
      }
    }
  }

  _onPointerMove (evt) {
    if (!this.isPointerDown || !this.activeHandle || !this.dragState) return
    const active = this.overlays.find(o => o.id === this.activeId)
    if (!active) return

    const { sx, sy } = this._getPointerPos(evt)
    const dsx = sx - this.dragState.startScreen.sx
    const dsy = sy - this.dragState.startScreen.sy

    if (this.activeHandle === 'move') {
      this._handleMove(active, dsx, dsy)
    } else if (this.activeHandle === 'scale') {
      this._handleScale(active, dsx, dsy)
    } else if (this.activeHandle === 'rotate') {
      this._handleRotate(active, sx, sy)
    }

    this._draw()
    this.onOverlayChange(cloneOverlay(active))
  }

  _onPointerUp () {
    this.isPointerDown = false
    this.activeHandle = null
    this.dragState = null
  }

  _handleMove (ov, dsx, dsy) {
    const s = this.scale || 1
    const dxDoc = dsx / s
    const dyDoc = dsy / s

    const start = this.dragState.startOverlay
    ov.cx = start.cx + dxDoc
    ov.cy = start.cy + dyDoc
  }

  _handleScale (ov, dsx, dsy) {
    const start = this.dragState.startOverlay
    const s = this.scale || 1
    const delta = (dsx + dsy) / (2 * s)

    const baseW = start.w * (start.scaleX || 1)
    const baseH = start.h * (start.scaleY || 1)
    const diag = Math.sqrt(baseW * baseW + baseH * baseH) || 1

    let factor = 1 + delta / diag
    factor = Math.max(0.1, Math.min(5, factor))

    ov.scaleX = (start.scaleX || 1) * factor
    ov.scaleY = (start.scaleY || 1) * factor
  }

  _handleRotate (ov, sx, sy) {
    const { x: dx, y: dy } = this._screenToDoc(sx, sy)
    const vx = dx - ov.cx
    const vy = dy - ov.cy
    let angle = Math.atan2(vy, vx)
    if (isNaN(angle)) angle = 0
    ov.angleRad = angle
  }
}