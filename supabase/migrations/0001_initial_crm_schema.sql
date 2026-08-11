-- 0001_initial_crm_schema.sql
-- AI Web Development Client Acquisition & Demo Automation SaaS
-- Initial CRM database foundation: profiles, businesses, leads, demos,
-- outreach, automation orchestration, and observability tables.
--
-- This migration is idempotent-ish (uses IF NOT EXISTS where practical) but
-- is intended to run once against a fresh Supabase project via:
--   supabase db push
-- or the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- =========================================================================
-- Shared helpers
-- =========================================================================

-- Generic updated_at trigger, applied to every table that has the column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- 1. PROFILES
-- =========================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('admin', 'user'))
);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Admin-role helper used throughout RLS policies below.
-- security definer so it can read `profiles` even though `profiles` itself
-- has RLS enabled (avoids policy recursion).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- 2. BUSINESSES
-- =========================================================================

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  google_place_id text unique,
  business_name text not null,
  normalized_business_name text,
  category text,
  subcategory text,
  phone text,
  email text,
  website_url text,
  has_website boolean not null default false,
  website_checked_at timestamptz,
  website_check_status text not null default 'UNKNOWN',
  address text,
  city text,
  state text,
  country text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  rating numeric,
  review_count integer,
  google_maps_url text,
  opening_hours jsonb,
  social_links jsonb,
  source text not null default 'google_places',
  raw_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_website_check_status_check
    check (website_check_status in ('UNKNOWN', 'CHECKED', 'ERROR'))
);

create trigger set_businesses_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 3. LEADS
-- =========================================================================

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  status text not null default 'NEW',
  priority text not null default 'MEDIUM',
  lead_score integer not null default 0,
  qualification_status text not null default 'PENDING',
  source text,
  notes text,
  assigned_to uuid references public.profiles(id) on delete set null,
  first_contacted_at timestamptz,
  last_contacted_at timestamptz,
  last_replied_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_status_check check (status in (
    'NEW', 'ANALYZING', 'QUALIFIED', 'DISQUALIFIED', 'DEMO_PENDING',
    'DEMO_CREATED', 'OUTREACH_READY', 'QUEUED', 'CONTACTED', 'REPLIED',
    'INTERESTED', 'NOT_INTERESTED', 'CONVERTED', 'LOST', 'DO_NOT_CONTACT'
  )),
  constraint leads_priority_check check (priority in ('LOW', 'MEDIUM', 'HIGH', 'HOT')),
  constraint leads_qualification_status_check check (qualification_status in (
    'PENDING', 'QUALIFIED', 'DISQUALIFIED', 'MANUAL_REVIEW'
  ))
);

create trigger set_leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- Only one "active" (non-terminal) lead per business at a time.
create unique index leads_one_active_per_business
  on public.leads (business_id)
  where status not in ('CONVERTED', 'LOST', 'DISQUALIFIED', 'DO_NOT_CONTACT');

-- =========================================================================
-- 4. LEAD SCORES
-- =========================================================================

create table public.lead_scores (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  score integer not null default 0,
  website_score integer default 0,
  rating_score integer default 0,
  review_score integer default 0,
  phone_score integer default 0,
  email_score integer default 0,
  category_score integer default 0,
  activity_score integer default 0,
  reasoning text,
  scoring_version text not null default 'v1',
  created_at timestamptz not null default now()
);

-- =========================================================================
-- 5. LEAD ANALYSIS (AI)
-- =========================================================================

