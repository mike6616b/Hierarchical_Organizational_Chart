/**
 * 組織架構圖分析系統 - 主程式
 * Entry point: 搜尋 → 載入 → 渲染
 */

import { searchMember, getAncestors, getDirectChildren, getSubtreeStats, getSubtreeTransactionStats } from './api/supabase.js'
import { TreeCanvas } from './components/tree-canvas.js'
import { TreeNode, computeLayout } from './utils/tree-layout.js'
import { getLevelDotColor } from './utils/colors.js'
import { sanitizeSearchInput, isValidDate, validateDateRange } from './utils/sanitize.js'
import { DetailPanel } from './components/detail-panel.js'

// ============================================================
// DOM refs
// ============================================================
const searchInput = document.getElementById('searchInput')
const btnClearSearch = document.getElementById('btnClearSearch')
const searchResultsEl = document.getElementById('searchResults')
const canvasEl = document.getElementById('treeCanvas')
const emptyState = document.getElementById('emptyState')
const zoomControls = document.getElementById('zoomControls')
const legend = document.getElementById('legend')
const breadcrumb = document.getElementById('breadcrumb')
const statsBar = document.getElementById('statsBar')
const startDateInput = document.getElementById('startDate')
const endDateInput = document.getElementById('endDate')

// ============================================================
// State
// ============================================================
let treeRoot = null        // TreeNode root
let treeCanvas = null      // TreeCanvas instance
let currentMember = null   // 目前查詢的會員
let searchTimer = null     // debounce timer
let activeResultIdx = -1   // keyboard navigation

// ============================================================
// Init
// ============================================================
treeCanvas = new TreeCanvas(canvasEl, {
  onNodeClick: handleNodeClick,
  onNodeHover: handleNodeHover,
  onNodeContext: handleNodeContext,
})

const detailPanel = new DetailPanel(
  document.getElementById('detailPanel'),
  document.getElementById('btnDetailClose'),
  document.getElementById('dpContent'),
  document.getElementById('dpLoading')
)

// 預設日期範圍：今年
const now = new Date()
const yearStart = `${now.getFullYear()}-01-01`
const today = now.toISOString().split('T')[0]
startDateInput.value = yearStart
endDateInput.value = today

// ============================================================
// 搜尋
// ============================================================
searchInput.addEventListener('input', () => {
  const val = searchInput.value.trim()
  btnClearSearch.style.display = val ? 'flex' : 'none'

  clearTimeout(searchTimer)
  if (!val) {
    hideSearchResults()
    return
  }

  searchTimer = setTimeout(() => performSearch(val), 300)
})

searchInput.addEventListener('keydown', (e) => {
  const items = searchResultsEl.querySelectorAll('.search-result-item')
  if (!items.length) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeResultIdx = Math.min(activeResultIdx + 1, items.length - 1)
    updateActiveResult(items)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeResultIdx = Math.max(activeResultIdx - 1, 0)
    updateActiveResult(items)
  } else if (e.key === 'Enter' && activeResultIdx >= 0) {
    e.preventDefault()
    items[activeResultIdx]?.click()
  } else if (e.key === 'Escape') {
    hideSearchResults()
  }
})

btnClearSearch.addEventListener('click', () => {
  searchInput.value = ''
  btnClearSearch.style.display = 'none'
  hideSearchResults()
})

// 點擊外部關閉搜尋結果
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-group')) hideSearchResults()
})

async function performSearch(keyword) {
  const sanitized = sanitizeSearchInput(keyword)
  if (!sanitized) return

  searchResultsEl.innerHTML = '<div class="search-loading"><span class="spinner"></span> 搜尋中...</div>'
  searchResultsEl.style.display = 'block'
  activeResultIdx = -1

  try {
    const results = await searchMember(sanitized)

    if (!results.length) {
      searchResultsEl.innerHTML = '<div class="search-no-result">找不到符合的會員</div>'
      return
    }

    searchResultsEl.innerHTML = results.map((m, i) => {
      const levelColor = getLevelDotColor(m.level)
      const companyStr = m.company_name ? `<span class="result-company">${escapeHtml(m.company_name)}</span>` : ''
      return `
        <div class="search-result-item" data-index="${i}">
          <span class="result-level-dot" style="background:${levelColor}"></span>
          <div>
            <span class="result-name">${escapeHtml(m.name)}</span>
            ${companyStr}
          </div>
          <span class="result-meta">${escapeHtml(m.level || '')} · ${escapeHtml(m.member_no)}</span>
        </div>
      `
    }).join('')

    // Bind clicks
    searchResultsEl.querySelectorAll('.search-result-item').forEach((el, i) => {
      el.addEventListener('click', () => selectMember(results[i]))
    })
  } catch (err) {
    console.error('Search error:', err)
    searchResultsEl.innerHTML = '<div class="search-no-result">搜尋失敗，請確認網路連線</div>'
  }
}

