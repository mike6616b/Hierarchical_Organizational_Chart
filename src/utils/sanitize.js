/**
 * 輸入驗證 & Sanitization
 */

/**
 * 清理搜尋輸入 - 移除危險字元
 */
export function sanitizeSearchInput(input) {
  if (typeof input !== 'string') return ''
  return input
    .trim()
    .replace(/[<>'"`;\\]/g, '') // 移除 HTML/SQL 危險字元
    .slice(0, 100)               // 限制長度
}

/**
 * 驗證日期格式 YYYY-MM-DD
 */
export function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false
  const d = new Date(str)
  return !isNaN(d.getTime())
}

/**
 * 驗證日期範圍
 */
export function validateDateRange(start, end) {
  if (!isValidDate(start) || !isValidDate(end)) return false
  return new Date(start) <= new Date(end)
}
