/**
 * Google Apps Script (GAS) - Supabase 自動同步腳本
 * 請將此程式碼貼入任一 Google Sheet 的「擴充功能 > Apps Script」中，
 * 並配置時間觸發條件 (Triggers) 以達成自動化。
 */

// ⚠️ 請在 Google Apps Script 裡直接填入你的 Supabase 金鑰，不要 commit 到 GitHub
const SUPABASE_URL = 'YOUR_SUPABASE_URL';       // e.g. https://xxxxx.supabase.co
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';   // Supabase Dashboard > Settings > API > anon key
const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'resolution=merge-duplicates'
};

// 試算表設定
const MEMBERS_SHEET_ID = '1Oa-3f_KkWhH53JEamXd3Wm9kz5u7FPdjAIsFjKp6CoQ';
const TRANSACTIONS_SHEET_ID = '1Ng9l1FoyncxywJj3zCLunzpfuyJVFxicUies4vklt5U';

/* =========================================
   1. 同步整份會員資料 (全量 Upsert)
   ========================================= */
function syncAllMembers() {
  const ss = SpreadsheetApp.openById(MEMBERS_SHEET_ID);
  const sheet = ss.getSheetByName('ref.會員資料');
  if (!sheet) throw new Error("找不到工作表：ref.會員資料");
  
  // 表頭在第二列 (index 1)，所以資料從第三列 (index 2) 開始
  const data = sheet.getDataRange().getValues();
  
  let validData = [];
  let skipped = 0;

  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    const member_no = row[1]?.toString().trim(); // B欄
    if (!member_no) { skipped++; continue; }

    const S = row[18]?.toString().trim(); // S欄
    if (!S) { skipped++; continue; }

    // 處理階層路徑 /a/b/c 轉 a.b.c (嚴格清洗)
    let node_path = S.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/+/g, '.');
    // 去除前後的 . 以及連續的 ..
    node_path = node_path.replace(/^\.+/, '').replace(/\.+$/, '').replace(/\.{2,}/g, '.');
    // 過濾掉空路徑或含非法字元的路徑
    if (!node_path || !node_path.match(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/)) { skipped++; continue; }
    
    const parts = node_path.split('.');
    const parent_path = parts.length > 1 ? parts.slice(0, -1).join('.') : null;

    const M = row[12]; // M欄 (等級)
    const E = row[4];  // E欄 (代表人)
    const C = row[2];  // C欄 (姓名/公司)
    
    let name = C;
    let company_name = null;
    if (M === '經銷商' && E) {
      company_name = C;
      name = E;
    }

    validData.push({
      member_no: member_no,
      name: name,
      company_name: company_name,
      representative: E,
      node_path: node_path,
      level: M,
      parent_path: parent_path,
      nationality: row[5],
      phone: row[8]?.toString(),
      email: row[7],
      registered_at: parseDate(row[11]),
      birthday: parseDate(row[13]),
      inviter_no: row[14]?.toString(),
      inventory: parseFloat(row[10]) || 0
    });
  }

  Logger.log(`解析出 ${validData.length} 筆有效會員，略過 ${skipped} 筆。準備上傳...`);
  batchUpsert(SUPABASE_URL + '/rest/v1/members?on_conflict=member_no', validData);
  Logger.log("🎉 會員資料同步完成！");
}

/* =========================================
   2. 同步新訂單 (增量 Insert)
   ========================================= */
