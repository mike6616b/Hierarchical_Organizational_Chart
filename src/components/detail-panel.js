import { getMemberDetail, getMemberTotalTransactions } from '../api/supabase.js'
import { getLevelDotColor } from '../utils/colors.js'

export class DetailPanel {
  constructor(el, closeBtn, contentEl, loadingEl) {
    this.el = el
    this.closeBtn = closeBtn
    this.contentEl = contentEl
    this.loadingEl = loadingEl
    this.isOpen = false
    
    this.closeBtn.addEventListener('click', () => this.hide())
    
    // Add backdrop logic if needed, but our layout uses absolute positioning on the right
    // Click outside to close can be handled in main.js
  }
  
  escapeHtml(str) {
    if (!str) return '-'
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  formatDate(dateStr) {
    if (!dateStr) return '-'
    // 取得 YYYY-MM-DD
    return dateStr.split('T')[0]
  }

  async show(memberInfo, startDate, endDate) {
    this.currentMemberInfo = memberInfo
    this.isOpen = true
    this.el.style.transform = 'translateX(0)'
    
    // Clear old content
    this.contentEl.innerHTML = ''
    this.contentEl.style.display = 'none'
    this.loadingEl.style.display = 'flex'
    
    // Fetch detailed info
    const [m, tx] = await Promise.all([
      getMemberDetail(memberInfo.member_no),
      getMemberTotalTransactions(memberInfo.member_no, startDate, endDate)
    ])
    
    this.loadingEl.style.display = 'none'
    this.contentEl.style.display = 'block'
    
    if (!m) {
      this.contentEl.innerHTML = `<div class="error-msg">無法讀取資料，請確認權限或網路連線。</div>`
      return
    }

    const levelColor = getLevelDotColor(m.level)
    
    // Build HTML blocks
    this.contentEl.innerHTML = `
      <div class="dp-profile">
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
    `
  }

  hide() {
    this.isOpen = false
    this.el.style.transform = 'translateX(100%)'
  }
}
