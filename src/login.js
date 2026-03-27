/**
 * 登入頁 - Supabase Auth
 * 使用登入帳號 + 密碼換取真正的 session
 */

import { getSession, signInWithAccount } from './api/supabase.js'

const form = document.getElementById('loginForm')
const accountInput = document.getElementById('loginAccount')
const passwordInput = document.getElementById('loginPassword')
const btnLogin = document.getElementById('btnLogin')
const errorEl = document.getElementById('loginError')
const errorTextEl = document.getElementById('loginErrorText')

;(async () => {
  try {
    const session = await getSession()
    if (session?.user) {
      window.location.replace('./index.html')
    }
  } catch (error) {
    console.error('Session bootstrap error:', error)
  }
})()

form.addEventListener('submit', async (e) => {
  e.preventDefault()

  const account = accountInput.value.trim()
  const password = passwordInput.value

  if (!account || !password) return

  btnLogin.classList.add('loading')
  btnLogin.disabled = true
  errorEl.classList.remove('show')

  try {
    const { data, error } = await signInWithAccount(account, password)

    if (error) {
      showError(mapAuthError(error))
      console.error('Login error:', error)
      return
    }

    if (!data?.session) {
      showError('登入失敗，請稍後再試')
      return
    }

    window.location.replace('./index.html')
  } catch (err) {
    console.error('Login unexpected error:', err)
    showError('網路錯誤，請稍後再試')
  } finally {
    btnLogin.classList.remove('loading')
    btnLogin.disabled = false
  }
})

function mapAuthError(error) {
  const message = String(error?.message || '')
  if (message.includes('Invalid login credentials')) {
    return '帳號或密碼錯誤'
  }
  if (message.includes('Email not confirmed')) {
    return '帳號尚未啟用，請聯繫管理員'
  }
  if (message.includes('rate limit')) {
    return '嘗試次數過多，請稍後再試'
  }
  return '登入失敗，請稍後再試'
}

function showError(msg) {
  errorTextEl.textContent = msg
  errorEl.classList.add('show')
  errorEl.style.animation = 'none'
  errorEl.offsetHeight
  errorEl.style.animation = ''
}

passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') form.requestSubmit()
})