function updateActiveResult(items) {
  items.forEach((el, i) => el.classList.toggle('active', i === activeResultIdx))
  items[activeResultIdx]?.scrollIntoView({ block: 'nearest' })
}

function hideSearchResults() {
  searchResultsEl.style.display = 'none'
  searchResultsEl.innerHTML = ''
  activeResultIdx = -1
}

// ============================================================
// 選取會員 → 載入關係樹
// ============================================================
async function selectMember(member) {
  hideSearchResults()
  currentMember = member
  searchInput.value = member.name + (member.company_name ? ` (${member.company_name})` : '')
  btnClearSearch.style.display = 'flex'

  // 顯示 loading
  showTreeUI()

  try {
    // 1. 取祖先鏈
    const nodePath = member.node_path
    const ancestors = await getAncestors(nodePath)

    // 2. 取直接下線
    const children = await getDirectChildren(nodePath)

    // 3. 建構樹
    buildTree(ancestors, member, children)

    // 4. 更新統計
    updateStats(nodePath)

    // 5. 更新麵包屑
    updateBreadcrumb(ancestors, member)

  } catch (err) {
    console.error('Load tree error:', err)
  }
}

/**
 * 建構 TreeNode 樹並渲染
 */
function buildTree(ancestors, targetMember, children) {
  // 排序祖先：從上到下 (短 path → 長 path)
  const sorted = [...ancestors].sort((a, b) => {
    const aLen = (a.node_path || '').split('.').length
    const bLen = (b.node_path || '').split('.').length
    return aLen - bLen
  })

  // 過濾掉目標自己（如果包含在 ancestors 裡）
  const ancestorData = sorted.filter(a => a.member_no !== targetMember.member_no)

  // 建根節點（最頂層祖先）
  let root = null
  const nodeMap = new Map()

  // 建祖先節點
  for (const data of ancestorData) {
    const parentPath = getParentPath(data.node_path)
    const parent = parentPath ? nodeMap.get(parentPath) : null
    const node = new TreeNode(data, parent || null)
    node.expanded = true
    node.hasChildren = true
    node.childrenLoaded = false

    if (parent) {
      parent.children.push(node)
    }

    nodeMap.set(data.node_path, node)
    if (!root) root = node
  }

  // 建目標節點
  const targetParentPath = getParentPath(targetMember.node_path)
  const targetParent = targetParentPath ? nodeMap.get(targetParentPath) : null
  const targetNode = new TreeNode(targetMember, targetParent || null)
  targetNode.expanded = true
  targetNode.highlighted = true
  targetNode.hasChildren = children.length > 0
  targetNode.childrenLoaded = true

  if (targetParent) {
    targetParent.children.push(targetNode)
  }
  nodeMap.set(targetMember.node_path, targetNode)

  if (!root) root = targetNode

  // 建下線節點
  for (const child of children) {
    const childNode = new TreeNode(child, targetNode)
    childNode.hasChildren = true  // 假設都可能有下線
    childNode.childrenLoaded = false
    targetNode.children.push(childNode)
    nodeMap.set(child.node_path, childNode)
  }

  treeRoot = root

  // 計算佈局並渲染
  const layout = computeLayout(root)
  treeCanvas.setData(layout.nodes, layout.links, layout.bounds)
  treeCanvas.centerOnNode(targetNode)
}

// ============================================================
// 節點互動
// ============================================================
async function handleNodeClick(node) {
  if (!node) return

  if (node.expanded && node.childrenLoaded) {
    // 收合
    node.expanded = false
    node.children = []
    node.childrenLoaded = false
    rerender()
    return
  }

  if (!node.childrenLoaded) {
    // Lazy load 下線
    try {
      const children = await getDirectChildren(node.data.node_path)
      node.children = children.map(c => {
        const child = new TreeNode(c, node)
        child.hasChildren = true
        return child
      })
      node.childrenLoaded = true
      node.expanded = true

      if (children.length === 0) {
        node.hasChildren = false
      }
    } catch (err) {
      console.error('Load children error:', err)
      return
    }
  } else {
    node.expanded = !node.expanded
  }

  rerender()
}

