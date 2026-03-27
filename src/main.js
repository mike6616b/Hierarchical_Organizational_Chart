/**
 * 組織架構圖分析系統 - 主程式
 * Entry point: Auth Check → 搜尋 → 載入 → 渲染
 */

import { searchMember, getAncestors, getDirectChildren, getSubtreeStats, getSubtreeTransactionStats, getMembersWithOrders } from './api/supabase.js'
import { TreeCanvas } from './components/tree-canvas.js'
import { TreeNode, computeLayout } from './utils/tree-layout.js'
import { getLevelDotColor } from './utils/colors.js'
import { sanitizeSearchInput, isValidDate, validateDateRange } from './utils/sanitize.js'
import { DetailPanel } from './components/detail-panel.js'

// ============================================================
// Auth Gate (Table-based, localStorage session)
// ============================================================
const authLoading = document.getElementById('authLoading')
const appEl = document.getElementById('app')

  ; (() => {
    const session = localStorage.getItem('org_chart_session')
    let isLoggedIn = false
    if (session) {
      try {
        const parsed = JSON.parse(session)
        if (parsed && parsed.login_account) isLoggedIn = true
      } catch { }
    }

    if (!isLoggedIn) {
      // 未登入 → 直接跳轉，不會閃到主畫面
      window.location.replace('./login.html')
      return
    }

    // 已登入 → 顯示主畫面
    appEl.style.display = ''
    authLoading.classList.add('fade-out')
    setTimeout(() => authLoading.remove(), 300)
  })()

// Logout
document.getElementById('btnLogout')?.addEventListener('click', () => {
  localStorage.removeItem('org_chart_session')
  window.location.replace('./login.html')
})

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
let filterConfig = {       // 智慧篩選 dropdown state
  checkInventory: true,
  inventoryMax: 1,
  checkOrders: true,
  matchType: 'and',        // 'or' | 'and'
}
let nodeMap = new Map()    // node_path -> TreeNode
let allChildrenCache = new Map() // node_path -> raw children data (before filter)

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
  document.getElementById('dpLoading'),
  document.getElementById('btnDetailCompare')
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

  // 🛡️ 前端防護：如果是純數字（查編號）就不限長度，否則中英文至少要 2 個字元
  const isNumeric = /^\d+$/.test(val)
  if (!isNumeric && val.length < 2) {
    hideSearchResults()
    return
  }

  // ⏳ 將防抖時間從 300ms 拉長到 500ms，對資料庫更友善，也不影響正常打字體驗
  searchTimer = setTimeout(() => performSearch(val), 500)
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
    const nodePath = member.node_path

    // 1 & 2. 並發取祖先鏈與直接下線
    const [ancestors, children] = await Promise.all([
      getAncestors(nodePath),
      getDirectChildren(nodePath)
    ])

    // 3. 建構樹
    await buildTree(ancestors, member, children)

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
async function buildTree(ancestors, targetMember, children) {
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
  nodeMap = new Map()

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

  // 快取原始 children 資料
  allChildrenCache.set(targetMember.node_path, children)

  // 建下線節點（套用篩選）
  await appendChildNodes(targetNode, children)

  treeRoot = root

  // 計算佈局並渲染
  const layout = computeLayout(root)
  treeCanvas.setData(layout.nodes, layout.links, layout.bounds)
  treeCanvas.centerOnNode(targetNode)
}

/**
 * 將 children 加入父節點，應用篩選邏輯
 */
