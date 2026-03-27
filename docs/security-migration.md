# Security Migration Guide

## Goal

This project is migrating from:

- frontend table-based login via `allowed_users`
- localStorage-only session checks
- direct frontend reads on raw member / transaction tables

to:

- `Supabase Auth` for sign-in
- `profiles` for role / scope management
- authenticated RPCs for sensitive data
- private local raw-data files outside `src/`

## What Changes for End Users

- Users still sign in with `帳號 + 密碼`
- The frontend now exchanges credentials for a real Supabase Auth session
- The app no longer trusts a handcrafted `localStorage` session

## Login Account Mapping

To preserve the current "login account" UX without forcing visible email addresses in the UI:

- if the login account already contains `@`, the app uses it as the Supabase Auth email
- otherwise the app converts it to `<login_account>@org-chart.local`

Examples:

- `admin` -> `admin@org-chart.local`
- `amy` -> `amy@org-chart.local`
- `amy@example.com` -> `amy@example.com`

## Required Supabase Steps

### 1. Run the SQL hardening script

Execute:

- [supabase/security_hardening.sql](/Users/vkang/Desktop/other/Project/Project_Hierarchical_Organizational_Chart/supabase/security_hardening.sql)

This creates / updates:

- `profiles`
- auth helper functions
- authenticated-only `members_public`
- secured RPCs for:
  - member detail
  - member total transactions
  - members with orders
  - subtree stats

It also removes:

- anon direct read access on `members`
- anon direct read access on `transactions`

### 2. Create Supabase Auth users

For every allowed login account, create an Auth user in Supabase:

1. Open `Authentication -> Users`
2. Create user
3. Set email using the mapping rule above
4. Set password
5. Mark email as confirmed

### 3. Backfill `profiles`

After the Auth users exist, rerun the backfill section in the SQL file or insert rows manually so each Auth user has:

- `login_account`
- `display_name`
- `role`
- `can_view_pii`
- `status = 'active'`

### 4. Validate RPC access

Sign in with a normal internal user and confirm:

- search works
- tree load works
- detail sidebar loads
- stats bar loads
- compare mode still works

## GAS Sync Guidance

Current approved interim model:

- Google Sheets remains the source of truth
- GAS continues writing into Supabase
- the service key stays only in GAS Script Properties

Rules:

- never place service-role keys in frontend code
- never place service-role keys in this repo
- keep anon / authenticated frontend roles read-only
- reserve writes to GAS / admin tooling only

## Raw Data Handling

Raw files should no longer live under `src/`.

Use:

- `private-data/members.json`
- `private-data/transactions.json`

This folder is ignored by git and not shipped with the frontend build.

## Follow-Up Cleanup

Recommended next cleanup after this migration is stable:

- remove old `allowed_users` password-based login flow entirely
- remove or archive any tracked Excel exports containing PII
- rotate credentials if any sensitive keys were ever exposed in public artifacts
