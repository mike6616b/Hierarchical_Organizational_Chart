/**
 * Canvas 2D 樹狀圖渲染引擎
 * 支援 pan/zoom、hover、click 互動
 */

import { getLevelColor, isHighPerformer, HIGHLIGHT_COLOR, HIGHLIGHT_GLOW } from '../utils/colors.js'
import { NODE_WIDTH, NODE_HEIGHT } from '../utils/tree-layout.js'

const DPR = Math.max(window.devicePixelRatio || 1, 1)
const FONT_BODY = '"Styrene", "Noto Sans TC", "Inter", sans-serif'

export class TreeCanvas {
  constructor(canvasEl, { onNodeClick, onNodeHover, onNodeContext }) {
    this.canvas = canvasEl
    this.ctx = canvasEl.getContext('2d')
    this.nodes = []
    this.links = []
    this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

    // Camera
    this.offsetX = 0
    this.offsetY = 0
    this.scale = 1
    this.targetScale = 1

    // Interaction state
    this.isDragging = false
    this.dragStartX = 0
    this.dragStartY = 0
    this.dragOffsetX = 0
    this.dragOffsetY = 0
    this.hoveredNode = null
    this.selectedNode = null
    this.focusedNode = null // 鑒取導航：當前聚焦的節點

    // Callbacks
    this.onNodeClick = onNodeClick || (() => {})
    this.onNodeHover = onNodeHover || (() => {})
    this.onNodeContext = onNodeContext || (() => {})

    // Animation
    this.animating = false
    this.animationId = null

    this._bindEvents()
    this._resize()
    window.addEventListener('resize', () => this._resize())
  }

  /**
   * 更新資料並重新渲染
   */
  setData(nodes, links, bounds) {
    this.nodes = nodes
    this.links = links
    this.bounds = bounds
    this.render()
  }

  /**
   * 適合畫面：自動 zoom/pan 讓所有節點可見
   */
  fitView(animate = true) {
    const { minX, minY, maxX, maxY } = this.bounds
    const w = maxX - minX
    const h = maxY - minY
    if (w === 0 || h === 0) return

    const cw = this.canvas.width / DPR
    const ch = this.canvas.height / DPR
    const padding = 60

    const scaleX = (cw - padding * 2) / w
    const scaleY = (ch - padding * 2) / h
    const scale = Math.min(scaleX, scaleY, 2)

    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2

    if (animate) {
      this._animateTo(cw / 2 - cx * scale, ch / 2 - cy * scale, scale)
    } else {
      this.offsetX = cw / 2 - cx * scale
      this.offsetY = ch / 2 - cy * scale
      this.scale = scale
      this.targetScale = scale
      this.render()
    }
  }

  /**
   * 將指定節點置中顯示
   */
  centerOnNode(node, animate = true) {
    if (!node) return
    const cw = this.canvas.width / DPR
    const ch = this.canvas.height / DPR
    const scale = Math.max(this.scale, 0.8)

    const tx = cw / 2 - node.x * scale
    const ty = ch / 3 - node.y * scale  // 偏上 1/3

    if (animate) {
      this._animateTo(tx, ty, scale)
    } else {
      this.offsetX = tx
      this.offsetY = ty
      this.scale = scale
      this.targetScale = scale
      this.render()
    }
  }

  /** Zoom in */
  zoomIn() {
    this.targetScale = Math.min(this.scale * 1.3, 3)
    this._animateZoom()
  }

  /** Zoom out */
  zoomOut() {
    this.targetScale = Math.max(this.scale / 1.3, 0.2)
    this._animateZoom()
  }

  // ---- Private ----

  _resize() {
    const parent = this.canvas.parentElement
    const w = parent.clientWidth
    const h = parent.clientHeight
    this.canvas.width = w * DPR
    this.canvas.height = h * DPR
    this.canvas.style.width = w + 'px'
    this.canvas.style.height = h + 'px'
    this.render()
  }