async function appendChildNodes(parentNode, children) {
  parentNode.children = []

  // 是否有啟用任何過濾條件
  const hasFilter = filterConfig.checkInventory || filterConfig.checkOrders

  if (!hasFilter) {
    // 不篩選：全部顯示
    for (const child of children) {
      const childNode = new TreeNode(child, parentNode)
      childNode.hasChildren = true
      childNode.childrenLoaded = false
      parentNode.children.push(childNode)
      nodeMap.set(child.node_path, childNode)
    }
    return
  }

  // 準備判斷訂單條件（批次查詢）
  let membersWithOrders = new Set()
  if (filterConfig.checkOrders && children.length > 0) {
    const memberNos = children.map(c => c.member_no)
    const start = startDateInput.value
    const end = endDateInput.value
    membersWithOrders = await getMembersWithOrders(memberNos, start, end)
  }

  const active = []
  const inactive = [] // 要合併成群組的

  for (const child of children) {
    let hideByInventory = false
    let hideByOrders = false

    if (filterConfig.checkInventory) {
      const inv = Number(child.inventory) || 0
      if (inv < filterConfig.inventoryMax) {
        hideByInventory = true
      }
    }

    if (filterConfig.checkOrders) {
      if (!membersWithOrders.has(child.member_no)) {
        hideByOrders = true
      }
    }

    let shouldHide = false
    if (filterConfig.matchType === 'or') {
      shouldHide = hideByInventory || hideByOrders
    } else {
      // AND：必須同時滿足庫存 < X 且 無訂單 才會被隱藏
      // 如果只有其中一個勾選，且不滿足另一個？
      // 這裡使用者預期的 AND 應該是：勾選的條件必須全部成立才隱藏
      shouldHide = (filterConfig.checkInventory ? hideByInventory : true) &&
        (filterConfig.checkOrders ? hideByOrders : true)
    }

    if (shouldHide) {
      inactive.push(child)
    } else {
      active.push(child)
    }
  }

  // 加入不被隱藏的活躍節點
  for (const child of active) {
    const childNode = new TreeNode(child, parentNode)
    childNode.hasChildren = true
    childNode.childrenLoaded = false
    parentNode.children.push(childNode)
    nodeMap.set(child.node_path, childNode)
  }

  // 被隱藏節點 → 合併為群組節點
  if (inactive.length > 0) {
    const groupNode = new TreeNode(
      { name: `+${inactive.length} 名其他會員`, member_no: '__group__', level: '' },
      parentNode
    )
    groupNode.isGroupNode = true
    groupNode.groupCount = inactive.length
    groupNode.groupedMembers = inactive
    groupNode.hasChildren = false
    parentNode.children.push(groupNode)
  }
}

// ============================================================
// 節點互動
// ============================================================
async function handleNodeClick(node) {
  if (!node) return

  // 群組節點：展開被隱藏的會員
  if (node.isGroupNode) {
    expandGroupNode(node)
    return
  }

  // 有子節點或可能有子節點 → 鑒取導航（重新以該節點為中心）
  if (node.hasChildren || node.children.length > 0) {
    drillInto(node)
    return
  }

  // 葉子節點 → 顯示詳細面板
  if (detailPanel.isCompareMode()) return
  const start = startDateInput.value
  const end = endDateInput.value
  detailPanel.show(node.data, start, end)
}

/**
 * 鑒取導航：以被點擊的節點為新中心重新載入樹
 */
async function drillInto(node) {
  const member = node.data
  currentMember = member
  searchInput.value = member.name + (member.company_name ? ` (${member.company_name})` : '')
  btnClearSearch.style.display = 'flex'

  try {
    const nodePath = member.node_path

    // 效能優化：直接從當前 TreeNode 往上找祖先，不需發送網路請求 (O(1) in-memory)
    const ancestors = []
    let curr = node.parent
    while (curr) {
      ancestors.push(curr.data)
      curr = curr.parent
    }
    ancestors.reverse() // 確保順序由根向下

    // 僅需查詢下線
    const children = await getDirectChildren(nodePath)

    await buildTree(ancestors, member, children)

    // ③ 聚焦效果：讓披點擊節點的同層兄弟 dimmed
    applyFocusDimming(member.node_path)

    updateStats(nodePath)
    updateBreadcrumb(ancestors, member)
  } catch (err) {
    console.error('Drill-in error:', err)
  }
}

/**
 * 展開群組節點：將被隱藏的會員加回樹中
 */
function expandGroupNode(groupNode) {
  const parent = groupNode.parent
  if (!parent) return

  // 移除群組節點
  parent.children = parent.children.filter(c => c !== groupNode)

  // 加回被隱藏的會員
  for (const child of groupNode.groupedMembers) {
    const childNode = new TreeNode(child, parent)
    childNode.hasChildren = true
    childNode.childrenLoaded = false
    childNode.dimmed = true // 稍微 dimmed 以區分原本就顯示的
    parent.children.push(childNode)
    nodeMap.set(child.node_path, childNode)
  }

  rerender()
}

/**
 * ③ 聚焦效果：被點擊節點的同層兄弟降低透明度
 */
function applyFocusDimming(focusedPath) {
  if (!treeRoot) return

  const allNodes = [treeRoot, ...treeRoot.getVisibleDescendants()]
  const focusedNode = nodeMap.get(focusedPath)
  if (!focusedNode) return

  // 找出焦點節點的父節點
  const parent = focusedNode.parent

  for (const node of allNodes) {
    // 同層兄弟（同一個 parent 但不是自己） → dimmed
    if (parent && node.parent === parent && node !== focusedNode) {
      node.dimmed = true
    } else {
      node.dimmed = false
    }
  }

  rerender()
}

function handleNodeHover(node) {
  // 未來可加 tooltip
}

function handleNodeContext(node, event) {
  event.preventDefault()
  if (!node || node.isGroupNode) return
  const start = startDateInput.value
  const end = endDateInput.value
  if (detailPanel.isCompareMode()) {
    detailPanel.addCompareMember(node.data, start, end)
    return
  }
  detailPanel.show(node.data, start, end)
}