create table public.lead_analysis (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  business_summary text,
  target_customer text,
  services jsonb,
  recommended_pages jsonb,
  recommended_features jsonb,
  design_style text,
  recommended_colors jsonb,
  recommended_ctas jsonb,
  pain_points jsonb,
  personalization_points jsonb,
  ai_provider text,
  ai_model text,
  prompt_version text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_lead_analysis_updated_at
  before update on public.lead_analysis
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 6. DEMO TEMPLATES
-- =========================================================================

create table public.demo_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  category text not null,
  description text,
  preview_image_url text,
  configuration jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_demo_templates_updated_at
  before update on public.demo_templates
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 7. DEMOS
-- =========================================================================

create table public.demos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  template_id uuid references public.demo_templates(id) on delete set null,
  name text not null,
  slug text unique not null,
  status text not null default 'DRAFT',
  repository_url text,
  deployment_url text,
  preview_url text,
  generated_content jsonb,
  generation_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint demos_status_check check (status in (
    'DRAFT', 'GENERATING', 'GENERATED', 'DEPLOYMENT_PENDING', 'DEPLOYED',
    'FAILED', 'ARCHIVED'
  ))
);

create trigger set_demos_updated_at
  before update on public.demos
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 8. DEMO DEPLOYMENTS
-- =========================================================================

create table public.demo_deployments (
  id uuid primary key default gen_random_uuid(),
  demo_id uuid not null references public.demos(id) on delete cascade,
  provider text not null default 'vercel',
  deployment_id text,
  repository_url text,
  deployment_url text,
  status text not null default 'PENDING',
  error_message text,
  attempt_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint demo_deployments_status_check check (status in (
    'PENDING', 'BUILDING', 'READY', 'FAILED', 'CANCELLED'
  ))
);

-- =========================================================================
-- 9. CAMPAIGNS
-- =========================================================================

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'DRAFT',
  locations jsonb,
  categories jsonb,
  daily_discovery_limit integer not null default 50,
  daily_demo_limit integer not null default 20,
  daily_outreach_limit integer not null default 10,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_status_check check (status in (
    'DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'
  ))
);

create trigger set_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 10. OUTREACH MESSAGES
-- =========================================================================

create table public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  channel text not null default 'email',
  recipient_email text,
  subject text,
  message_body text,
  status text not null default 'DRAFT',
  scheduled_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  attempt_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_messages_channel_check check (channel in ('email')),
  constraint outreach_messages_status_check check (status in (
    'DRAFT', 'PENDING_APPROVAL', 'QUEUED', 'SENDING', 'SENT', 'FAILED',
    'BOUNCED', 'REPLIED', 'CANCELLED'
  ))
);

create trigger set_outreach_messages_updated_at
  before update on public.outreach_messages
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 11. OUTREACH EVENTS
-- =========================================================================

create table public.outreach_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.outreach_messages(id) on delete cascade,
  event_type text not null,
  provider_event_id text,
  metadata jsonb,
  occurred_at timestamptz not null default now(),
  constraint outreach_events_event_type_check check (event_type in (
    'QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'REPLIED',
    'BOUNCED', 'COMPLAINT', 'UNSUBSCRIBED', 'FAILED'
  ))
);

-- =========================================================================
-- 12. FOLLOWUPS
-- =========================================================================

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  parent_message_id uuid references public.outreach_messages(id) on delete set null,
  sequence_number integer not null,
  status text not null default 'SCHEDULED',
  scheduled_at timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint followups_status_check check (status in (
    'SCHEDULED', 'READY', 'SENT', 'CANCELLED', 'SKIPPED'
  ))
);

create trigger set_followups_updated_at
  before update on public.followups
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 13. SUPPRESSION LIST
-- =========================================================================

create table public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text,
  business_id uuid references public.businesses(id) on delete set null,
  reason text,
  source text,
  created_at timestamptz not null default now(),
  constraint suppression_list_email_or_phone_check
    check (email is not null or phone is not null)
);

-- =========================================================================
-- 14. AUTOMATION SETTINGS (single row)
-- =========================================================================