  _bindEvents() {
    const c = this.canvas

    // Mouse drag
    c.addEventListener('mousedown', e => {
      this.isDragging = true
      this.dragStartX = e.clientX
      this.dragStartY = e.clientY
      this.dragOffsetX = this.offsetX
      this.dragOffsetY = this.offsetY
      c.classList.add('grabbing')
    })

    window.addEventListener('mousemove', e => {
      if (this.isDragging) {
        this.offsetX = this.dragOffsetX + (e.clientX - this.dragStartX)
        this.offsetY = this.dragOffsetY + (e.clientY - this.dragStartY)
        this.render()
      } else {
        this._handleHover(e)
      }
    })

    window.addEventListener('mouseup', () => {
      this.isDragging = false
      c.classList.remove('grabbing')
    })

    // Wheel zoom
    c.addEventListener('wheel', e => {
      e.preventDefault()
      const rect = c.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      const newScale = Math.max(0.15, Math.min(3, this.scale * factor))

      // Zoom towards cursor
      this.offsetX = mx - (mx - this.offsetX) * (newScale / this.scale)
      this.offsetY = my - (my - this.offsetY) * (newScale / this.scale)
      this.scale = newScale
      this.targetScale = newScale

      this.render()
    }, { passive: false })

    // Click
    c.addEventListener('click', e => {
      if (Math.abs(e.clientX - this.dragStartX) > 3 ||
          Math.abs(e.clientY - this.dragStartY) > 3) return // was dragging

      const node = this._hitTest(e)
      if (node) {
        this.selectedNode = node
        this.onNodeClick(node)
      }
    })

    // Double Click
    c.addEventListener('dblclick', e => {
      const node = this._hitTest(e)
      if (node) {
        this.onNodeContext(node, e)
      }
    })

    // Context menu
    c.addEventListener('contextmenu', e => {
      e.preventDefault()
      const node = this._hitTest(e)
      if (node) this.onNodeContext(node, e)
    })

    // Touch support
    let touchStartDist = 0
    let touchStartScale = 1
    let lastTouchX = 0, lastTouchY = 0

    c.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        this.isDragging = true
        lastTouchX = e.touches[0].clientX
        lastTouchY = e.touches[0].clientY
        this.dragOffsetX = this.offsetX
        this.dragOffsetY = this.offsetY
      } else if (e.touches.length === 2) {
        this.isDragging = false
        touchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        touchStartScale = this.scale
      }
    }, { passive: true })

    c.addEventListener('touchmove', e => {
      e.preventDefault()
      if (e.touches.length === 1 && this.isDragging) {
        const dx = e.touches[0].clientX - lastTouchX
        const dy = e.touches[0].clientY - lastTouchY
        this.offsetX += dx
        this.offsetY += dy
        lastTouchX = e.touches[0].clientX
        lastTouchY = e.touches[0].clientY
        this.render()
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        this.scale = Math.max(0.15, Math.min(3, touchStartScale * (dist / touchStartDist)))
        this.targetScale = this.scale
        this.render()
      }
    }, { passive: false })

    c.addEventListener('touchend', () => { this.isDragging = false }, { passive: true })
  }

  _handleHover(e) {
    const node = this._hitTest(e)
    if (node !== this.hoveredNode) {
      this.hoveredNode = node
      this.canvas.style.cursor = node ? 'pointer' : 'grab'
      this.onNodeHover(node)
      this.render()
    }
  }

  _hitTest(e) {
    const rect = this.canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    // 轉換為 world 座標
    const wx = (mx - this.offsetX) / this.scale
    const wy = (my - this.offsetY) / this.scale

    // 反向遍歷 (上面的節點優先)
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i]
      const halfW = n.width / 2
      if (wx >= n.x - halfW && wx <= n.x + halfW &&
          wy >= n.y && wy <= n.y + n.height) {
        return n
      }
    }
    return null
  }

  _animateTo(tx, ty, scale) {
    const startX = this.offsetX
    const startY = this.offsetY
    const startScale = this.scale
    const duration = 400
    const start = performance.now()

    const ease = t => 1 - Math.pow(1 - t, 3) // ease-out cubic

    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration)
      const ep = ease(p)
      this.offsetX = startX + (tx - startX) * ep
      this.offsetY = startY + (ty - startY) * ep
      this.scale = startScale + (scale - startScale) * ep
      this.targetScale = this.scale
      this.render()
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  _animateZoom() {
    const startScale = this.scale
    const endScale = this.targetScale
    const cw = this.canvas.width / DPR / 2
    const ch = this.canvas.height / DPR / 2
    const duration = 200
    const start = performance.now()

    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration)
      const newScale = startScale + (endScale - startScale) * p
      this.offsetX = cw - (cw - this.offsetX) * (newScale / this.scale)
      this.offsetY = ch - (ch - this.offsetY) * (newScale / this.scale)
      this.scale = newScale
      this.render()
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  /**
   * 主渲染方法
   */
  render() {
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height

    ctx.clearRect(0, 0, w, h)
    ctx.save()
    ctx.scale(DPR, DPR)
    ctx.translate(this.offsetX, this.offsetY)
    ctx.scale(this.scale, this.scale)

    // 繪製連線
    this._drawLinks(ctx)

    // 繪製節點
    this._drawNodes(ctx)

    ctx.restore()
  }

  _drawLinks(ctx) {
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#CBD5E1'
    ctx.setLineDash([])
    ctx.lineCap = 'round'

    for (const { source, target } of this.links) {
      ctx.beginPath()
      const sx = source.x
      const sy = source.y + source.height + 12  // 從 expand button 下方出發
      const tx = target.x
      const ty = target.y

      // 貝茲曲線
      const midY = (sy + ty) / 2
      ctx.moveTo(sx, sy)
      ctx.bezierCurveTo(sx, midY, tx, midY, tx, ty)
      ctx.stroke()
    }
  }

  _drawNodes(ctx) {
    for (const node of this.nodes) {
      if (node.isGroupNode) {
        this._drawGroupNode(ctx, node)
      } else {
        this._drawNode(ctx, node)
      }
    }
  }

  _drawNode(ctx, node) {
    const x = node.x - node.width / 2
    const y = node.y
    const w = node.width
    const h = node.height
    const r = 16   // Bento-style rounded corners
    const colors = getLevelColor(node.data.level)
    const isHigh = isHighPerformer(node.data)
    const isHovered = node === this.hoveredNode
    const isSelected = node === this.selectedNode
    const isDimmed = node.dimmed

    ctx.save()

    // 聚焦效果：降低透明度
    if (isDimmed) {
      ctx.globalAlpha = 0.3
    }

    // ---- Shadow ----
    if (isHovered || isSelected) {
      ctx.shadowColor = 'rgba(30, 64, 175, 0.15)'
      ctx.shadowBlur = 20
      ctx.shadowOffsetY = 6
    } else {
      ctx.shadowColor = 'rgba(30, 64, 175, 0.05)'
      ctx.shadowBlur = 8
      ctx.shadowOffsetY = 3
    }
    if (isHigh) {
      ctx.shadowColor = HIGHLIGHT_GLOW
      ctx.shadowBlur = 20
    }

    // ---- Card background ----
    ctx.fillStyle = isHovered ? '#FAFBFF' : '#FFFFFF'
    this._roundRect(ctx, x, y, w, h, r)
    ctx.fill()

    // Reset shadow
    ctx.shadowColor = 'transparent'

    // ---- Border ----
    ctx.strokeStyle = isHigh ? HIGHLIGHT_COLOR
                    : isSelected ? '#3B82F6'
                    : isHovered ? '#93C5FD'
                    : '#E8EDF5'
    ctx.lineWidth = isHigh ? 2 : isSelected ? 2 : 1
    this._roundRect(ctx, x, y, w, h, r)
    ctx.stroke()

    // ---- Color accent bar (left side, clipped to card shape) ----
    ctx.save()
    this._roundRect(ctx, x, y, w, h, r)
    ctx.clip()
    ctx.fillStyle = colors.fill
    ctx.fillRect(x, y, 5, h)
    ctx.restore()

    // ---- Name (large, bold) ----
    ctx.fillStyle = '#0F172A'
    ctx.font = `700 15px ${FONT_BODY}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const displayName = node.data.name || ''
    let truncName = displayName
    const maxNameWidth = 95 // 留給右邊庫存數字的空間
    if (ctx.measureText(truncName).width > maxNameWidth) {
      while (truncName.length > 1 && ctx.measureText(truncName + '…').width > maxNameWidth) {
        truncName = truncName.slice(0, -1)
      }
      truncName += '…'
    }
    ctx.fillText(truncName, x + 14, y + 20)

    // ---- Level pill badge ----
    const levelText = node.data.level || ''
    if (levelText) {
      ctx.font = `600 9px ${FONT_BODY}`
      const pillW = ctx.measureText(levelText).width + 12
      const pillH = 16
      const pillX = x + 14
      const pillY = y + 33
      // Pill background (light tint of level color)
      ctx.globalAlpha = 0.12
      ctx.fillStyle = colors.fill
      this._roundRect(ctx, pillX, pillY, pillW, pillH, 4)
      ctx.fill()
      ctx.globalAlpha = 1
      // Pill text
      ctx.fillStyle = colors.fill
      ctx.font = `600 9px ${FONT_BODY}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(levelText, pillX + 6, pillY + pillH / 2)
    }

    // ---- Inventory display (right side, prominent) ----
    const inv = node.data.inventory ?? 0
    const invStr = Number(inv).toLocaleString()
    ctx.textAlign = 'right'
    ctx.fillStyle = '#0F172A'
    ctx.font = `700 16px ${FONT_BODY}`
    ctx.textBaseline = 'middle'
    ctx.fillText(invStr, x + w - 14, y + 22)

    // Inventory label
    ctx.fillStyle = '#94A3B8'
    ctx.font = `400 9px ${FONT_BODY}`
    ctx.fillText('庫存', x + w - 14, y + 38)

    // ---- Company name (if exists, small) ----
    if (node.data.company_name) {
      ctx.textAlign = 'left'
      ctx.fillStyle = '#64748B'
      ctx.font = `400 9px ${FONT_BODY}`
      const compName = node.data.company_name.length > 8
        ? node.data.company_name.slice(0, 8) + '…'
        : node.data.company_name
      ctx.fillText(compName, x + 14, y + 56)
    }

    // ---- Expand/collapse indicator ----
    if (node.hasChildren || node.children.length > 0) {
      const iconX = x + w / 2
      const iconY = y + h + 4
      const iconR = 8
      // Circle bg
      ctx.fillStyle = node.expanded ? '#F1F5F9' : '#EFF6FF'
      ctx.beginPath()
      ctx.arc(iconX, iconY, iconR, 0, Math.PI * 2)
      ctx.fill()
      // Circle border
      ctx.strokeStyle = node.expanded ? '#CBD5E1' : '#93C5FD'
      ctx.lineWidth = 1
      ctx.stroke()
      // Arrow
      ctx.fillStyle = node.expanded ? '#94A3B8' : '#3B82F6'
      ctx.beginPath()
      if (node.expanded) {
        ctx.moveTo(iconX - 3, iconY + 1)
        ctx.lineTo(iconX, iconY - 2)
        ctx.lineTo(iconX + 3, iconY + 1)
      } else {
        ctx.moveTo(iconX - 3, iconY - 1)
        ctx.lineTo(iconX, iconY + 2)
        ctx.lineTo(iconX + 3, iconY - 1)
      }
      ctx.fill()
    }

    ctx.restore()
  }

  /** 繪製群組節點（"+N 名其他會員"） */
  _drawGroupNode(ctx, node) {
    const x = node.x - node.width / 2
    const y = node.y
    const w = node.width
    const h = node.height
    const r = 16
    const isHovered = node === this.hoveredNode

    ctx.save()

    // Dashed border, muted style
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = isHovered ? '#93C5FD' : '#CBD5E1'
    ctx.lineWidth = 1.5
    ctx.fillStyle = isHovered ? '#F8FAFC' : '#F1F5F9'
    this._roundRect(ctx, x, y, w, h, r)
    ctx.fill()
    this._roundRect(ctx, x, y, w, h, r)
    ctx.stroke()
    ctx.setLineDash([])

    // "+N" text
    ctx.fillStyle = isHovered ? '#3B82F6' : '#94A3B8'
    ctx.font = `700 16px ${FONT_BODY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`+${node.groupCount}`, x + w / 2, y + h / 2 - 8)

    // Label
    ctx.fillStyle = '#94A3B8'
    ctx.font = `400 10px ${FONT_BODY}`
    ctx.fillText('其他會員', x + w / 2, y + h / 2 + 10)

    // Hover hint
    if (isHovered) {
      ctx.fillStyle = '#3B82F6'
      ctx.font = `500 9px ${FONT_BODY}`
      ctx.fillText('點擊展開', x + w / 2, y + h / 2 + 24)
    }

    ctx.restore()
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  _roundRectTop(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h)
    ctx.lineTo(x, y + h)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  /**
   * 銷毀
   */
  destroy() {
    if (this.animationId) cancelAnimationFrame(this.animationId)
  }
}
