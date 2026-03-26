/**
 * 登入頁 - Table-based Auth
 * 查詢 allowed_users 表驗證帳號密碼
 * 已登入 → 直接跳主畫面
 */

import { createClient } from '@supabase/supabase-js'

const config = window.__APP_CONFIG__ || {}
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)

// DOM
const form = document.getElementById('loginForm')
const accountInput = document.getElementById('loginAccount')
const passwordInput = document.getElementById('loginPassword')
const btnLogin = document.getElementById('btnLogin')
const errorEl = document.getElementById('loginError')
const errorTextEl = document.getElementById('loginErrorText')

// 如果已登入 (localStorage)，直接跳主畫面
;(() => {
  const session = localStorage.getItem('org_chart_session')
  if (session) {
    try {
      const parsed = JSON.parse(session)
      if (parsed && parsed.login_account) {
        window.location.replace('./index.html')
      }
    } catch {}
  }
})()

// 登入
form.addEventListener('submit', async (e) => {
  e.preventDefault()

  const account = accountInput.value.trim()
  const password = passwordInput.value

  if (!account || !password) return

  // 進入 loading 狀態
  btnLogin.classList.add('loading')
  btnLogin.disabled = true
  errorEl.classList.remove('show')

  try {
    // 查詢 allowed_users 表
    const { data, error } = await supabase
      .from('allowed_users')
      .select('id, name, login_account')
      .eq('login_account', account)
      .eq('password', password)
      .maybeSingle()

    if (error) {
      showError('系統錯誤，請稍後再試')
      console.error('Login query error:', error)
      return
    }

    if (!data) {
      showError('帳號或密碼錯誤')
      return
    }

    // 登入成功 → 存入 localStorage
    localStorage.setItem('org_chart_session', JSON.stringify({
      id: data.id,
      name: data.name,
      login_account: data.login_account,
      logged_in_at: new Date().toISOString(),
    }))

    // 跳轉主畫面
    window.location.replace('./index.html')

  } catch (err) {
    showError('網路錯誤，請稍後再試')
  } finally {
    btnLogin.classList.remove('loading')
    btnLogin.disabled = false
  }
})

function showError(msg) {
  errorTextEl.textContent = msg
  errorEl.classList.add('show')
  // Re-trigger shake animation
  errorEl.style.animation = 'none'
  errorEl.offsetHeight // force reflow
  errorEl.style.animation = ''
}

// Enter key support
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') form.requestSubmit()
})