function rerender() {
  if (!treeRoot) return
  const layout = computeLayout(treeRoot)
  treeCanvas.setData(layout.nodes, layout.links, layout.bounds)
}

// ============================================================
// 隱藏條件選單 (Filter Dropdown)
// ============================================================
const btnFilterMenu = document.getElementById('btnFilterMenu')
const filterDropdown = document.getElementById('filterDropdown')
const btnApplyFilter = document.getElementById('btnApplyFilter')
const chkFilterInventory = document.getElementById('chkFilterInventory')
const numFilterInventory = document.getElementById('numFilterInventory')
const chkFilterOrders = document.getElementById('chkFilterOrders')
const radioFilterMatch = document.getElementsByName('filterMatch')

chkFilterInventory.checked = filterConfig.checkInventory
numFilterInventory.value = String(filterConfig.inventoryMax)
chkFilterOrders.checked = filterConfig.checkOrders
for (const radio of radioFilterMatch) {
  radio.checked = radio.value === filterConfig.matchType
}
btnFilterMenu.classList.add('active')

// Toggle dropdown
btnFilterMenu?.addEventListener('click', (e) => {
  e.stopPropagation()
  const isHidden = filterDropdown.style.display === 'none'
  filterDropdown.style.display = isHidden ? 'flex' : 'none'
  if (filterConfig.checkInventory || filterConfig.checkOrders) {
    btnFilterMenu.classList.add('active')
  } else {
    btnFilterMenu.classList.remove('active')
  }
})

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.filter-dropdown-container')) {
    filterDropdown.style.display = 'none'
  }
})

filterDropdown?.addEventListener('click', (e) => {
  e.stopPropagation() // 防止點擊選單內部時關閉
})

// 套用篩選
btnApplyFilter?.addEventListener('click', () => {
  filterConfig.checkInventory = chkFilterInventory.checked
  filterConfig.inventoryMax = Number(numFilterInventory.value) || 1
  filterConfig.checkOrders = chkFilterOrders.checked

  for (const radio of radioFilterMatch) {
    if (radio.checked) filterConfig.matchType = radio.value
  }

  filterDropdown.style.display = 'none'

  // Update button active state
  if (filterConfig.checkInventory || filterConfig.checkOrders) {
    btnFilterMenu.classList.add('active')
  } else {
    btnFilterMenu.classList.remove('active')
  }

  // 重新載入以套用新篩選（這會觸發 buildTree 和 appendChildNodes）
  if (currentMember) {
    selectMember(currentMember)
  }
})


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

    // 利用 Promise.all 同時發起兩個統計查詢
    const [result, txResult] = await Promise.all([
      getSubtreeStats(nodePath, start, end),
      getSubtreeTransactionStats(nodePath, start, end)
    ])

    if (Array.isArray(result) && result[0]) {
      const s = result[0]
      animateNumber('statMembers', s.total_members || 0)
      animateNumber('statHighPerf', s.total_high_performers || 0)
    }

    if (txResult) {
      animateNumber('statOrders', txResult.total_amount || 0, 800, '$')
      animateNumber('statPickup', txResult.total_quantity || 0)
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
    // 如果有勾選「無訂單」隱藏條件，日期改變就需要重繪樹狀圖
    if (filterConfig.checkOrders) {
      selectMember(currentMember)
    } else {
      updateStats(currentMember.node_path)
    }
  }

  if (detailPanel.isOpen) {
    detailPanel.refresh(s, e)
  }
})

// ============================================================
// 麵包屑
// ============================================================
function updateBreadcrumb(ancestors, target) {
  breadcrumb.innerHTML = ''
  breadcrumb.style.display = 'none'
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

// ============================================================
// 動畫工具 (MagicUI Number Ticker)
// ============================================================
function animateNumber(elementId, endValue, duration = 800, prefix = '') {
  const el = document.getElementById(elementId)
  if (!el) return

  const currentText = el.textContent.replace(/[^0-9.-]/g, '')
  const startValue = parseInt(currentText, 10) || 0

  if (startValue === endValue) {
    el.textContent = prefix + endValue.toLocaleString()
    return
  }

  const startTime = performance.now()

  function update(currentTime) {
    const elapsed = currentTime - startTime
    const progress = Math.min(elapsed / duration, 1)

    // easeOutExpo 動畫曲線：先快後慢
    const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)
    const currentValue = Math.floor(startValue + (endValue - startValue) * easeProgress)

    el.textContent = prefix + currentValue.toLocaleString()

    if (progress < 1) {
      requestAnimationFrame(update)
    } else {
      el.textContent = prefix + endValue.toLocaleString() // 確保最後精準到位
    }
  }

  requestAnimationFrame(update)
}
