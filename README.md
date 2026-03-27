# Hierarchical_Organizational_Chart

## Security Notes

- Frontend sign-in now uses `Supabase Auth`, not table-based password lookup.
- App users can still type a short account such as `admin`; the frontend maps it to `admin@org-chart.local` unless the input already contains `@`.
- Sensitive raw JSON exports should live under `private-data/`, not `src/`.
- GitHub Pages is configured to deploy only `dist/`, not the whole repository.

## Required Environment Variables

Create a local `.env` with:

```bash
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_publishable_key
```

For GitHub Pages builds, set the same values as repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Security Migration

Detailed migration and profile setup steps are in:

- [docs/security-migration.md](/Users/vkang/Desktop/other/Project/Project_Hierarchical_Organizational_Chart/docs/security-migration.md)
