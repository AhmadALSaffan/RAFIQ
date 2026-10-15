-- A free Supabase project is paused after about a week without activity. A scheduled
-- GitHub Action reads this one row every day (.github/workflows/keepalive.yml), which is
-- enough to keep the project awake. The row holds nothing private, so it may be read by
-- anyone with the public (publishable) key — and nothing else may be done with it.
create table public.keepalive (
  id smallint primary key default 1 check (id = 1),
  note text not null default 'Rafiq keeps this project awake by reading this row once a day.'
);
insert into public.keepalive (id) values (1);

alter table public.keepalive enable row level security;
revoke all on public.keepalive from anon, authenticated;
grant select on public.keepalive to anon;
create policy "anyone may read the keep-alive row" on public.keepalive for select to anon using (true);