function syncNewTransactions() {
  // 1. 先抓取目前「所有合法的會員編號」以防外鍵衝突
  const memSs = SpreadsheetApp.openById(MEMBERS_SHEET_ID);
  const memSheet = memSs.getSheetByName('ref.會員資料');
  if (!memSheet) throw new Error("找不到工作表：ref.會員資料");
  const memData = memSheet.getDataRange().getValues();
  const validMembers = new Set();
  for (let i = 2; i < memData.length; i++) {
    const mno = memData[i][1]?.toString().trim(); // 會員編號在 B 欄 (index 1)
    if (mno) validMembers.add(mno);
  }

  // 2. 開始撈取訂單
  const ss = SpreadsheetApp.openById(TRANSACTIONS_SHEET_ID);
  const sheet = ss.getSheetByName('rawdata');
  if (!sheet) throw new Error("找不到工作表：rawdata");

  const data = sheet.getDataRange().getValues();
  const windowDays = 9999;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - windowDays);
  cutoffDate.setHours(0, 0, 0, 0);

  let newRecords = [];
  let invalidCount = 0;
  // 跳過標題列，從 i=1 開始
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    const member_no = row[2]?.toString().trim(); // C欄 (index 2)
    const order_id = row[1]?.toString().trim();  // B欄 (index 1)
    
    if (!member_no || !order_id) continue;
    
    // 🔥 防呆：如果在合法會員清單裡找不到這個人，就直接跳過（防止資料庫外鍵跳錯）
    if (!validMembers.has(member_no)) {
      invalidCount++;
      continue;
    }
    
    const txDateStr = parseDate(row[17]); // R欄 (index 17)
    if (!txDateStr) continue;
    
    const txDate = new Date(txDateStr);
    
    // 只抓取最近 60 天內（目前暫改為 9999 天洗牌）的單
    if (txDate >= cutoffDate) {
      newRecords.push({
        order_id: order_id,
        member_no: member_no,
        type: 'order',
        amount: parseFloat(row[10]) || 0, // K欄 (index 10)
        quantity: parseFloat(row[11]) || 0, // L欄 (index 11)
        transaction_date: txDateStr
      });
    }
  }

  if (newRecords.length > 0) {
    Logger.log(`發現過去 ${windowDays} 天內共有 ${newRecords.length} 筆訂單！準備進行 Upsert...`);
    const url = SUPABASE_URL + '/rest/v1/transactions?on_conflict=order_id';
    // 預設 isUpsert = true，呼叫 batchUpsert 進行覆蓋寫入
    batchUpsert(url, newRecords, true); 
    Logger.log("🎉 訂單資料 Upsert 同步完成！");
  } else {
    Logger.log(`沒有發現過去 ${windowDays} 天內的訂單。`);
  }
}

/* =========================================
   輔助工具
   ========================================= */
function batchUpsert(url, arrayData, isUpsert = true) {
  const BATCH_SIZE = 500;
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < arrayData.length; i += BATCH_SIZE) {
    const batch = arrayData.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(arrayData.length / BATCH_SIZE);
    
    const options = {
      'method': 'post',
      'contentType': 'application/json',
      'headers': HEADERS,
      'payload': JSON.stringify(batch),
      'muteHttpExceptions': true
    };
    
    let retries = 3;
    let success = false;
    while (retries > 0) {
      const resp = UrlFetchApp.fetch(url, options);
      if (resp.getResponseCode() === 201 || resp.getResponseCode() === 200) {
        successCount += batch.length;
        success = true;
        break;
      } else {
        retries--;
        Logger.log(`批次 ${batchNum}/${totalBatches} 錯誤 (${resp.getResponseCode()})：${resp.getContentText().substring(0, 200)}，剩餘重試：${retries}`);
        Utilities.sleep(1000);
      }
    }
    if (!success) {
      failCount += batch.length;
      Logger.log(`⚠️ 批次 ${batchNum} 放棄，跳過 ${batch.length} 筆繼續...`);
    }
    
    // 進度報告
    if (batchNum % 20 === 0 || batchNum === totalBatches) {
      Logger.log(`進度：${batchNum}/${totalBatches} 批次完成，成功 ${successCount} 筆，失敗 ${failCount} 筆`);
    }
  }
  Logger.log(`上傳完畢：成功 ${successCount} 筆，失敗 ${failCount} 筆`);
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    return Utilities.formatDate(val, tz, "yyyy-MM-dd");
  }
  const s = val.toString().trim();
  // 處理中文日期格式：1978年12月15日
  const cnMatch = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (cnMatch) {
    const y = cnMatch[1];
    const m = cnMatch[2].padStart(2, '0');
    const d = cnMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // 處理 "2026/01/15" 或 "2026-01-15 09:00:00"
  const cleaned = s.replace(/\//g, '-').split(' ')[0];
  if (cleaned.match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
    return cleaned;
  }
  return null; // 無法解析就跳過，避免炸掉整批
}
