-- Every GitHub Marketplace event for Rafiq: who installed it, changed plan or cancelled.
-- Written only by the github-marketplace Edge Function (service role); nobody else can read
-- or write it, so RLS is on with no policies.
create table public.marketplace_events (
  id bigint generated always as identity primary key,
  delivery_id text not null unique,          -- X-GitHub-Delivery: a redelivery isn't stored twice
  received_at timestamptz not null default now(),
  event text not null,                       -- marketplace_purchase | ping
  action text,                               -- purchased | pending_change | changed | cancelled | pending_change_cancelled
  account_id bigint,
  account_login text,
  account_type text,                         -- User | Organization
  plan_name text,
  effective_date timestamptz,
  payload jsonb not null
);

create index marketplace_events_account_idx on public.marketplace_events (account_id, received_at desc);

alter table public.marketplace_events enable row level security;
revoke all on public.marketplace_events from anon, authenticated;
