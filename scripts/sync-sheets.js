/**
 * Google Sheets → Supabase ETL 同步腳本
 *
 * 使用方式：
 *   1. 設定環境變數 (見 .env.example)
 *   2. 將 Google Service Account JSON 放在專案根目錄
 *   3. node scripts/sync-sheets.js
 *
 * 環境變數：
 *   SUPABASE_URL       - Supabase Project URL
 *   SUPABASE_SERVICE_KEY - Supabase Service Role Key (⚠️ 不是 anon key)
 *   GOOGLE_SHEETS_ID    - Google Sheets 文件 ID
 *   GOOGLE_SHEET_NAME   - 工作表名稱 (預設 "會員資料")
 *   GOOGLE_CREDENTIALS  - Service Account JSON 檔案路徑
 */

import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { readFileSync } from 'fs'

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY // ⚠️ service role key
const SHEETS_ID = process.env.GOOGLE_SHEETS_ID
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || '會員資料'
const CRED_PATH = process.env.GOOGLE_CREDENTIALS || './service-account.json'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SHEETS_ID) {
  console.error('❌ 請設定環境變數: SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_SHEETS_ID')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ============================================================
// Google Sheets 讀取
// ============================================================
async function readSheet() {
  const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'))
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })

  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEETS_ID,
    range: `${SHEET_NAME}!A:S`,
  })

  return res.data.values || []
}

// ============================================================
// Node Path 轉換
// ============================================================
function convertNodePath(rawPath) {
  if (!rawPath) return null
  // /44887/14/12/ → 44887.14.12
  return rawPath
    .replace(/^\/+|\/+$/g, '')  // 移除首尾斜線
    .replace(/\//g, '.')        // 斜線 → 點
}

function getParentPath(ltreePath) {
  if (!ltreePath) return null
  const parts = ltreePath.split('.')
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join('.')
}

// ============================================================
// 資料轉換
// ============================================================
function transformRow(row, headers) {
  // 依照欄位位置讀取 (A=0, B=1, C=2, ...)
  const colB = row[1]?.trim() || ''   // 會員編號
  const colC = row[2]?.trim() || ''   // 姓名 or 公司名稱
  const colE = row[4]?.trim() || ''   // 代表人
  const colF = row[5]?.trim() || ''   // 國籍
  const colH = row[7]?.trim() || ''   // 電子郵件
  const colI = row[8]?.trim() || ''   // 手機
  const colK = row[10]?.trim() || ''  // 庫存
  const colL = row[11]?.trim() || ''  // 註冊日期
  const colM = row[12]?.trim() || ''  // 級別
  const colN = row[13]?.trim() || ''  // 生日
  const colR = row[17]?.trim() || ''  // 邀請人
  const colS = row[18]?.trim() || ''  // Node

  if (!colB || !colS) return null // 無會員編號或 Node 則跳過

  const nodePath = convertNodePath(colS)
  if (!nodePath) return null

  // 名稱邏輯：
  // if 級別 == '經銷商' AND E欄不為空 → C=公司名稱, E=姓名
  // else → C=姓名
  let name, companyName, representative

  if (colM === '經銷商' && colE) {
    companyName = colC
    name = colE
    representative = colE
  } else {
    name = colC
    companyName = null
    representative = colE || null
  }

  return {
    member_no: colB,
    name,
    company_name: companyName,
    representative,
    node_path: nodePath,
    level: colM || null,
    parent_path: getParentPath(nodePath),
    nationality: colF || null,
    phone: colI || null,
    email: colH || null,
    registered_at: parseDate(colL),
    birthday: parseDate(colN),
    inviter_no: colR || null,
    inventory: parseFloat(colK) || 0,
    updated_at: new Date().toISOString(),
  }
}

function parseDate(str) {
  if (!str) return null
  // 嘗試多種日期格式
  const d = new Date(str)
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  return null
}

// ============================================================
// Upsert 到 Supabase
// ============================================================
async function upsertMembers(members) {
  const BATCH_SIZE = 500
  let total = 0

  for (let i = 0; i < members.length; i += BATCH_SIZE) {
    const batch = members.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('members')
      .upsert(batch, { onConflict: 'member_no' })

    if (error) {
      console.error(`❌ Batch ${i / BATCH_SIZE + 1} 失敗:`, error.message)
    } else {
      total += batch.length
      console.log(`✅ 已同步 ${total} / ${members.length}`)
    }
  }

  return total
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('📊 開始同步 Google Sheets → Supabase ...')
  console.log(`   Sheets ID: ${SHEETS_ID}`)
  console.log(`   Sheet: ${SHEET_NAME}`)

  // 1. 讀取 Google Sheets
  console.log('\n📖 讀取 Google Sheets ...')
  const rows = await readSheet()
  console.log(`   共 ${rows.length} 列 (含標題)`)

  if (rows.length < 2) {
    console.error('❌ 資料為空')
    return
  }

  // 2. 轉換資料 (跳過標題列)
  console.log('\n🔄 轉換資料 ...')
  const headers = rows[0]
  const members = []
  let skipped = 0

  for (let i = 1; i < rows.length; i++) {
    const m = transformRow(rows[i], headers)
    if (m) members.push(m)
    else skipped++
  }

  console.log(`   有效: ${members.length}，跳過: ${skipped}`)

  // 3. Upsert
  console.log('\n📤 上傳到 Supabase ...')
  const total = await upsertMembers(members)

  console.log(`\n✅ 同步完成！共 ${total} 筆會員資料`)
}

main().catch(err => {
  console.error('❌ 同步失敗:', err)
  process.exit(1)
})
