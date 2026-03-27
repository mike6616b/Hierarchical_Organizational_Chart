import { getMemberDetail, getMemberTotalTransactions } from '../api/supabase.js'
import { getLevelDotColor } from '../utils/colors.js'

const MAX_COMPARE_MEMBERS = 3

export class DetailPanel {
  constructor(el, closeBtn, contentEl, loadingEl, compareBtn, compareMetaEl) {
    this.el = el
    this.closeBtn = closeBtn
    this.contentEl = contentEl
    this.loadingEl = loadingEl
    this.compareBtn = compareBtn
    this.compareMetaEl = compareMetaEl
    this.isOpen = false
    this.currentMemberInfo = null
    this.lastDateRange = { startDate: '', endDate: '' }

    this.pinnedMembers = []
    this.previewMember = null

    this.closeBtn.addEventListener('click', () => this.hide())
    this.compareBtn?.addEventListener('click', () => this.pinPreview())
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

  getCompareCount() {
    return this.pinnedMembers.length
  }

  getCanPinPreview() {
    return Boolean(this.previewMember) && this.pinnedMembers.length < MAX_COMPARE_MEMBERS - 1
  }

  updateHeaderState() {
    if (!this.compareMetaEl || !this.compareBtn) return

    const compareCount = this.getCompareCount()
    const canPinPreview = this.getCanPinPreview()
    const remaining = Math.max(MAX_COMPARE_MEMBERS - compareCount, 0)

    if (this.previewMember) {
      if (canPinPreview) {
        this.compareMetaEl.textContent = `已比較 ${compareCount} / ${MAX_COMPARE_MEMBERS}，還可加入 ${remaining - 1} 位`
      } else {
        this.compareMetaEl.textContent = `已比較 ${compareCount} / ${MAX_COMPARE_MEMBERS}`
      }
    } else if (compareCount > 0) {
      this.compareMetaEl.textContent = `已比較 ${compareCount} / ${MAX_COMPARE_MEMBERS}`
    } else {
      this.compareMetaEl.textContent = '尚未加入比較'
    }

    this.compareBtn.disabled = !canPinPreview
  }

  async loadMemberBundle(memberInfo, startDate, endDate) {
    const [detail, tx] = await Promise.all([
      getMemberDetail(memberInfo.member_no),
      getMemberTotalTransactions(memberInfo.member_no, startDate, endDate)
    ])

    return { info: memberInfo, detail, tx }
  }

  async show(memberInfo, startDate, endDate) {
    this.isOpen = true
    this.currentMemberInfo = memberInfo
    this.lastDateRange = { startDate, endDate }
    this.el.style.transform = 'translateX(0)'

    const isAlreadyPinned = this.pinnedMembers.some(m => m.info.member_no === memberInfo.member_no)

    if (isAlreadyPinned) {
      this.previewMember = null
      this.updateHeaderState()
      this.render()
      return
    }

    if (this.pinnedMembers.length >= MAX_COMPARE_MEMBERS) {
      alert('最多只能同時比較 3 位會員喔！請先點擊「×」移除一位。')
      return
    }

    if (this.pinnedMembers.length === 0) {
      this.contentEl.style.display = 'none'
      this.loadingEl.style.display = 'flex'
    }

    const memberBundle = await this.loadMemberBundle(memberInfo, startDate, endDate)

    this.loadingEl.style.display = 'none'
    this.contentEl.style.display = 'flex'
    this.previewMember = memberBundle
    this.updateHeaderState()
    this.render()
  }

  async refresh(startDate, endDate) {
    if (!this.isOpen) return

    this.lastDateRange = { startDate, endDate }
    this.loadingEl.style.display = 'flex'
    this.contentEl.style.display = 'none'

    const refreshedPinned = await Promise.all(
      this.pinnedMembers.map(member => this.loadMemberBundle(member.info, startDate, endDate))
    )

    const refreshedPreview = this.previewMember
      ? await this.loadMemberBundle(this.previewMember.info, startDate, endDate)
      : null

    this.pinnedMembers = refreshedPinned
    this.previewMember = refreshedPreview
    this.loadingEl.style.display = 'none'
    this.contentEl.style.display = 'flex'
    this.updateHeaderState()
    this.render()
  }

  pinPreview() {
    if (!this.previewMember) return
    if (this.pinnedMembers.length >= MAX_COMPARE_MEMBERS - 1) {
      alert('最多只能同時比較 3 位會員喔！')
      return
    }

    this.pinnedMembers.push(this.previewMember)
    this.previewMember = null
    this.updateHeaderState()
    this.render()
  }

  unpin(memberNo) {
    this.pinnedMembers = this.pinnedMembers.filter(m => m.info.member_no !== memberNo)

    if (this.pinnedMembers.length === 0 && !this.previewMember) {
      this.hide()
      return
    }

    this.updateHeaderState()
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

  render() {
    this.contentEl.innerHTML = ''
    this.updateHeaderState()

    this.contentEl.classList.remove('blur-fade-in')
    void this.contentEl.offsetWidth
    this.contentEl.classList.add('blur-fade-in')

    const compareItems = [...this.pinnedMembers]
    if (this.previewMember) compareItems.push(this.previewMember)

    this.el.style.setProperty('--dp-columns', String(Math.max(compareItems.length, 1)))
    this.contentEl.innerHTML = compareItems
      .map((member, index) => this.generateColumnHtml(member, this.previewMember?.info.member_no === member.info.member_no, index))
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

  generateSection(sectionId, title, content, collapsed = false) {
    return `
      <section class="dp-section ${collapsed ? 'is-collapsed' : ''}">
        <button class="dp-section-toggle" type="button" data-section="${sectionId}" aria-expanded="${collapsed ? 'false' : 'true'}">
          <span>${title}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        <div class="dp-section-body" data-section="${sectionId}"${collapsed ? ' hidden' : ''}>
          ${content}
        </div>
      </section>
    `
  }

  generateColumnHtml(data, isPreview, index) {
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
    const statusBadge = isPreview
      ? `<span class="dp-status-badge is-preview">預覽中</span>`
      : `<span class="dp-status-badge">比較中</span>`
    const removeButton = !isPreview
      ? `
          <button class="btn-unpin" data-no="${m.member_no}" title="移除比較" aria-label="移除 ${this.escapeHtml(m.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        `
      : ''

    return `
      <article class="dp-column${isPreview ? ' is-preview' : ''}">
        <div class="dp-column-topbar">
          ${statusBadge}
          ${removeButton}
        </div>

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

        <div class="dp-metrics">
          ${this.generateMetricCard('目前庫存', this.escapeHtml(m.inventory), 'primary')}
          ${this.generateMetricCard('總訂單金額', `$${this.escapeHtml(tx.amount.toLocaleString())}`)}
          ${this.generateMetricCard('總訂單數量', this.escapeHtml(tx.quantity.toLocaleString()))}
        </div>

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
          `,
          true
        )}
      </article>
    `
  }

  hide() {
    this.isOpen = false
    this.currentMemberInfo = null
    this.previewMember = null
    this.pinnedMembers = []
    this.contentEl.innerHTML = ''
    this.updateHeaderState()
    this.el.style.transform = 'translateX(100%)'
  }
}