function handleNodeHover(node) {
  // 未來可加 tooltip
}

function handleNodeContext(node, event) {
  event.preventDefault()
  const start = startDateInput.value
  const end = endDateInput.value
  detailPanel.show(node.data, start, end)
}

function rerender() {
  if (!treeRoot) return
  const layout = computeLayout(treeRoot)
  treeCanvas.setData(layout.nodes, layout.links, layout.bounds)
}

// ============================================================
// 統計
// ============================================================
async function updateStats(nodePath) {
  try {
    const start = startDateInput.value
    const end = endDateInput.value

    // Loading 狀態
    document.getElementById('statMembers').textContent = '...'
    document.getElementById('statOrders').textContent = '...'
    document.getElementById('statPickup').textContent = '...'
    document.getElementById('statHighPerf').textContent = '...'

    const result = await getSubtreeStats(nodePath, start, end)
    if (Array.isArray(result) && result[0]) {
      const s = result[0]
      document.getElementById('statMembers').textContent = (s.total_members || 0).toLocaleString()
      document.getElementById('statHighPerf').textContent = (s.total_high_performers || 0).toLocaleString()
    }

    const txResult = await getSubtreeTransactionStats(nodePath, start, end)
    if (txResult) {
      document.getElementById('statOrders').textContent = '$' + (txResult.total_amount || 0).toLocaleString()
      document.getElementById('statPickup').textContent = (txResult.total_quantity || 0).toLocaleString()
    }

  } catch (err) {
    console.error('Stats error:', err)
    // 如果 timeout 或發生錯誤，提示使用者
    document.getElementById('statMembers').textContent = '資料過大'
    document.getElementById('statOrders').textContent = '-'
    document.getElementById('statPickup').textContent = '-'
    document.getElementById('statHighPerf').textContent = '-'
  }
}

// 日期篩選
document.getElementById('btnApplyDate').addEventListener('click', () => {
  const s = startDateInput.value
  const e = endDateInput.value
  if (!validateDateRange(s, e)) {
    alert('請選擇有效的日期區間')
    return
  }
  if (currentMember) {
    updateStats(currentMember.node_path)
  }
  if (detailPanel.isOpen && detailPanel.currentMemberInfo) {
    detailPanel.show(detailPanel.currentMemberInfo, s, e)
  }
})

// ============================================================
// 麵包屑
// ============================================================
function updateBreadcrumb(ancestors, target) {
  const sorted = [...ancestors]
    .filter(a => a.member_no !== target.member_no)
    .sort((a, b) => {
      const aLen = (a.node_path || '').split('.').length
      const bLen = (b.node_path || '').split('.').length
      return aLen - bLen
    })

  let html = ''
  for (const a of sorted) {
    html += `<span class="breadcrumb-item" data-path="${escapeHtml(a.node_path)}">${escapeHtml(a.name)}</span>`
    html += '<span class="breadcrumb-sep">›</span>'
  }
  html += `<span class="breadcrumb-item current">${escapeHtml(target.name)}</span>`

  breadcrumb.innerHTML = html
  breadcrumb.style.display = 'flex'

  // Bind breadcrumb clicks → navigate to that member
  breadcrumb.querySelectorAll('.breadcrumb-item:not(.current)').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.dataset.path
      const member = [...ancestors].find(a => a.node_path === path)
      if (member) selectMember(member)
    })
  })
}

// ============================================================
// Zoom controls
// ============================================================
document.getElementById('btnZoomIn').addEventListener('click', () => treeCanvas.zoomIn())
document.getElementById('btnZoomOut').addEventListener('click', () => treeCanvas.zoomOut())
document.getElementById('btnFitView').addEventListener('click', () => treeCanvas.fitView())

// ============================================================
// UI 切換
// ============================================================
function showTreeUI() {
  emptyState.style.display = 'none'
  canvasEl.style.display = 'block'
  zoomControls.style.display = 'flex'
  legend.style.display = 'flex'
  statsBar.style.display = 'flex'
  // Trigger resize after display change
  setTimeout(() => treeCanvas._resize(), 0)
}

// ============================================================
// Helpers
// ============================================================
function getParentPath(nodePath) {
  if (!nodePath) return null
  const parts = nodePath.split('.')
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join('.')
}

function escapeHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
