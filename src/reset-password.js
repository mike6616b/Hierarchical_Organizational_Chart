import { getSession, onAuthStateChange, signOut, updateCurrentUserPassword } from './api/supabase.js'

const form = document.getElementById('resetPasswordForm')
const newPasswordInput = document.getElementById('newPassword')
const confirmPasswordInput = document.getElementById('confirmPassword')
const submitBtn = document.getElementById('btnUpdatePassword')
const loadingEl = document.getElementById('resetLoading')
const errorEl = document.getElementById('resetError')
const errorTextEl = document.getElementById('resetErrorText')
const successEl = document.getElementById('resetSuccess')
const subtitleEl = document.getElementById('resetSubtitle')

let recoveryReady = false

boot()

async function boot() {
  bindVisibilityToggles()

  const { data: authListener } = onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) {
      activateRecovery()
    }
  })

  window.addEventListener('beforeunload', () => authListener?.subscription?.unsubscribe(), { once: true })

  if (window.location.hash.includes('error=')) {
    loadingEl.style.display = 'none'
    showError('重設連結已失效或已過期，請重新申請。')
    return
  }

  try {
    const session = await getSession()
    if (session?.user) {
      activateRecovery()
      return
    }
  } catch (error) {
    console.error('Reset session bootstrap error:', error)
  }

  setTimeout(async () => {
    if (recoveryReady) return
    try {
      const session = await getSession()
      if (session?.user) {
        activateRecovery()
      } else {
        loadingEl.style.display = 'none'
        showError('找不到有效的重設會話，請重新申請重設密碼。')
      }
    } catch {
      loadingEl.style.display = 'none'
      showError('找不到有效的重設會話，請重新申請重設密碼。')
    }
  }, 1200)
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()

  const password = newPasswordInput.value
  const confirm = confirmPasswordInput.value

  if (password.length < 8) {
    showError('新密碼至少需要 8 個字元。')
    return
  }

  if (password !== confirm) {
    showError('兩次輸入的密碼不一致。')
    return
  }

  clearMessages()
  setLoading(true)

  try {
    const { error } = await updateCurrentUserPassword(password)

    if (error) {
      console.error('Update password error:', error)
      showError(mapUpdateError(error))
      return
    }

    successEl.classList.add('show')
    form.hidden = true
    subtitleEl.textContent = '密碼已更新完成，請使用新密碼重新登入。'
    await signOut()
    setTimeout(() => {
      window.location.replace('./login.html')
    }, 1600)
  } catch (error) {
    console.error('Unexpected update password error:', error)
    showError('更新密碼時發生問題，請稍後再試。')
  } finally {
    setLoading(false)
  }
})

function activateRecovery() {
  recoveryReady = true
  clearMessages()
  loadingEl.style.display = 'none'
  form.hidden = false
  subtitleEl.textContent = '請設定新的登入密碼。'
}

function setLoading(isLoading) {
  submitBtn.classList.toggle('loading', isLoading)
  submitBtn.disabled = isLoading
}

function clearMessages() {
  errorEl.classList.remove('show')
  successEl.classList.remove('show')
}

function showError(message) {
  errorTextEl.textContent = message
  errorEl.classList.add('show')
}

function mapUpdateError(error) {
  const message = String(error?.message || '')
  if (message.includes('same password')) {
    return '新密碼不能與目前密碼相同。'
  }
  if (message.includes('Password should be at least')) {
    return '新密碼強度不足，請至少輸入 6 到 8 個以上字元。'
  }
  return '無法更新密碼，請重新申請重設連結。'
}

function bindVisibilityToggles() {
  document.querySelectorAll('.password-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.target)
      if (!target) return
      const isPassword = target.type === 'password'
      target.type = isPassword ? 'text' : 'password'
      button.classList.toggle('is-active', isPassword)
    })
  })
}
