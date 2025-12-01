// frontend/src/utils/customCanvasEngine.js

import icDelete from '../assets/icons/x-close.svg'
import icRotate from '../assets/icons/rotate-handle.svg'
import icScale from '../assets/icons/scale-handle.svg'

const deleteImg = new Image()
deleteImg.src = icDelete
const rotateImg = new Image()
rotateImg.src = icRotate
const scaleImg = new Image()
scaleImg.src = icScale

function rotatePoint (x, y, angleRad) {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return {
    x: x * c - y * s,
    y: x * s + y * c
  }
}

function cloneOverlay (ov) {
  if (!ov || typeof ov !== 'object') return ov
  return {
    ...ov,
    data: ov.data ? { ...ov.data } : {}
  }
}

function isDrawable (img) {
  if (!img) return false
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return true
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return true
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) return true
  return false
}

function length (v) {
  return Math.sqrt(v.x * v.x + v.y * v.y) || 0
}

function normalize (v) {
  const l = length(v) || 1
  return { x: v.x / l, y: v.y / l }
}

export class CustomCanvasEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} opts
   */
  constructor (canvas, opts = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')

    this.onBeforeOverlayChange = opts.onBeforeOverlayChange || (() => {})
    this.onOverlayChange = opts.onOverlayChange || (() => {})
    this.onOverlayDelete = opts.onOverlayDelete || (() => {})
    this.onSelectionChange = opts.onSelectionChange || (() => {})
    this.onTextEditRequest = opts.onTextEditRequest || (() => {})

    // Геометрия фонового контента (pdf/растр)
    this.docWidth = 1000
    this.docHeight = 1414
    this.backgroundImage = null

    // Оверлеи
    this.overlays = []

    // Ориентация страницы и рамка
    this.rotation = 0 // 0 | 90
    this.pageWidth = this.docWidth
    this.pageHeight = this.docHeight

    // Инициализация режима (мобилка/десктоп) сразу (для восстановления черновика на мобилке)
    const isMobileInitial = (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 960px)').matches)

    this.rotationAffectsTransform = isMobileInitial // <-- правка 1: сразу под мобильный режим

    // Viewport (экран)
    this.viewWidth = canvas.clientWidth || canvas.width || 1
    this.viewHeight = canvas.clientHeight || canvas.height || 1
    this.pixelRatio = window.devicePixelRatio || 1

    // Вертикальный отступ (суммарный сверху+снизу)
    this.viewMargin = typeof opts.viewMargin === 'number' ? Math.max(0, opts.viewMargin) : 24

    this.scale = 1
    this.offsetX = 0
    this.offsetY = 0

    // Состояние
    this.activeId = null
    this.activeHandle = null
    this.dragState = null
    this.isPointerDown = false
    this._lastControlPositions = null
    this._lastClick = null
    this._cursor = 'default'

    // UI‑контроллы (в экранных пикселях)
    this.handleRadius = isMobileInitial ? 16 : 13
    this.hitRadius = isMobileInitial ? 34 : 26
    this.borderColor = '#3C6FD8'
    this.handleFill = '#FFFFFF'
    this.handleStroke = '#E26D5C'

    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerMove = this._onPointerMove.bind(this)
    this._onPointerUp = this._onPointerUp.bind(this)

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
  }

  _detachEvents () {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerup', this._onPointerUp)
  }

  // ---------- Публичный API ----------

  setDocument (doc) {
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
      this.onSelectionChange(null)
    }

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

  /**
   * rotation: 0 | 90
   * recalcTransform:
   *   - десктоп: false → меняем только рамку страницы;
   *   - мобилка: true  → rotation учитывается в transform, пересчитываем масштаб
   *                      и клампим оверлеи.
   */
  setPageRotation (rotation, recalcTransform = false) {
  const newRot = rotation === 90 ? 90 : 0
  if (this.rotation === newRot && !recalcTransform) {
    return
  }

  this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))

  const prevRotation = this.rotation
  this.rotation = newRot
  if (recalcTransform) {
    this.rotationAffectsTransform = true
  }

  this._updatePageSize()

  if (recalcTransform) {
    const prevScale = this.scale || 1
    this._updateTransform()
    const newScale = this.scale || 1
    const k = newScale ? (prevScale / newScale) : 1
    if (k && k !== 1) {
      this.overlays.forEach(ov => {
        ov.scaleX = (ov.scaleX || 1) * k
        ov.scaleY = (ov.scaleY || 1) * k
      })
    }
  }

  // НОВОЕ: если вернулись в вертикальное положение, поджимаем слишком большие объекты
  if (prevRotation === 90 && this.rotation === 0) {
    const maxW = (this.pageWidth || this.docWidth) - 4
    const maxH = (this.pageHeight || this.docHeight) - 4

    this.overlays.forEach(ov => {
      const baseW = ov.w * (ov.scaleX || 1)
      const baseH = ov.h * (ov.scaleY || 1)
      if (baseW <= 0 || baseH <= 0) return

      const factor = Math.min(
        maxW / baseW,
        maxH / baseH,
        1
      )

      if (factor < 1) {
        ov.scaleX = (ov.scaleX || 1) * factor
        ov.scaleY = (ov.scaleY || 1) * factor
      }
    })
  }

  // как было: клампим внутрь рамки
  this.overlays.forEach(ov => {
    this._clampOverlay(ov)
    this.onOverlayChange(cloneOverlay(ov))
  })

  this._draw()
}

  /**
   * Смена режима (десктоп/мобилка).
   */
  setMode (isMobile) {
    this.rotationAffectsTransform = !!isMobile
    if (isMobile) {
      this.handleRadius = 16
      this.hitRadius = 34
    } else {
      this.handleRadius = 13
      this.hitRadius = 26
    }
    this._updateTransform()
    this._draw()
  }

  resize (width, height) {
    const safeW = Math.max(1, Math.floor(width || 0))
    const safeH = Math.max(1, Math.floor(height || 0))

    this.viewWidth = safeW
    this.viewHeight = safeH
    this.pixelRatio = window.devicePixelRatio || 1

    this.canvas.width = Math.max(1, Math.floor(safeW * this.pixelRatio))
    this.canvas.height = Math.max(1, Math.floor(safeH * this.pixelRatio))

    this._updateTransform()
    this._draw()
  }

  setViewMargin (marginPx) {
    this.viewMargin = Math.max(0, marginPx || 0)
    this._updateTransform()
    this._draw()
  }

  // ---------- Геометрия и трансформ ----------

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
    const availW0 = cw
    // как в исходной версии: один margin «съедаем» по высоте
    const availH0 = Math.max(10, ch - margin)

    let fitW = availW0
    let fitH = availH0

    // На мобилке при rotation=90 меняем, какое измерение считаем лимитирующим
    // (без поворота контента) — даёт «альбомное» ощущение
    if (this.rotationAffectsTransform && this.rotation === 90) {
      ;[fitW, fitH] = [availH0, availW0]
    }

    const scale = Math.min(fitW / W, fitH / H) || 1

    const actualW = W * scale
    const actualH = H * scale

    this.scale = scale
    this.offsetX = (cw - actualW) / 2
    this.offsetY = (ch - actualH) / 2
  }

  _docToScreen (x, y) {
    const s = this.scale
    const ox = this.offsetX
    const oy = this.offsetY
    return {
      x: ox + x * s,
      y: oy + y * s
    }
  }

  _screenToDoc (sx, sy) {
    const s = this.scale
    const ox = this.offsetX
    const oy = this.offsetY
    return {
      x: (sx - ox) / s,
      y: (sy - oy) / s
    }
  }

  // ---------- Отрисовка ----------

  _clear () {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  _draw () {
    const ctx = this.ctx
    this._clear()

    ctx.imageSmoothingEnabled = true
    try { ctx.imageSmoothingQuality = 'high' } catch {}

    const W = this.docWidth
    const H = this.docHeight
    const pageW = this.pageWidth || W
    const pageH = this.pageHeight || H

    const s = this.scale
    const ox = this.offsetX
    const oy = this.offsetY
    const dpr = this.pixelRatio || 1

    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.translate(ox, oy)
    ctx.scale(s, s)

    // Центр страницы в координатах документа
    const docCx = W / 2
    const docCy = H / 2
    const halfPW = pageW / 2
    const halfPH = pageH / 2
    const pageLeft = docCx - halfPW
    const pageTop = docCy - halfPH

    // белая страница
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(pageLeft, pageTop, pageW, pageH)

    // фон
    if (isDrawable(this.backgroundImage)) {
      ctx.drawImage(this.backgroundImage, 0, 0, W, H)
    }

    // оверлеи
    for (const ov of this.overlays) {
      this._drawOverlay(ov)
    }

    const active = this.overlays.find(o => o.id === this.activeId)
    ctx.restore()

    if (active) {
      this._drawOverlayControls(active)
    }
  }

  _drawOverlay (ov) {
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
      if (isDrawable(img)) ctx.drawImage(img, -halfW, -halfH, w, h)
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

    ctx.restore()
  }

  _getOverlayScreenBounds (ov) {
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

    const pts = cornersDoc.map(p => this._docToScreen(p.x, p.y))

    let minX = pts[0].x; let maxX = pts[0].x
    let minY = pts[0].y; let maxY = pts[0].y
    for (const p of pts) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }

    return {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY
    }
  }

  _drawOverlayControls (ov) {
    const ctx = this.ctx
    const dpr = this.pixelRatio || 1

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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

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

    const drawIconHandle = (x, y, kind) => {
      ctx.beginPath()
      ctx.arc(x, y, hr, 0, Math.PI * 2)
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
        const size = hr * 1.3
        ctx.drawImage(img, x - size / 2, y - size / 2, size, size)
      }
    }

    // векторы рёбер в экранных координатах
    const topEdge = { x: p1s.x - p0s.x, y: p1s.y - p0s.y }
    const rightEdge = { x: p2s.x - p1s.x, y: p2s.y - p1s.y }
    const bottomEdge = { x: p2s.x - p3s.x, y: p2s.y - p3s.y }
    const leftEdge = { x: p0s.x - p3s.x, y: p0s.y - p3s.y }

    // rotate — над серединой верхней стороны
    const topMid = { x: (p0s.x + p1s.x) / 2, y: (p0s.y + p1s.y) / 2 }
    const topNormal = normalize({ x: topEdge.y, y: -topEdge.x }) // наружу от рамки
    const rotateOffset = 32
    const rotatePos = {
      x: topMid.x + topNormal.x * rotateOffset,
      y: topMid.y + topNormal.y * rotateOffset
    }
    drawIconHandle(rotatePos.x, rotatePos.y, 'rotate')

    // delete — диагонально из правого верхнего угла
    const diagTR = normalize({
      x: (p1s.x - p0s.x) + (p1s.x - p2s.x),
      y: (p1s.y - p0s.y) + (p1s.y - p2s.y)
    })
    const deleteOffset = 26
    const deletePos = {
      x: p1s.x + diagTR.x * deleteOffset,
      y: p1s.y + diagTR.y * deleteOffset
    }
    drawIconHandle(deletePos.x, deletePos.y, 'delete')

    // scale — диагонально из левого нижнего угла
    const diagBL = normalize({
      x: (p3s.x - p2s.x) + (p3s.x - p0s.x),
      y: (p3s.y - p2s.y) + (p3s.y - p0s.y)
    })
    const scaleOffset = 22
    const scalePos = {
      x: p3s.x + diagBL.x * scaleOffset,
      y: p3s.y + diagBL.y * scaleOffset
    }
    drawIconHandle(scalePos.x, scalePos.y, 'scale')

    ctx.restore()

    this._lastControlPositions = {
      overlayId: ov.id,
      scale: scalePos,
      rotate: rotatePos,
      delete: deletePos
    }
  }

  _getPointerPos (evt) {
    const rect = this.canvas.getBoundingClientRect()
    const sx = evt.clientX - rect.left
    const sy = evt.clientY - rect.top
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

  _setCursor (cursor) {
    if (this._cursor === cursor) return
    this._cursor = cursor
    this.canvas.style.cursor = cursor
  }

  _onPointerDown (evt) {
    if (evt.button !== 0) return
    const { sx, sy } = this._getPointerPos(evt)
    this.isPointerDown = true

    const handle = this._hitHandle(sx, sy)
    const active = this.overlays.find(o => o.id === this.activeId) || null

    if (handle && active) {
      this.onBeforeOverlayChange(this.overlays.map(cloneOverlay))

      // Вопрос при удалении (только по кнопке delete)
      if (handle === 'delete') {
        if (!window.confirm('Удалить объект со страницы?')) {
          this.isPointerDown = false
          this._setCursor('default')
          return
        }
        const id = active.id
        this.overlays = this.overlays.filter(o => o.id !== id)
        this.activeId = null
        this.onSelectionChange(null)
        this._draw()
        this.onOverlayDelete(id)
        this.isPointerDown = false
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

    // Двойной клик по тому же оверлею
    let isDouble = false
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
    if (ov) {
      const last = this._lastClick
      if (last && last.id === ov.id) {
        const dt = now - last.time
        const dx = sx - last.sx
        const dy = sy - last.sy
        const dist2 = dx * dx + dy * dy
        if (dt < 350 && dist2 < 64) {
          isDouble = true
        }
      }
      this._lastClick = { id: ov.id, time: now, sx, sy }
    } else {
      this._lastClick = null
    }

    // Повторный клик по уже выбранному тексту — сразу в режим редактирования
    if (ov && ov.type === 'text' && this.activeId === ov.id) {
      this.onSelectionChange(cloneOverlay(ov))
      const bounds = this._getOverlayScreenBounds(ov)
      this.onTextEditRequest(cloneOverlay(ov), bounds)
      this.isPointerDown = false
      this.activeHandle = null
      this.dragState = null
      this._setCursor('text')
      return
    }

    if (ov) {
      if (isDouble && ov.type === 'text') {
        this.activeId = ov.id
        this.onSelectionChange(cloneOverlay(ov))
        this._draw()
        const bounds = this._getOverlayScreenBounds(ov)
        this.onTextEditRequest(cloneOverlay(ov), bounds)
        this.isPointerDown = false
        this.activeHandle = null
        this.dragState = null
        this._setCursor('text')
        return
      }

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
    } else {
      if (this.activeId) {
        this.activeId = null
        this.onSelectionChange(null)
        this._draw()
      }
      this._setCursor('default')
    }
  }

  _onPointerMove (evt) {
    const { sx, sy } = this._getPointerPos(evt)

    if (!this.isPointerDown || !this.activeHandle || !this.dragState) {
      // Обновляем курсор при наведении
      const handle = this._hitHandle(sx, sy)
      if (handle === 'rotate') {
        this._setCursor('crosshair')
      } else if (handle === 'delete' || handle === 'scale') {
        this._setCursor('grab')
      } else if (this._hitOverlay(sx, sy)) {
        this._setCursor('move')
      } else {
        this._setCursor('default')
      }
      return
    }

    const active = this.overlays.find(o => o.id === this.activeId)
    if (!active) return

    if (this.activeHandle === 'move') {
      this._handleMove(active, sx, sy)
    } else if (this.activeHandle === 'scale') {
      this._handleScale(active, sx, sy)
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
    this._setCursor('default')
  }

  _handleMove (ov, sx, sy) {
    const start = this.dragState.startOverlay
    const startDoc = this.dragState.startDoc
    const curDoc = this._screenToDoc(sx, sy)

    const dxDoc = curDoc.x - startDoc.x
    const dyDoc = curDoc.y - startDoc.y

    ov.cx = start.cx + dxDoc
    ov.cy = start.cy + dyDoc

    this._clampOverlay(ov)
  }

  _handleScale (ov, sx, sy) {
    const start = this.dragState.startOverlay
    const center = { x: start.cx, y: start.cy }

    const startDocPoint = this.dragState.startDoc
    const curDoc = this._screenToDoc(sx, sy)

    const startDist = Math.hypot(startDocPoint.x - center.x, startDocPoint.y - center.y) || 1
    const curDist = Math.hypot(curDoc.x - center.x, curDoc.y - center.y) || 1

    let factor = curDist / startDist
    factor = Math.max(0.1, Math.min(5, factor))

    const baseW = start.w * (start.scaleX || 1)
    const baseH = start.h * (start.scaleY || 1)
    const maxScaleW = (this.pageWidth - 4) / (baseW || 1)
    const maxScaleH = (this.pageHeight - 4) / (baseH || 1)
    const maxScale = Math.max(0.1, Math.min(maxScaleW, maxScaleH, 5))

    factor = Math.min(factor, maxScale)

    ov.scaleX = (start.scaleX || 1) * factor
    ov.scaleY = (start.scaleY || 1) * factor

    this._clampOverlay(ov)
  }

  _handleRotate (ov, sx, sy) {
    const { x: dx, y: dy } = this._screenToDoc(sx, sy)
    const vx = dx - ov.cx
    const vy = dy - ov.cy
    let angle = Math.atan2(vy, vx)
    if (isNaN(angle)) angle = 0
    ov.angleRad = angle
    this._clampOverlay(ov)
  }

  _clampOverlay (ov) {
    const pageW = this.pageWidth || this.docWidth
    const pageH = this.pageHeight || this.docHeight

    const w = ov.w * (ov.scaleX || 1)
    const h = ov.h * (ov.scaleY || 1)
    const angle = ov.angleRad || 0
    const halfW = w / 2
    const halfH = h / 2

    const corners = [
      rotatePoint(-halfW, -halfH, angle),
      rotatePoint(halfW, -halfH, angle),
      rotatePoint(halfW, halfH, angle),
      rotatePoint(-halfW, halfH, angle)
    ].map(p => ({ x: p.x + ov.cx, y: p.y + ov.cy }))

    let minX = corners[0].x; let maxX = corners[0].x
    let minY = corners[0].y; let maxY = corners[0].y
    for (const p of corners) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }

    const docCx = this.docWidth / 2
    const docCy = this.docHeight / 2
    const halfPW = pageW / 2
    const halfPH = pageH / 2
    const minXAllowed = docCx - halfPW
    const maxXAllowed = docCx + halfPW
    const minYAllowed = docCy - halfPH
    const maxYAllowed = docCy + halfPH

    let dx = 0
    let dy = 0

    if (minX < minXAllowed) dx += minXAllowed - minX
    if (maxX > maxXAllowed) dx += maxXAllowed - maxX
    if (minY < minYAllowed) dy += minYAllowed - minY
    if (maxY > maxYAllowed) dy += maxYAllowed - maxY

    ov.cx += dx
    ov.cy += dy
  }

  getDocumentScreenRect () {
    const s = this.scale
    const pageW = this.pageWidth || this.docWidth
    const pageH = this.pageHeight || this.docHeight

    const centerDocX = this.docWidth / 2
    const centerDocY = this.docHeight / 2
    const centerScreen = this._docToScreen(centerDocX, centerDocY)

    return {
      x: centerScreen.x - (pageW * s) / 2,
      y: centerScreen.y - (pageH * s) / 2,
      width: pageW * s,
      height: pageH * s
    }
  }

  // ---------- Методы добавления оверлеев ----------

  addImageOverlay (img, data = {}) {
    if (!isDrawable(img)) return

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
    this._clampOverlay(ov)
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
    this._clampOverlay(ov)
    this.onSelectionChange(cloneOverlay(ov))
    this._draw()
    this.onOverlayChange(cloneOverlay(ov))
  }
}

export default CustomCanvasEngine