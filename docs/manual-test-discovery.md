# Manual test: business discovery (Step 4)

Prerequisites:

- `next dev` running, with `.env.local` containing valid Supabase credentials.
- Signed in as a user whose `profiles.role = 'admin'` (RLS requires this to write `businesses`/`leads`).
- No `GOOGLE_MAPS_API_KEY` set and `DEMO_MODE` not `false` → discovery runs in mock mode (safe, no real API calls, no billing).

## Steps

1. Go to `/leads/discover`.
2. Enter:
   - Location: `Dindigul`
   - Category: `Restaurant`
   - Result Limit: `10`
3. Click **🔎 Find Businesses**.

## Expected results

- Button shows "Finding businesses..." while the request is in flight.
- Summary cards show: Businesses Found, No Website, Has Website, New Leads, Duplicates.
- Businesses are retrieved and saved to the `businesses` table (`source = 'google_places_demo'` in mock mode).
- Businesses with an official website are marked `has_website = true` and show **Website Found** in the table.
- Businesses without one are marked `has_website = false`, show **No Website**, and the row is visually highlighted.
- Only the no-website businesses receive a new `leads` row (`status = NEW`, `priority = MEDIUM`, `qualification_status = PENDING`, `lead_score = 0`, `source = 'google_places'`).
- The default filter is **No Website**; switching filters (All / No Website / Has Website / New Lead / Duplicate) changes the visible rows accordingly.
- Re-running the same search does not create duplicate `businesses` rows (matched by `google_place_id`) and does not create a second lead for a business that already has an active one — `duplicates` in the summary increases instead.
- An `automation_runs` row is created for the execution (`businesses_found`, `duplicates_removed`, `no_website_found`, `qualified_leads`, `error_count`), and an `api_usage` row is logged (`provider = 'google_places'`, `operation = 'text_search'`).

## Testing with a real Google Places key

Set `GOOGLE_MAPS_API_KEY` in `.env.local` (mock mode is then bypassed regardless of `DEMO_MODE`) and repeat the same steps — results should reflect real businesses near "Dindigul" and `source` will be `'google_places'`.
