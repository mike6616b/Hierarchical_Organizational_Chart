import { sendPasswordResetEmail } from './api/supabase.js'

const form = document.getElementById('forgotPasswordForm')
const emailInput = document.getElementById('resetEmail')
const submitBtn = document.getElementById('btnSendReset')
const errorEl = document.getElementById('forgotError')
const errorTextEl = document.getElementById('forgotErrorText')
const successEl = document.getElementById('forgotSuccess')

form.addEventListener('submit', async (event) => {
  event.preventDefault()

  const email = emailInput.value.trim()
  if (!email) return

  hideMessages()
  setLoading(true)

  try {
    const redirectTo = `${window.location.origin}/reset-password.html`
    const { error } = await sendPasswordResetEmail(email, redirectTo)

    if (error) {
      console.error('Reset password email error:', error)
      showError(mapResetError(error))
      return
    }

    successEl.classList.add('show')
    form.classList.add('is-success')
  } catch (error) {
    console.error('Unexpected reset password error:', error)
    showError('目前無法送出重設信，請稍後再試。')
  } finally {
    setLoading(false)
  }
})

function setLoading(isLoading) {
  submitBtn.classList.toggle('loading', isLoading)
  submitBtn.disabled = isLoading
}

function hideMessages() {
  errorEl.classList.remove('show')
  successEl.classList.remove('show')
  form.classList.remove('is-success')
}

function showError(message) {
  errorTextEl.textContent = message
  errorEl.classList.add('show')
}

function mapResetError(error) {
  const message = String(error?.message || '')
  if (message.includes('rate limit')) {
    return '寄送次數過多，請稍後再試。'
  }
  if (message.includes('Unable to validate email address')) {
    return '請輸入有效的信箱格式。'
  }
  return '無法送出重設信，請確認信箱是否正確。'
}