create table public.automation_settings (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default false,
  discovery_enabled boolean not null default true,
  ai_analysis_enabled boolean not null default true,
  demo_generation_enabled boolean not null default true,
  auto_deployment_enabled boolean not null default true,
  auto_outreach_enabled boolean not null default false,
  followups_enabled boolean not null default true,
  require_outreach_approval boolean not null default true,
  daily_discovery_limit integer not null default 50,
  daily_ai_limit integer not null default 50,
  daily_demo_limit integer not null default 20,
  daily_deployment_limit integer not null default 20,
  daily_outreach_limit integer not null default 10,
  hourly_outreach_limit integer not null default 5,
  followup_1_delay_days integer not null default 3,
  followup_2_delay_days integer not null default 7,
  timezone text not null default 'Asia/Kolkata',
  demo_mode boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_automation_settings_updated_at
  before update on public.automation_settings
  for each row execute function public.set_updated_at();

-- Enforce a single settings row.
create unique index automation_settings_singleton
  on public.automation_settings ((true));

insert into public.automation_settings (
  enabled, auto_outreach_enabled, require_outreach_approval, demo_mode
) values (false, false, true, true);

-- =========================================================================
-- 15. AUTOMATION RUNS
-- =========================================================================

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'RUNNING',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  businesses_found integer not null default 0,
  duplicates_removed integer not null default 0,
  no_website_found integer not null default 0,
  qualified_leads integer not null default 0,
  demos_created integer not null default 0,
  deployments_successful integer not null default 0,
  messages_generated integer not null default 0,
  messages_queued integer not null default 0,
  messages_sent integer not null default 0,
  followups_created integer not null default 0,
  error_count integer not null default 0,
  metadata jsonb,
  error_message text,
  constraint automation_runs_status_check check (status in (
    'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'
  ))
);

-- =========================================================================
-- 16. AUTOMATION JOBS
-- =========================================================================

create table public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  status text not null default 'PENDING',
  lead_id uuid references public.leads(id) on delete cascade,
  run_id uuid references public.automation_runs(id) on delete cascade,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  payload jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_jobs_job_type_check check (job_type in (
    'DISCOVER_BUSINESSES', 'CHECK_WEBSITE', 'ANALYZE_LEAD', 'SCORE_LEAD',
    'GENERATE_DEMO', 'DEPLOY_DEMO', 'GENERATE_OUTREACH', 'PROCESS_OUTREACH',
    'PROCESS_FOLLOWUP'
  )),
  constraint automation_jobs_status_check check (status in (
    'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRY', 'CANCELLED'
  ))
);

create trigger set_automation_jobs_updated_at
  before update on public.automation_jobs
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 17. API USAGE
-- =========================================================================

create table public.api_usage (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  operation text not null,
  quantity integer not null default 1,
  estimated_cost numeric,
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint api_usage_provider_check check (provider in (
    'google_places', 'anthropic', 'vercel', 'email'
  ))
);

-- =========================================================================
-- 18. ERROR LOGS
-- =========================================================================

