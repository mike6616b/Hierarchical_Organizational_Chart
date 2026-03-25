-- ============================================================
-- 組織架構圖 - Supabase Schema
-- ============================================================

-- 擴充：ltree (樹狀查詢) + pg_trgm (模糊搜尋)
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 會員主表
-- ============================================================
CREATE TABLE members (
  id              BIGSERIAL PRIMARY KEY,
  member_no       TEXT UNIQUE NOT NULL,          -- 會員編號 (B欄)
  name            TEXT NOT NULL,                 -- 顯示名稱 (邏輯見下方)
  company_name    TEXT,                          -- 公司名稱 (僅經銷商且E欄有值時)
  representative  TEXT,                          -- 代表人 (E欄)
  node_path       LTREE NOT NULL,                -- /a/b/c/ → a.b.c
  level           TEXT,                          -- M欄: 經銷商/高級/中級/初級/一般
  parent_path     LTREE,                         -- 上線 node_path
  nationality     TEXT,                          -- 國籍 (F欄)
  phone           TEXT,                          -- 手機 (I欄)
  email           TEXT,                          -- 電子郵件 (H欄)
  registered_at   DATE,                          -- 註冊日期 (L欄)
  birthday        DATE,                          -- 生日 (N欄)
  inviter_no      TEXT,                          -- 邀請人 (R欄)
  inventory       NUMERIC DEFAULT 0,             -- 庫存 (K欄)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 名稱邏輯 (ETL 執行):
-- if M == '經銷商' AND E != '':
--   company_name = C, name = E
-- else:
--   name = C, company_name = NULL

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX idx_members_node_path   ON members USING GIST (node_path);
CREATE INDEX idx_members_name_trgm   ON members USING GIN  (name gin_trgm_ops);
CREATE INDEX idx_members_company_trgm ON members USING GIN (company_name gin_trgm_ops);
CREATE INDEX idx_members_member_no   ON members (member_no);
CREATE INDEX idx_members_level       ON members (level);
CREATE INDEX idx_members_parent_path ON members USING GIST (parent_path);

-- ============================================================
-- 訂貨/提貨紀錄
-- ============================================================
CREATE TABLE transactions (
  id                BIGSERIAL PRIMARY KEY,
  member_no         TEXT NOT NULL REFERENCES members(member_no),
  type              TEXT NOT NULL CHECK (type IN ('order', 'pickup')),
  amount            NUMERIC NOT NULL DEFAULT 0,
  quantity          INTEGER DEFAULT 0,
  transaction_date  DATE NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tx_member    ON transactions (member_no);
CREATE INDEX idx_tx_date      ON transactions (transaction_date);
CREATE INDEX idx_tx_type_date ON transactions (type, transaction_date);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- 允許 anon 讀取（但前端只透過安全 view）
CREATE POLICY "anon_read_members" ON members
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_transactions" ON transactions
  FOR SELECT TO anon USING (true);

-- ============================================================
-- 前端安全 View（不暴露個資）
-- ============================================================
CREATE VIEW members_public AS
  SELECT id, member_no, name, company_name, node_path, level,
         parent_path, inventory, registered_at
  FROM members;

-- ============================================================
-- 聚合函式：子樹統計
-- ============================================================
CREATE OR REPLACE FUNCTION get_subtree_stats(
  target_path LTREE,
  start_date  DATE DEFAULT NULL,
  end_date    DATE DEFAULT NULL
) RETURNS TABLE (
  total_members   BIGINT,
  total_orders    NUMERIC,
  total_pickup    NUMERIC,
  high_performers BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT m.member_no)::BIGINT,
    COALESCE(SUM(CASE WHEN t.type = 'order' THEN t.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.type = 'pickup' THEN t.amount ELSE 0 END), 0),
    COUNT(DISTINCT CASE
      WHEN order_sum.total >= 106 THEN m.member_no
    END)::BIGINT
  FROM members m
  LEFT JOIN transactions t ON t.member_no = m.member_no
    AND (start_date IS NULL OR t.transaction_date >= start_date)
    AND (end_date   IS NULL OR t.transaction_date <= end_date)
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(t2.amount), 0) AS total
    FROM transactions t2
    WHERE t2.member_no = m.member_no
      AND t2.type = 'order'
      AND (start_date IS NULL OR t2.transaction_date >= start_date)
      AND (end_date   IS NULL OR t2.transaction_date <= end_date)
  ) order_sum ON true
  WHERE m.node_path <@ target_path;
END;
$$ LANGUAGE plpgsql STABLE;
