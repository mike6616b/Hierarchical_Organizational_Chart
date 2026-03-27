/**
 * Supabase API Client
 * 使用 Vite env + Supabase Auth session
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})

const LOGIN_ACCOUNT_DOMAIN = 'org-chart.local'

export function normalizeLoginAccount(account) {
  const normalized = String(account || '').trim().toLowerCase()
  if (!normalized) return ''
  return normalized.includes('@')
    ? normalized
    : `${normalized}@${LOGIN_ACCOUNT_DOMAIN}`
}

export async function signInWithAccount(account, password) {
  return supabase.auth.signInWithPassword({
    email: normalizeLoginAccount(account),
    password,
  })
}

export async function signOut() {
  return supabase.auth.signOut()
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

export async function getCurrentProfile() {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userData.user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('id, login_account, display_name, role, can_view_pii, status')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (error) throw error
  return data
}

/**
 * 搜尋會員 (模糊搜尋姓名/公司名稱 or 精確搜會員編號)
 */
export async function searchMember(keyword) {
  if (!keyword || keyword.trim().length === 0) return []
  const kw = keyword.trim()

  // 如果是純數字，用會員編號精確搜 + 姓名/公司名稱模糊搜
  // 🛡️ 防護機制：限制至少要輸入 2 個字元才開始搜尋（如果是數字則不限，方便搜編號）
  const isNumeric = /^\d+$/.test(kw)
  if (!isNumeric && kw.length < 2) {
    return []
  }

  let query = supabase
    .from('members_public')
    .select('*')
    .limit(20)
    .order('member_no', { ascending: true })

  if (isNumeric) {
    query = query.or(`member_no.eq.${kw},name.ilike.%${kw}%,company_name.ilike.%${kw}%`)
  } else {
    query = query.or(`name.ilike.%${kw}%,company_name.ilike.%${kw}%`)
  }

  const { data, error } = await query
  if (error) { console.error('Search error:', error); return [] }
  return data || []
}

/**
 * 取得祖先鏈 (從 root 到目標節點)
 */
export async function getAncestors(nodePath) {
  if (!nodePath) return []
  // ltree: ancestor @> descendant → 找所有 path 是 nodePath 的前綴的
  const parts = nodePath.split('.')
  const ancestorPaths = []
  for (let i = 1; i <= parts.length; i++) {
    ancestorPaths.push(parts.slice(0, i).join('.'))
  }

  const { data, error } = await supabase
    .from('members_public')
    .select('*')
    .in('node_path', ancestorPaths)
    .order('node_path', { ascending: true })

  if (error) { console.error('Ancestors error:', error); return [] }
  return data || []
}

/**
 * 取得直接下線 (一層)
 */
export async function getDirectChildren(nodePath) {
  if (!nodePath) return []

  const { data, error } = await supabase
    .from('members_public')
    .select('*')
    .eq('parent_path', nodePath)
    .order('member_no', { ascending: true })

  if (error) { console.error('Children error:', error); return [] }
  return data || []
}

/**
 * 取得子樹統計
 */
export async function getSubtreeStats(nodePath, startDate, endDate) {
  const { data, error } = await supabase
    .rpc('get_subtree_stats', {
      target_path: nodePath,
      start_date: startDate || null,
      end_date: endDate || null,
    })

  if (error) { console.error('Stats error:', error); return [] }
  return data || []
}

/**
 * 取得完整會員詳細資料 (透過 RPC 防護 PII)
 */
export async function getMemberDetail(memberNo) {
  if (!memberNo) return null
  const { data, error } = await supabase
    .rpc('get_member_detail', { p_member_no: memberNo })

  if (error) { console.error('Member detail error:', error); return null }
  return data
}

/**
 * 取得子樹交易統計（整個下線團隊含自己）
 */
export async function getSubtreeTransactionStats(nodePath, startDate, endDate) {
  const { data, error } = await supabase
    .rpc('get_subtree_transaction_stats', {
      target_path: nodePath,
      start_date: startDate || null,
      end_date: endDate || null,
    })

  if (error) { console.error('Transaction stats error:', error); return null }
  return (data && data.length > 0) ? data[0] : null
}

/**
 * 取得個人交易總和
 */
export async function getMemberTotalTransactions(memberNo, startDate, endDate) {
  if (!memberNo) return { amount: 0, quantity: 0 }
  const { data, error } = await supabase
    .rpc('get_member_total_transactions', {
      p_member_no: memberNo,
      start_date: startDate || null,
      end_date: endDate || null,
    })

  if (error) {
    console.error('Member tx error:', error)
    return { amount: 0, quantity: 0 }
  }

  const row = Array.isArray(data) ? data[0] : data

  return {
    amount: Number(row?.amount) || 0,
    quantity: Number(row?.quantity) || 0,
  }
}

/**
 * 批次查詢：確認哪些下線在指定區間內有訂單（用於智慧篩選）
 * 回傳有訂單的 member_no Set
 */
export async function getMembersWithOrders(memberNos, startDate, endDate) {
  if (!memberNos || memberNos.length === 0) return new Set()

  const { data, error } = await supabase
    .rpc('get_members_with_orders', {
      p_member_nos: memberNos,
      start_date: startDate || null,
      end_date: endDate || null,
    })

  if (error) { console.error('Batch orders error:', error); return new Set() }

  return new Set((data || []).map(t => t.member_no))
}

/**
 * 健康檢查
 */
export async function healthCheck() {
  try {
    const { error } = await supabase.from('members_public').select('id').limit(1)
    return !error
  } catch {
    return false
  }
}