create table public.error_logs (
  id uuid primary key default gen_random_uuid(),
  service text,
  error_code text,
  message text,
  lead_id uuid references public.leads(id) on delete set null,
  run_id uuid references public.automation_runs(id) on delete set null,
  job_id uuid references public.automation_jobs(id) on delete set null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- 19. AUDIT LOGS
-- =========================================================================

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- 20. INDEXES
-- =========================================================================

create index businesses_google_place_id_idx on public.businesses (google_place_id);
create index businesses_normalized_business_name_idx on public.businesses (normalized_business_name);
create index businesses_has_website_idx on public.businesses (has_website);
create index businesses_city_idx on public.businesses (city);
create index businesses_category_idx on public.businesses (category);

create index leads_business_id_idx on public.leads (business_id);
create index leads_status_idx on public.leads (status);
create index leads_lead_score_idx on public.leads (lead_score);
create index leads_priority_idx on public.leads (priority);

create index demos_lead_id_idx on public.demos (lead_id);
create index demos_status_idx on public.demos (status);

create index outreach_messages_lead_id_idx on public.outreach_messages (lead_id);
create index outreach_messages_status_idx on public.outreach_messages (status);
create index outreach_messages_scheduled_at_idx on public.outreach_messages (scheduled_at);

create index followups_lead_id_idx on public.followups (lead_id);
create index followups_status_idx on public.followups (status);
create index followups_scheduled_at_idx on public.followups (scheduled_at);

create index automation_jobs_status_idx on public.automation_jobs (status);
create index automation_jobs_job_type_idx on public.automation_jobs (job_type);
create index automation_jobs_scheduled_at_idx on public.automation_jobs (scheduled_at);

create index automation_runs_started_at_idx on public.automation_runs (started_at);

create index error_logs_created_at_idx on public.error_logs (created_at);

-- =========================================================================
-- 21. ROW LEVEL SECURITY
-- =========================================================================
-- Single-tenant internal CRM: every application table is only readable /
-- writable by an authenticated user whose profile has role = 'admin'.
-- No anonymous/public access anywhere. Service-role (server-only, bypasses
-- RLS) is used by trusted backend automation jobs.

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.leads enable row level security;
alter table public.lead_scores enable row level security;
alter table public.lead_analysis enable row level security;
alter table public.demo_templates enable row level security;
alter table public.demos enable row level security;
alter table public.demo_deployments enable row level security;
alter table public.campaigns enable row level security;
alter table public.outreach_messages enable row level security;
alter table public.outreach_events enable row level security;
alter table public.followups enable row level security;
alter table public.suppression_list enable row level security;
alter table public.automation_settings enable row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_jobs enable row level security;
alter table public.api_usage enable row level security;
alter table public.error_logs enable row level security;
alter table public.audit_logs enable row level security;

-- profiles: a user can always read/update their own row; admins can read
-- (and manage) every profile.
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy "profiles_update_own_or_admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin());

create policy "profiles_admin_insert" on public.profiles
  for insert with check (public.is_admin());

create policy "profiles_admin_delete" on public.profiles
  for delete using (public.is_admin());

-- All remaining application tables: full access for admins only.
create policy "businesses_admin_all" on public.businesses
  for all using (public.is_admin()) with check (public.is_admin());

create policy "leads_admin_all" on public.leads
  for all using (public.is_admin()) with check (public.is_admin());

create policy "lead_scores_admin_all" on public.lead_scores
  for all using (public.is_admin()) with check (public.is_admin());

create policy "lead_analysis_admin_all" on public.lead_analysis
  for all using (public.is_admin()) with check (public.is_admin());

create policy "demo_templates_admin_all" on public.demo_templates
  for all using (public.is_admin()) with check (public.is_admin());

create policy "demos_admin_all" on public.demos
  for all using (public.is_admin()) with check (public.is_admin());

create policy "demo_deployments_admin_all" on public.demo_deployments
  for all using (public.is_admin()) with check (public.is_admin());

create policy "campaigns_admin_all" on public.campaigns
  for all using (public.is_admin()) with check (public.is_admin());

create policy "outreach_messages_admin_all" on public.outreach_messages
  for all using (public.is_admin()) with check (public.is_admin());

create policy "outreach_events_admin_all" on public.outreach_events
  for all using (public.is_admin()) with check (public.is_admin());

create policy "followups_admin_all" on public.followups
  for all using (public.is_admin()) with check (public.is_admin());

create policy "suppression_list_admin_all" on public.suppression_list
  for all using (public.is_admin()) with check (public.is_admin());

create policy "automation_settings_admin_all" on public.automation_settings
  for all using (public.is_admin()) with check (public.is_admin());

create policy "automation_runs_admin_all" on public.automation_runs
  for all using (public.is_admin()) with check (public.is_admin());

create policy "automation_jobs_admin_all" on public.automation_jobs
  for all using (public.is_admin()) with check (public.is_admin());

create policy "api_usage_admin_all" on public.api_usage
  for all using (public.is_admin()) with check (public.is_admin());

create policy "error_logs_admin_all" on public.error_logs
  for all using (public.is_admin()) with check (public.is_admin());

create policy "audit_logs_admin_all" on public.audit_logs
  for all using (public.is_admin()) with check (public.is_admin());
