import { getMemberDetail, getMemberTotalTransactions } from '../api/supabase.js'
import { getLevelDotColor } from '../utils/colors.js'

const MAX_COMPARE_MEMBERS = 3

export class DetailPanel {
  constructor(el, closeBtn, contentEl, loadingEl, compareBtn) {
    this.el = el
    this.closeBtn = closeBtn
    this.contentEl = contentEl
    this.loadingEl = loadingEl
    this.compareBtn = compareBtn

    this.isOpen = false
    this.mode = 'view'
    this.currentMemberInfo = null
    this.currentBundle = null
    this.compareMembers = []
    this.lastDateRange = { startDate: '', endDate: '' }

    this.closeBtn.addEventListener('click', () => this.hide())
    this.compareBtn?.addEventListener('click', () => this.toggleMode())
    this.updateHeaderState()
  }

  escapeHtml(str) {
    if (!str) return '-'
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  formatDate(dateStr) {
    if (!dateStr) return '-'
    return dateStr.split('T')[0]
  }

  formatCurrency(value) {
    const amount = Number(value) || 0
    return `$${amount.toLocaleString()}`
  }

  isCompareMode() {
    return this.mode === 'compare'
  }

  async loadMemberBundle(memberInfo, startDate, endDate) {
    const [detail, tx] = await Promise.all([
      getMemberDetail(memberInfo.member_no),
      getMemberTotalTransactions(memberInfo.member_no, startDate, endDate)
    ])

    return { info: memberInfo, detail, tx }
  }

  setLoading(isLoading) {
    this.loadingEl.style.display = isLoading ? 'flex' : 'none'
    this.contentEl.style.display = isLoading ? 'none' : 'flex'
  }

  updateHeaderState() {
    if (!this.compareBtn) return

    const label = this.isCompareMode() ? '檢視' : '比較'
    const iconPath = this.isCompareMode() ? 'm6 18 12-12M6 6l12 12' : 'M12 5v14M5 12h14'
    const icon = this.compareBtn.querySelector('svg path')
    const text = this.compareBtn.querySelector('span')

    if (icon) icon.setAttribute('d', iconPath)
    if (text) text.textContent = label
    this.compareBtn.disabled = !this.currentBundle && this.compareMembers.length === 0
  }

  async show(memberInfo, startDate, endDate) {
    this.isOpen = true
    this.currentMemberInfo = memberInfo
    this.lastDateRange = { startDate, endDate }
    this.el.style.transform = 'translateX(0)'

    this.setLoading(true)
    const memberBundle = await this.loadMemberBundle(memberInfo, startDate, endDate)

    this.currentBundle = memberBundle

    if (!this.isCompareMode()) {
      this.compareMembers = []
    }

    this.setLoading(false)
    this.render()
  }

  async addCompareMember(memberInfo, startDate, endDate) {
    if (!this.isCompareMode()) {
      await this.show(memberInfo, startDate, endDate)
      return
    }

    if (this.compareMembers.some(member => member.info.member_no === memberInfo.member_no)) {
      return
    }

    if (this.compareMembers.length >= MAX_COMPARE_MEMBERS) {
      alert('最多只能同時比較 3 位會員喔！')
      return
    }

    const memberBundle = await this.loadMemberBundle(memberInfo, startDate, endDate)
    this.compareMembers.push(memberBundle)
    this.render()
  }

  async refresh(startDate, endDate) {
    if (!this.isOpen) return

    this.lastDateRange = { startDate, endDate }
    this.setLoading(true)

    if (this.isCompareMode()) {
      this.compareMembers = await Promise.all(
        this.compareMembers.map(member => this.loadMemberBundle(member.info, startDate, endDate))
      )
      this.currentBundle = this.compareMembers[0] || null
      this.currentMemberInfo = this.currentBundle?.info || null
    } else if (this.currentMemberInfo) {
      this.currentBundle = await this.loadMemberBundle(this.currentMemberInfo, startDate, endDate)
    }

    this.setLoading(false)
    this.render()
  }

  enterCompareMode() {
    if (!this.currentBundle) return

    this.mode = 'compare'
    this.compareMembers = [this.currentBundle]
    this.render()
  }

  exitCompareMode() {
    const fallbackBundle = this.compareMembers[0] || this.currentBundle
    this.mode = 'view'
    this.compareMembers = []
    this.currentBundle = fallbackBundle || null
    this.currentMemberInfo = this.currentBundle?.info || null
    this.render()
  }

  toggleMode() {
    if (this.isCompareMode()) {
      this.exitCompareMode()
    } else {
      this.enterCompareMode()
    }
  }

  unpin(memberNo) {
    this.compareMembers = this.compareMembers.filter(member => member.info.member_no !== memberNo)

    if (this.compareMembers.length === 0) {
      if (this.currentBundle?.info.member_no === memberNo) {
        this.hide()
        return
      }
      this.exitCompareMode()
      return
    }

    this.currentBundle = this.compareMembers[0]
    this.currentMemberInfo = this.currentBundle.info
    this.render()
  }

  toggleSection(sectionId) {
    const toggle = this.contentEl.querySelector(`.dp-section-toggle[data-section="${sectionId}"]`)
    const body = this.contentEl.querySelector(`.dp-section-body[data-section="${sectionId}"]`)

    if (!toggle || !body) return

    const expanded = toggle.getAttribute('aria-expanded') === 'true'
    toggle.setAttribute('aria-expanded', String(!expanded))
    body.hidden = expanded
  }

  getRenderedMembers() {
    if (this.isCompareMode()) return this.compareMembers
    return this.currentBundle ? [this.currentBundle] : []
  }

  render() {
    this.contentEl.innerHTML = ''

    this.el.classList.toggle('is-compare-mode', this.isCompareMode())
    this.el.classList.toggle('is-view-mode', !this.isCompareMode())
    this.contentEl.classList.toggle('is-compare-mode', this.isCompareMode())
    this.contentEl.classList.toggle('is-view-mode', !this.isCompareMode())
    this.updateHeaderState()

    this.contentEl.classList.remove('blur-fade-in')
    void this.contentEl.offsetWidth
    this.contentEl.classList.add('blur-fade-in')

    const members = this.getRenderedMembers()
    this.contentEl.innerHTML = members
      .map((member, index) => this.generateColumnHtml(member, {
        isCompareMode: this.isCompareMode(),
        isSingle: !this.isCompareMode(),
        index,
      }))
      .join('')

    this.contentEl.querySelectorAll('.btn-unpin').forEach(btn => {
      btn.addEventListener('click', e => {
        const no = e.currentTarget.dataset.no
        this.unpin(no)
      })
    })

    this.contentEl.querySelectorAll('.dp-section-toggle').forEach(btn => {
      btn.addEventListener('click', e => {
        const sectionId = e.currentTarget.dataset.section
        this.toggleSection(sectionId)
      })
    })
  }

  generateMetricCard(label, value, tone = 'default') {
    return `
      <div class="dp-metric-card ${tone === 'primary' ? 'is-primary' : ''}">
        <div class="dp-metric-label">${label}</div>
        <div class="dp-metric-value">${value}</div>
      </div>
    `
  }

  generateInfoItem(label, value, isFull = false) {
    return `
      <div class="dp-item${isFull ? ' dp-full' : ''}">
        <div class="dp-label">${label}</div>
        <div class="dp-value">${value}</div>
      </div>
    `
  }

  generateSection(sectionId, title, content) {
    return `
      <section class="dp-section">
        <button class="dp-section-toggle" type="button" data-section="${sectionId}" aria-expanded="true">
          <span>${title}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        <div class="dp-section-body" data-section="${sectionId}">
          ${content}
        </div>
      </section>
    `
  }

  generateColumnHtml(data, { isCompareMode, isSingle, index }) {
    const { detail: m, tx } = data

    if (!m) {
      return `
        <article class="dp-column">
          <div class="error-msg">無法讀取資料，請確認權限或網路連線。</div>
        </article>
      `
    }

    const levelColor = getLevelDotColor(m.level)
    const sectionPrefix = `${m.member_no}-${index}`
    const topbar = isCompareMode
      ? `
          <div class="dp-column-topbar">
            <span class="dp-status-badge">比較中</span>
            <button class="btn-unpin" data-no="${m.member_no}" title="移除比較" aria-label="移除 ${this.escapeHtml(m.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        `
      : '<div class="dp-column-topbar is-single"></div>'

    return `
      <article class="dp-column${isSingle ? ' is-single' : ''}">
        ${topbar}

        <div class="dp-block dp-block-profile">
          <div class="dp-profile">
            <div class="dp-avatar" style="border-color: ${levelColor}">
              ${this.escapeHtml(m.name).charAt(0)}
            </div>
            <div class="dp-name-group">
              <div class="dp-name-row">
                <h3 class="dp-name">${this.escapeHtml(m.name)}</h3>
                <div class="dp-level">
                  <span class="legend-dot" style="background:${levelColor}"></span>
                  ${this.escapeHtml(m.level)}
                </div>
              </div>
              ${m.company_name ? `<div class="dp-company">${this.escapeHtml(m.company_name)}</div>` : ''}
            </div>
          </div>
        </div>

        <div class="dp-block dp-block-metrics">
          <div class="dp-metrics">
            ${this.generateMetricCard('庫存', this.escapeHtml(m.inventory), 'primary')}
            ${this.generateMetricCard('訂單金額', this.formatCurrency(tx.amount))}
            ${this.generateMetricCard('訂單數量', this.escapeHtml(tx.quantity.toLocaleString()))}
          </div>
        </div>

        <div class="dp-block dp-block-details">
          ${this.generateSection(
            `${sectionPrefix}-account`,
            '帳號資訊',
            `
              <div class="dp-grid">
                ${this.generateInfoItem('會員編號', this.escapeHtml(m.member_no))}
                ${this.generateInfoItem('推薦人編號', this.escapeHtml(m.inviter_no))}
                ${this.generateInfoItem('註冊日期', this.formatDate(m.registered_at))}
                ${this.generateInfoItem('國籍', this.escapeHtml(m.nationality))}
              </div>
            `
          )}

          ${this.generateSection(
            `${sectionPrefix}-personal`,
            '個人資料',
            `
              <div class="dp-grid">
                ${this.generateInfoItem('生日', this.formatDate(m.birthday))}
                ${this.generateInfoItem('手機號碼', this.escapeHtml(m.phone), true)}
                ${this.generateInfoItem('電子郵件', this.escapeHtml(m.email), true)}
              </div>
            `
          )}
        </div>
      </article>
    `
  }

  hide() {
    this.isOpen = false
    this.mode = 'view'
    this.currentMemberInfo = null
    this.currentBundle = null
    this.compareMembers = []
    this.contentEl.innerHTML = ''
    this.updateHeaderState()
    this.el.classList.remove('is-compare-mode', 'is-view-mode')
    this.el.style.transform = 'translateX(100%)'
  }
}
