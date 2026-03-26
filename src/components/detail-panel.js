import { getMemberDetail, getMemberTotalTransactions } from '../api/supabase.js'
import { getLevelDotColor } from '../utils/colors.js'

export class DetailPanel {
  constructor(el, closeBtn, contentEl, loadingEl) {
    this.el = el
    this.closeBtn = closeBtn
    this.contentEl = contentEl
    this.loadingEl = loadingEl
    this.isOpen = false

    // 狀態管理
    this.pinnedMembers = [] // 儲存已釘選的會員資料 { info, detail, tx }
    this.previewMember = null // 儲存當前點擊（預覽中）的會員資料

    this.closeBtn.addEventListener('click', () => this.hide())
  }

  escapeHtml(str) {
    if (!str) return '-'
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  formatDate(dateStr) {
    if (!dateStr) return '-'
    return dateStr.split('T')[0]
  }

  // 外部呼叫：當點擊架構圖節點時觸發
  async show(memberInfo, startDate, endDate) {
    this.isOpen = true
    this.el.style.transform = 'translateX(0)'

    // 檢查是否已經在釘選名單中
    const isAlreadyPinned = this.pinnedMembers.some(m => m.info.member_no === memberInfo.member_no)

    if (isAlreadyPinned) {
      // 如果已經釘選了，清空預覽區塊並直接重新渲染
      this.previewMember = null
      this.render()
      return
    }

    // 如果沒有釘選也沒有預覽，顯示 Loading
    if (this.pinnedMembers.length === 0) {
      this.contentEl.style.display = 'none'
      this.loadingEl.style.display = 'flex'
    }

    // 只抓取「新點擊(預覽)」這位會員的資料
    const [detail, tx] = await Promise.all([
      getMemberDetail(memberInfo.member_no),
      getMemberTotalTransactions(memberInfo.member_no, startDate, endDate)
    ])

    this.loadingEl.style.display = 'none'
    this.contentEl.style.display = 'flex' // 配合 style.css 的多欄 Flex 排版

    // 設定為預覽會員
    this.previewMember = { info: memberInfo, detail, tx }

    this.render()
  }

  // 加入比較 (Pin)
  pinPreview() {
    if (this.pinnedMembers.length >= 3) {
      alert('最多只能同時比較 3 位會員喔！')
      return
    }
    if (this.previewMember) {
      this.pinnedMembers.push(this.previewMember)
      this.previewMember = null
      this.render()
    }
  }

  // 移除比較 (Unpin)
  unpin(memberNo) {
    this.pinnedMembers = this.pinnedMembers.filter(m => m.info.member_no !== memberNo)

    // 如果全部清空了，且沒有預覽會員，就關閉側邊欄
    if (this.pinnedMembers.length === 0 && !this.previewMember) {
      this.hide()
    } else {
      this.render()
    }
  }

  // 負責將狀態渲染到 DOM
  render() {
    this.contentEl.innerHTML = ''

    // 觸發 Blur Fade In 動畫
    this.contentEl.classList.remove('blur-fade-in')
    void this.contentEl.offsetWidth // Trigger reflow
    this.contentEl.classList.add('blur-fade-in')

    let html = ''

    // 1. 渲染已釘選的會員卡片
    this.pinnedMembers.forEach(m => {
      html += this.generateColumnHtml(m, false)
    })

    // 2. 渲染預覽中的會員卡片 (放在最右邊)
    if (this.previewMember) {
      html += this.generateColumnHtml(this.previewMember, true)
    }

    this.contentEl.innerHTML = html

    // 3. 綁定按鈕事件
    const pinBtn = this.contentEl.querySelector('.btn-pin')
    if (pinBtn) {
      pinBtn.addEventListener('click', () => this.pinPreview())
    }

    const unpinBtns = this.contentEl.querySelectorAll('.btn-unpin')
    unpinBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const no = e.currentTarget.dataset.no
        this.unpin(no)
      })
    })
  }

  // 產生單一會員直行的 HTML
  generateColumnHtml(data, isPreview) {
    const { detail: m, tx } = data

    if (!m) {
      return `
        <div class="dp-column">
          <div class="error-msg">無法讀取資料，請確認權限或網路連線。</div>
        </div>
      `
    }

    const levelColor = getLevelDotColor(m.level)

    // 判斷按鈕類型 (預覽狀態顯示 Pin，釘選狀態顯示 Unpin)
    const actionHtml = isPreview
      ? `<button class="btn-pin">📌 加入比較 (還可加 ${3 - this.pinnedMembers.length} 位)</button>`
      : `<div class="dp-column-header">
           <span></span>
           <button class="btn-unpin" data-no="${m.member_no}" title="移除">×</button>
         </div>`

    return `
      <div class="dp-column">
        ${actionHtml}
        
        <div class="dp-profile" style="margin-bottom: 24px;">
          <div class="dp-avatar" style="border-color: ${levelColor}">
            ${this.escapeHtml(m.name).charAt(0)}
          </div>
          <div class="dp-name-group">
            <h3 class="dp-name">${this.escapeHtml(m.name)}</h3>
            ${m.company_name ? `<div class="dp-company">${this.escapeHtml(m.company_name)}</div>` : ''}
            <div class="dp-level">
              <span class="legend-dot" style="background:${levelColor}"></span>
              ${this.escapeHtml(m.level)}
            </div>
          </div>
        </div>
        
        <div class="dp-section">
          <h4 class="dp-section-title">帳號資訊</h4>
          <div class="dp-grid">
            <div class="dp-item">
              <div class="dp-label">會員編號</div>
              <div class="dp-value">${this.escapeHtml(m.member_no)}</div>
            </div>
            <div class="dp-item">
              <div class="dp-label">目前庫存</div>
              <div class="dp-value highlight">${this.escapeHtml(m.inventory)}</div>
            </div>
            <div class="dp-item">
              <div class="dp-label">推薦人編號</div>
              <div class="dp-value">${this.escapeHtml(m.inviter_no)}</div>
            </div>
            <div class="dp-item">
              <div class="dp-label">註冊日期</div>
              <div class="dp-value">${this.formatDate(m.registered_at)}</div>
            </div>
          </div>
        </div>

        <div class="dp-section">
          <h4 class="dp-section-title">個人資料</h4>
          <div class="dp-grid">
            <div class="dp-item">
              <div class="dp-label">國籍</div>
              <div class="dp-value">${this.escapeHtml(m.nationality)}</div>
            </div>
            <div class="dp-item">
              <div class="dp-label">生日</div>
              <div class="dp-value">${this.formatDate(m.birthday)}</div>
            </div>
            <div class="dp-item dp-full">
              <div class="dp-label">手機號碼</div>
              <div class="dp-value">${this.escapeHtml(m.phone)}</div>
            </div>
            <div class="dp-item dp-full">
              <div class="dp-label">電子郵件</div>
              <div class="dp-value">${this.escapeHtml(m.email)}</div>
            </div>
          </div>
        </div>

        <div class="dp-section">
          <h4 class="dp-section-title">歷史交易總計</h4>
          <div class="dp-grid">
            <div class="dp-item">
              <div class="dp-label">總訂單金額</div>
              <div class="dp-value highlight">$${this.escapeHtml(tx.amount.toLocaleString())}</div>
            </div>
            <div class="dp-item">
              <div class="dp-label">總訂單數量</div>
              <div class="dp-value highlight">${this.escapeHtml(tx.quantity.toLocaleString())}</div>
            </div>
          </div>
        </div>
      </div>
    `
  }

  hide() {
    this.isOpen = false
    this.el.style.transform = 'translateX(100%)'
    // 關閉時清空預覽狀態，下次打開才是乾淨的
    this.previewMember = null
  }
}
