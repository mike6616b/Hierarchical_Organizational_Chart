# SECURITY_CHECKLIST

## Purpose

Use this checklist before major releases, after authentication changes, after Supabase policy changes, and after any data import pipeline changes.

## 1. Authentication

- [ ] Frontend login uses `Supabase Auth`, not direct table password lookup.
- [ ] `src/login.js` does not query `allowed_users` for password validation.
- [ ] App entry checks a real Supabase session before showing protected UI.
- [ ] Password recovery pages are reachable and functional:
  - [ ] `/forgot-password.html`
  - [ ] `/reset-password.html`
- [ ] Supabase Auth `Site URL` points to production, not localhost.
- [ ] Supabase Auth `Redirect URLs` include:
  - [ ] production root URL
  - [ ] `/login.html`
  - [ ] `/index.html`
  - [ ] `/reset-password.html`

## 2. Profiles and Roles

- [ ] Every `auth.users` record has a matching `public.profiles` row.
- [ ] `public.handle_new_auth_user()` exists.
- [ ] Trigger `on_auth_user_created` exists on `auth.users`.
- [ ] Admin accounts are explicitly marked `role = 'admin'`.
- [ ] Disabled users are marked through `profiles.status`, not by ad-hoc frontend logic.

Recommended verification SQL:

```sql
select u.email, p.login_account, p.role, p.status
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc;
```

## 3. Legacy Auth Cleanup

- [ ] `public.allowed_users.password` no longer exists.
- [ ] `allowed_users` is no longer part of frontend login flow.
- [ ] If `allowed_users` is still kept, it contains metadata only and no secrets.

Recommended verification SQL:

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'allowed_users'
  and column_name = 'password';
```

Expected result:

- zero rows

## 4. Anonymous Data Access

- [ ] Anonymous callers cannot read `members`.
- [ ] Anonymous callers cannot read `transactions`.
- [ ] Anonymous callers cannot read `members_public`.
- [ ] Anonymous callers cannot call sensitive RPCs such as:
  - [ ] `get_member_detail`
  - [ ] `get_member_total_transactions`
  - [ ] `get_members_with_orders`
  - [ ] `get_subtree_stats`
  - [ ] `get_subtree_transaction_stats`

Recommended verification method:

- call the REST / RPC endpoints with the publishable key but without a logged-in user session
- expected result is denial, e.g. `42501 permission denied`

## 5. Public Deployment Surface

- [ ] Login page is public.
- [ ] Password recovery pages are public.
- [ ] Protected application data still requires a valid session after page load.
- [ ] Old upload tooling is not deployed:
  - [ ] `/upload.html` returns `404`
  - [ ] `/upload-transactions.html` returns `404`
- [ ] GitHub Pages workflow, if used, deploys only `dist/`.
- [ ] No build artifact includes raw Excel or raw JSON exports.

## 6. Secrets and Environment Variables

- [ ] Service-role keys are not present in frontend code.
- [ ] Service-role keys are not present in git history for current operational files.
- [ ] `.env` is ignored by git.
- [ ] Production deployment uses only:
  - [ ] `VITE_SUPABASE_URL`
  - [ ] `VITE_SUPABASE_ANON_KEY`
- [ ] GAS secrets are stored only in Script Properties.

## 7. Raw Data Handling

- [ ] No sensitive raw exports live under `src/`.
- [ ] Raw exports are stored only under `private-data/` or outside the repo.
- [ ] Raw Excel files are not tracked by git.
- [ ] Public build output does not include `members.json` or `transactions.json`.

## 8. Operational Role Review

- [ ] Review whether `can_view_pii` should remain `true` for all users.
- [ ] Confirm only intended staff accounts have `role = 'admin'`.
- [ ] Disable accounts by `profiles.status = 'disabled'` when access should be revoked.

## 9. Anonymous Verification Snapshot

Verified on March 27, 2026 against production:

- [x] `https://hierarchical-organizational-chart.vercel.app/` returned `200`
- [x] `https://hierarchical-organizational-chart.vercel.app/forgot-password.html` returned `200`
- [x] `https://hierarchical-organizational-chart.vercel.app/reset-password.html` returned `200`
- [x] `https://hierarchical-organizational-chart.vercel.app/upload.html` returned `404`
- [x] Anonymous REST access to `members` returned permission denied
- [x] Anonymous REST access to `transactions` returned permission denied
- [x] Anonymous REST access to `members_public` returned permission denied
- [x] Anonymous RPC access to `get_member_detail` returned permission denied

## 10. Release Gate

Before shipping a release:

- [ ] Run `npm run build`
- [ ] Spot-test login
- [ ] Spot-test forgot password
- [ ] Spot-test one normal user account
- [ ] Spot-test one admin account
- [ ] Re-run the anonymous access checks if Auth or RLS changed
