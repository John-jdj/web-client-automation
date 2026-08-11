-- supabase/seed.sql
-- Safe, fictional demo data for local development and manual QA.
-- Run automatically by `supabase db reset`, or manually via the SQL editor
-- / psql. Uses fixed UUIDs so it can be re-run idempotently (ON CONFLICT).
--
-- No real people's personal information is used anywhere in this file.

-- ---------------------------------------------------------------------
-- Businesses
-- ---------------------------------------------------------------------

insert into public.businesses (
  id, google_place_id, business_name, normalized_business_name, category,
  subcategory, phone, email, website_url, has_website, website_checked_at,
  website_check_status, address, city, state, country, postal_code,
  rating, review_count, google_maps_url, source
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'demo_place_abc_bakery',
    'ABC Bakery', 'abc bakery', 'Bakery', 'Cake Shop',
    '+91 98765 43210', null, 'https://abcbakery-demo.example.com', true, now(),
    'CHECKED', '12 Market Street', 'Dindigul', 'Tamil Nadu', 'India', '624001',
    4.3, 87, 'https://maps.google.com/?q=ABC+Bakery+Dindigul', 'google_places'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'demo_place_dindigul_fitness',
    'Dindigul Fitness Studio', 'dindigul fitness studio', 'Fitness', 'Gym',
    '+91 98765 11122', null, null, false, now(),
    'CHECKED', '45 Anna Nagar', 'Dindigul', 'Tamil Nadu', 'India', '624002',
    4.6, 32, 'https://maps.google.com/?q=Dindigul+Fitness+Studio', 'google_places'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'demo_place_green_leaf',
    'Green Leaf Restaurant', 'green leaf restaurant', 'Restaurant', 'Vegetarian',
    '+91 98765 33344', 'contact@greenleaf-demo.example.com', 'https://greenleaf-demo.example.com', true, now(),
    'CHECKED', '9 Temple Road', 'Madurai', 'Tamil Nadu', 'India', '625001',
    3.9, 210, 'https://maps.google.com/?q=Green+Leaf+Restaurant+Madurai', 'google_places'
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    'demo_place_royal_salon',
    'Royal Salon', 'royal salon', 'Beauty & Salon', 'Unisex Salon',
    '+91 98765 55566', null, null, false, now(),
    'CHECKED', '78 Main Bazaar', 'Dindigul', 'Tamil Nadu', 'India', '624001',
    4.1, 54, 'https://maps.google.com/?q=Royal+Salon+Dindigul', 'google_places'
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    'demo_place_city_care_clinic',
    'City Care Clinic', 'city care clinic', 'Healthcare', 'General Clinic',
    '+91 98765 77788', 'info@citycareclinic-demo.example.com', 'https://citycareclinic-demo.example.com', true, now(),
    'CHECKED', '3 Hospital Road', 'Madurai', 'Tamil Nadu', 'India', '625002',
    4.7, 156, 'https://maps.google.com/?q=City+Care+Clinic+Madurai', 'google_places'
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------

insert into public.leads (
  id, business_id, status, priority, lead_score, qualification_status,
  source, notes, first_contacted_at, last_contacted_at, converted_at
) values
  (
    'a1111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'QUALIFIED', 'MEDIUM', 55, 'QUALIFIED',
    'google_places', 'Has a dated website; good candidate for a redesign demo.',
    null, null, null
  ),
  (
    'a2222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222',
    'NEW', 'HIGH', 25, 'PENDING',
    'google_places', 'No website found — strong outreach candidate.',
    null, null, null
  ),
  (
    'a3333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333333',
    'CONTACTED', 'MEDIUM', 48, 'QUALIFIED',
    'google_places', 'Outreach sent, awaiting reply.',
    now() - interval '4 days', now() - interval '4 days', null
  ),
  (
    'a4444444-4444-4444-8444-444444444444',
    '44444444-4444-4444-8444-444444444444',
    'DEMO_CREATED', 'HOT', 82, 'QUALIFIED',
    'google_places', 'No website, high rating — demo generated, ready for outreach.',
    null, null, null
  ),
  (
    'a5555555-5555-4555-8555-555555555555',
    '55555555-5555-4555-8555-555555555555',
    'CONVERTED', 'HIGH', 91, 'QUALIFIED',
    'google_places', 'Signed on after demo review.',
    now() - interval '30 days', now() - interval '20 days', now() - interval '18 days'
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Lead scores
-- ---------------------------------------------------------------------

insert into public.lead_scores (
  lead_id, score, website_score, rating_score, review_score, phone_score,
  email_score, category_score, activity_score, reasoning, scoring_version
) values
  (
    'a1111111-1111-4111-8111-111111111111', 55, 10, 15, 10, 10, 0, 10, 0,
    'Existing website is outdated (no mobile layout); solid ratings and review volume.',
    'v1'
  ),
  (
    'a2222222-2222-4222-8222-222222222222', 25, 0, 20, 5, 0, 0, 0, 0,
    'No website at all; decent rating but very low review count and no contact email.',
    'v1'
  ),
  (
    'a3333333-3333-4333-8333-333333333333', 48, 10, 10, 18, 10, 0, 0, 0,
    'Has a website and strong review volume, but average rating.',
    'v1'
  ),
  (
    'a4444444-4444-4444-8444-444444444444', 82, 25, 20, 12, 10, 0, 15, 0,
    'No website, high rating, healthy review count — ideal demo target.',
    'v1'
  ),
  (
    'a5555555-5555-4555-8555-555555555555', 91, 25, 25, 15, 10, 10, 6, 0,
    'Existing site, top rating, full contact details — already converted to a paying client.',
    'v1'
  )
on conflict do nothing;
