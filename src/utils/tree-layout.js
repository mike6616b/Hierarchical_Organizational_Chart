/**
 * Tree Layout Algorithm
 * 簡化的 Reingold-Tilford 演算法
 * 計算樹狀結構的 x, y 座標
 */

const NODE_WIDTH = 160
const NODE_HEIGHT = 70
const H_GAP = 24       // 水平間距
const V_GAP = 90       // 垂直間距 (expand button 佔空間)

/**
 * 樹節點
 */
export class TreeNode {
  constructor(data, parent = null) {
    this.data = data
    this.parent = parent
    this.children = []
    this.depth = parent ? parent.depth + 1 : 0

    // 佈局計算結果
    this.x = 0
    this.y = 0
    this.width = NODE_WIDTH
    this.height = NODE_HEIGHT

    // 互動狀態
    this.expanded = false
    this.hasChildren = false // 是否有下線（DB 中）
    this.childrenLoaded = false
    this.visible = true
    this.highlighted = false
    this.hovered = false
    this.dimmed = false  // 聚焦效果：是否降低透明度

    // 群組節點（智慧篩選用）
    this.isGroupNode = false
    this.groupCount = 0
    this.groupedMembers = [] // 被隱藏的會員資料
  }

  get isLeaf() {
    return this.children.length === 0 && !this.hasChildren
  }

  get isCollapsed() {
    return this.hasChildren && !this.expanded
  }

  /** 取得所有可見後代 */
  getVisibleDescendants() {
    const result = []
    if (!this.expanded) return result
    for (const child of this.children) {
      result.push(child)
      result.push(...child.getVisibleDescendants())
    }
    return result
  }

  /** 取得祖先鏈 (不含自己) */
  getAncestors() {
    const result = []
    let cur = this.parent
    while (cur) {
      result.unshift(cur)
      cur = cur.parent
    }
    return result
  }
}

/**
 * 計算子樹尺寸與相對佈局
 * 因為要支援 grid，我們不僅回傳 width，還要記錄 grid 的排列
 */
const MAX_COLS = 8;
const GRID_V_GAP = 30; // 緊湊的垂直間距

function computeSubtreeLayout(node) {
  if (!node.expanded || node.children.length === 0) {
    node.subtreeWidth = node.width
    node.childrenLayout = []
    return node.subtreeWidth
  }

  // 分類 children：一段一段的。如果連續的 leaf 數量 > MAX_COLS，就變成 grid block
  const layoutItems = []
  let currentLeaves = []

  const flushLeaves = () => {
    if (currentLeaves.length > 0) {
      if (currentLeaves.length <= MAX_COLS) {
        // 不夠多，當作一般水平排列
        currentLeaves.forEach(c => layoutItems.push({ type: 'single', node: c, width: c.width }))
      } else {
        // 變成 grid block
        const cols = Math.min(MAX_COLS, currentLeaves.length)
        const rows = Math.ceil(currentLeaves.length / cols)
        const gridWidth = cols * NODE_WIDTH + (cols - 1) * H_GAP
        layoutItems.push({ type: 'grid', nodes: currentLeaves, cols, rows, width: gridWidth })
      }
      currentLeaves = []
    }
  }

  for (const child of node.children) {
    const isVisuallyLeaf = !child.expanded || child.children.length === 0
    if (isVisuallyLeaf) {
      currentLeaves.push(child)
    } else {
      flushLeaves()
      const cw = computeSubtreeLayout(child)
      layoutItems.push({ type: 'single', node: child, width: cw })
    }
  }
  flushLeaves()

  // 計算所有 block 的總寬度
  let totalWidth = 0
  for (let i = 0; i < layoutItems.length; i++) {
    if (i > 0) totalWidth += H_GAP
    totalWidth += layoutItems[i].width
  }

  node.subtreeWidth = Math.max(node.width, totalWidth)
  node.childrenLayout = layoutItems
  return node.subtreeWidth
}

/**
 * 計算佈局 (第二遍：分配 x, y 座標)
 */
function layoutPass(node, startX, currentY) {
  node.y = currentY

  if (!node.expanded || node.children.length === 0) {
    node.x = startX + node.width / 2
    return
  }

  const items = node.childrenLayout
  let cx = startX

  // 先試著算所有子節點/Grid 的預期 x 中心
  let firstChildX = null
  let lastChildX = null
  
  // 為了畫線好看，我們把 y 往下推標準距離
  const childrenBaseY = currentY + NODE_HEIGHT + V_GAP

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.type === 'single') {
      layoutPass(item.node, cx, childrenBaseY)
      if (firstChildX === null) firstChildX = item.node.x
      lastChildX = item.node.x
      cx += item.width + H_GAP
    } else if (item.type === 'grid') {
      const { nodes, cols } = item
      let gridStartX = cx
      for (let j = 0; j < nodes.length; j++) {
        const cNode = nodes[j]
        const colIdx = j % cols
        const rowIdx = Math.floor(j / cols)
        cNode.x = gridStartX + colIdx * (NODE_WIDTH + H_GAP) + NODE_WIDTH / 2
        cNode.y = childrenBaseY + rowIdx * (NODE_HEIGHT + GRID_V_GAP)
        
        if (firstChildX === null && j === 0) firstChildX = cNode.x
        if (j === cols - 1 || j === nodes.length - 1) lastChildX = cNode.x
      }
      cx += item.width + H_GAP
    }
  }

  // 父節點置中於子節點之間
  if (firstChildX !== null && lastChildX !== null) {
    node.x = (firstChildX + lastChildX) / 2
  } else {
    node.x = startX + node.width / 2
  }
}

/**
 * 計算完整樹的佈局
 * @param {TreeNode} root
 * @returns {{ nodes: TreeNode[], links: Array, bounds: {minX, minY, maxX, maxY} }}
 */
export function computeLayout(root) {
  if (!root) return { nodes: [], links: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }

  // 第一遍：計算尺寸與 Grid 分佈
  computeSubtreeLayout(root)

  // 第二遍：分配實體座標
  layoutPass(root, 0, 0)

  // 收集所有可見節點
  const nodes = [root, ...root.getVisibleDescendants()]

  // 置中：讓座標以 root 為原點
  const offsetX = root.x
  for (const n of nodes) {
    n.x -= offsetX
  }

  // 收集連線
  const links = []
  for (const n of nodes) {
    if (n.parent && nodes.includes(n.parent)) {
      links.push({ source: n.parent, target: n })
    }
  }

  // bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.width / 2)
    maxX = Math.max(maxX, n.x + n.width / 2)
    minY = Math.min(minY, n.y)
    maxY = Math.max(maxY, n.y + n.height)
  }

  return { nodes, links, bounds: { minX, minY, maxX, maxY } }
}

export { NODE_WIDTH, NODE_HEIGHT, H_GAP, V_GAP }
