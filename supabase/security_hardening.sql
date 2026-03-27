-- ============================================================
-- Security Hardening Migration
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Profiles / roles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  login_account text UNIQUE NOT NULL,
  display_name text,
  role text NOT NULL DEFAULT 'internal_user'
    CHECK (role IN ('admin', 'internal_user', 'readonly')),
  can_view_pii boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS "profiles_self_select" ON public.profiles;
CREATE POLICY "profiles_self_select"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_set_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_set_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- Helper functions
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.require_active_app_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'App access denied';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_app_can_view_pii()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT p.can_view_pii
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'active'
  ), false);
$$;

REVOKE ALL ON FUNCTION public.require_active_app_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_app_can_view_pii() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_active_app_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_can_view_pii() TO authenticated;

-- ------------------------------------------------------------
-- Tighten table exposure
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "anon_read_members" ON public.members;
DROP POLICY IF EXISTS "anon_read_transactions" ON public.transactions;

REVOKE ALL ON TABLE public.members FROM anon, authenticated;
REVOKE ALL ON TABLE public.transactions FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'allowed_users'
  ) THEN
    EXECUTE 'REVOKE ALL ON TABLE public.allowed_users FROM anon, authenticated';
  END IF;
END $$;

-- ------------------------------------------------------------
-- Public app view: authenticated only, no PII
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.members_public;
CREATE VIEW public.members_public AS
SELECT
  id,
  member_no,
  name,
  company_name,
  node_path,
  level,
  parent_path,
  inventory,
  registered_at
FROM public.members;

REVOKE ALL ON TABLE public.members_public FROM PUBLIC, anon;
GRANT SELECT ON public.members_public TO authenticated;

-- ------------------------------------------------------------
-- Secured member detail RPC
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_member_detail(text);

CREATE OR REPLACE FUNCTION public.get_member_detail(p_member_no text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  can_view_pii boolean;
  payload jsonb;
BEGIN
  PERFORM public.require_active_app_user();
  can_view_pii := public.current_app_can_view_pii();

  SELECT jsonb_build_object(
    'member_no', m.member_no,
    'name', m.name,
    'company_name', m.company_name,
    'representative', m.representative,
    'level', m.level,
    'inventory', m.inventory,
    'inviter_no', m.inviter_no,
    'registered_at', m.registered_at,
    'nationality', CASE WHEN can_view_pii THEN m.nationality ELSE NULL END,
    'phone', CASE WHEN can_view_pii THEN m.phone ELSE NULL END,
    'email', CASE WHEN can_view_pii THEN m.email ELSE NULL END,
    'birthday', CASE WHEN can_view_pii THEN m.birthday ELSE NULL END
  )
  INTO payload
  FROM public.members m
  WHERE m.member_no = p_member_no;

  RETURN payload;
END;
$$;

REVOKE ALL ON FUNCTION public.get_member_detail(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_detail(text) TO authenticated;

-- ------------------------------------------------------------
-- Secured transaction summary RPCs
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_member_total_transactions(text, date, date);
DROP FUNCTION IF EXISTS public.get_members_with_orders(text[], date, date);

CREATE OR REPLACE FUNCTION public.get_member_total_transactions(
  p_member_no text,
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL
)
RETURNS TABLE (
  amount numeric,
  quantity bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_active_app_user();

  RETURN QUERY
  SELECT
    COALESCE(SUM(t.amount), 0) AS amount,
    COALESCE(SUM(t.quantity), 0)::bigint AS quantity
  FROM public.transactions t
  WHERE t.member_no = p_member_no
    AND t.type = 'order'
    AND (start_date IS NULL OR t.transaction_date >= start_date)
    AND (end_date IS NULL OR t.transaction_date <= end_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_members_with_orders(
  p_member_nos text[],
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL
)
RETURNS TABLE (
  member_no text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_active_app_user();

  RETURN QUERY
  SELECT DISTINCT t.member_no
  FROM public.transactions t
  WHERE t.member_no = ANY(p_member_nos)
    AND t.type = 'order'
    AND (start_date IS NULL OR t.transaction_date >= start_date)
    AND (end_date IS NULL OR t.transaction_date <= end_date);
END;
$$;

REVOKE ALL ON FUNCTION public.get_member_total_transactions(text, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_members_with_orders(text[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_total_transactions(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_members_with_orders(text[], date, date) TO authenticated;

-- ------------------------------------------------------------
-- Secure subtree stats RPCs
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_subtree_stats(ltree, date, date);
DROP FUNCTION IF EXISTS public.get_subtree_transaction_stats(ltree, date, date);

CREATE OR REPLACE FUNCTION public.get_subtree_stats(
  target_path ltree,
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL
)
RETURNS TABLE (
  total_members bigint,
  total_orders numeric,
  total_pickup numeric,
  high_performers bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_active_app_user();

  RETURN QUERY
  SELECT
    COUNT(DISTINCT m.member_no)::bigint,
    COALESCE(SUM(CASE WHEN t.type = 'order' THEN t.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.type = 'pickup' THEN t.amount ELSE 0 END), 0),
    COUNT(DISTINCT CASE
      WHEN order_sum.total >= 106 THEN m.member_no
    END)::bigint
  FROM public.members m
  LEFT JOIN public.transactions t ON t.member_no = m.member_no
    AND (start_date IS NULL OR t.transaction_date >= start_date)
    AND (end_date IS NULL OR t.transaction_date <= end_date)
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(t2.amount), 0) AS total
    FROM public.transactions t2
    WHERE t2.member_no = m.member_no
      AND t2.type = 'order'
      AND (start_date IS NULL OR t2.transaction_date >= start_date)
      AND (end_date IS NULL OR t2.transaction_date <= end_date)
  ) order_sum ON true
  WHERE m.node_path <@ target_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_subtree_transaction_stats(
  target_path ltree,
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL
)
RETURNS TABLE (
  total_amount numeric,
  total_quantity bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_active_app_user();

  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN t.type = 'order' THEN t.amount ELSE 0 END), 0) AS total_amount,
    COALESCE(SUM(CASE WHEN t.type = 'order' THEN t.quantity ELSE 0 END), 0)::bigint AS total_quantity
  FROM public.members m
  LEFT JOIN public.transactions t ON t.member_no = m.member_no
    AND (start_date IS NULL OR t.transaction_date >= start_date)
    AND (end_date IS NULL OR t.transaction_date <= end_date)
  WHERE m.node_path <@ target_path;
END;
$$;

REVOKE ALL ON FUNCTION public.get_subtree_stats(ltree, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_subtree_transaction_stats(ltree, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_subtree_stats(ltree, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_subtree_transaction_stats(ltree, date, date) TO authenticated;

-- ------------------------------------------------------------
-- Optional one-time profiles backfill from allowed_users
-- Requires matching auth.users already created.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'allowed_users'
  ) THEN
    INSERT INTO public.profiles (id, login_account, display_name, role, can_view_pii, status)
    SELECT
      u.id,
      au.login_account,
      COALESCE(au.name, au.login_account),
      'internal_user',
      true,
      'active'
    FROM public.allowed_users au
    JOIN auth.users u
      ON lower(u.email) = lower(
        CASE
          WHEN position('@' in au.login_account) > 0 THEN au.login_account
          ELSE au.login_account || '@org-chart.local'
        END
      )
    ON CONFLICT (id) DO UPDATE
      SET login_account = EXCLUDED.login_account,
          display_name = EXCLUDED.display_name,
          updated_at = now();
  END IF;
END $$;

COMMIT;
