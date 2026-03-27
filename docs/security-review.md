# Security Review Snapshot

## Implemented

- Frontend login now uses `Supabase Auth`
- Frontend no longer validates passwords through `allowed_users`
- Frontend no longer trusts handcrafted `localStorage` login state
- `profiles` is the app-level access control table
- Sensitive member detail and transaction summaries are served through authenticated RPCs
- Raw JSON exports no longer live under `src/`
- Public upload pages have been removed from the frontend
- GitHub Pages deploys only `dist/`
- Password recovery flow is available in the app

## Remaining Operational Checks

### 1. Confirm profile auto-provisioning

`supabase/security_hardening.sql` now creates:

- `public.handle_new_auth_user()`
- `on_auth_user_created`

Expected result:

- every new `auth.users` record should automatically create a matching `public.profiles` row

Recommended check:

```sql
select u.email, p.login_account, p.role, p.status
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc;
```

### 2. Retire legacy password storage

If `public.allowed_users.password` still exists, it is now a legacy liability.

Recommended path:

1. finish migrating active users into Supabase Auth
2. confirm frontend login no longer depends on `allowed_users`
3. drop the password column or null existing values

Suggested final cleanup:

```sql
alter table public.allowed_users drop column if exists password;
```

If you still need `allowed_users` as a legacy mapping table, keep only non-secret metadata.

### 3. Verify anonymous access is blocked

Spot-check with the REST API or Supabase table editor that:

- `anon` cannot directly read `members`
- `anon` cannot directly read `transactions`
- sensitive RPCs require an authenticated session

### 4. Protect GAS secrets

Current acceptable interim design:

- Google Apps Script writes to Supabase
- service credentials live only in GAS Script Properties

Keep enforcing:

- no service-role keys in frontend code
- no service-role keys in git
- no public upload tooling in the web app

## Residual Risk Notes

- The publishable key is still present in the frontend bundle, which is normal for Supabase. Security depends on RLS and RPC restrictions, not on hiding the publishable key.
- If any historic public deployment or git history ever exposed raw exports or old insecure pages, consider rotating credentials and cleaning history if needed.
- If the app will support many operators, consider narrowing `can_view_pii` by role instead of defaulting to `true`.
