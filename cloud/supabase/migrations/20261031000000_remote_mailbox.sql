-- Rafiq from your phone: the cloud is only a mailman. Devices drop end-to-end encrypted
-- envelopes for each other here; the database never sees what's inside. No device can write
-- to `devices` directly, and a device only works from the login session that registered it,
-- so revoking one cuts it off at once, even while its access token is still valid.
create extension if not exists pg_cron with schema pg_catalog;

create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('computer', 'phone')),
  name text not null check (char_length(name) between 1 and 64),
  public_key text not null check (char_length(public_key) between 32 and 128), -- X25519, base64
  session_id uuid,                                                             -- auth session this device runs under
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, public_key)
);
create index devices_session_idx on public.devices (session_id);

create table public.envelopes (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,                                     -- delivery order
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_device uuid not null references public.devices (id) on delete cascade,
  to_device uuid not null references public.devices (id) on delete cascade,
  ciphertext text not null check (octet_length(ciphertext) between 1 and 65536),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  check (from_device <> to_device)
);
create index envelopes_to_idx on public.envelopes (to_device, seq);
create index envelopes_from_idx on public.envelopes (from_device);
create index envelopes_user_idx on public.envelopes (user_id);
create index envelopes_expiry_idx on public.envelopes (expires_at);

-- Sends per account per hour. A counter, since delivered envelopes are deleted.
create table private.send_counts (
  user_id uuid not null references auth.users (id) on delete cascade,
  hour timestamptz not null,
  sent integer not null default 0,
  primary key (user_id, hour)
);

create function private.is_current_device(device uuid) returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1 from public.devices d
    where d.id = device
      and d.user_id = (select auth.uid())
      and d.revoked_at is null
      and d.session_id = ((select auth.jwt()) ->> 'session_id')::uuid
  );
$$;
revoke all on function private.is_current_device(uuid) from public;
grant execute on function private.is_current_device(uuid) to authenticated;

create function private.is_my_active_device(device uuid) returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1 from public.devices d
    where d.id = device and d.user_id = (select auth.uid()) and d.revoked_at is null
  );
$$;
revoke all on function private.is_my_active_device(uuid) from public;
grant execute on function private.is_my_active_device(uuid) to authenticated;

alter table public.devices enable row level security;
alter table public.envelopes enable row level security;
revoke all on public.devices from anon, authenticated;
revoke all on public.envelopes from anon, authenticated;

grant select on public.devices to authenticated;
create policy "see your own devices" on public.devices
  for select to authenticated using (user_id = (select auth.uid()));

-- Only these columns can be sent, so a device can't choose its account, order or expiry.
grant select, delete on public.envelopes to authenticated;
grant insert (from_device, to_device, ciphertext) on public.envelopes to authenticated;
create policy "send from this device to your own" on public.envelopes
  for insert to authenticated
  with check (private.is_current_device(from_device) and private.is_my_active_device(to_device));
-- The sender can see what's still waiting and cancel it.
create policy "see what's to or from this device" on public.envelopes
  for select to authenticated
  using (private.is_current_device(to_device) or private.is_current_device(from_device));
create policy "clear what's to or from this device" on public.envelopes
  for delete to authenticated
  using (private.is_current_device(to_device) or private.is_current_device(from_device));

create function private.limit_envelopes() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  sent_now integer;
begin
  insert into private.send_counts as c (user_id, hour, sent)
  values (new.user_id, date_trunc('hour', now()), 1)
  on conflict (user_id, hour) do update set sent = c.sent + 1
  returning c.sent into sent_now;
  if sent_now > 2000 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from public.envelopes e where e.to_device = new.to_device) >= 200 then
    raise exception 'mailbox_full' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.limit_envelopes() from public;
create trigger limit_envelopes before insert on public.envelopes
  for each row execute function private.limit_envelopes();

-- Registers this device under the current login, or moves it there after signing in again.
create function public.register_device(p_kind text, p_name text, p_public_key text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  session uuid := (auth.jwt() ->> 'session_id')::uuid;
  device uuid;
  revoked timestamptz;
begin
  if me is null or session is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text, 0));
  select d.id, d.revoked_at into device, revoked
    from public.devices d where d.user_id = me and d.public_key = p_public_key;
  if device is not null and revoked is not null then
    raise exception 'device_revoked' using errcode = '42501';
  end if;
  if device is null and
     (select count(*) from public.devices d where d.user_id = me and d.revoked_at is null) >= 5 then
    raise exception 'device_limit' using errcode = 'P0001';
  end if;
  update public.devices d set session_id = null where d.session_id = session;
  if device is null then
    insert into public.devices (user_id, kind, name, public_key, session_id)
    values (me, p_kind, p_name, p_public_key, session)
    returning id into device;
  else
    update public.devices d
       set session_id = session, name = p_name, kind = p_kind, last_seen_at = now()
     where d.id = device;
  end if;
  return device;
end;
$$;

-- "I'm still here", from the device itself.
create function public.touch_device(p_device uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_current_device(p_device) then
    raise exception 'device_revoked' using errcode = '42501';
  end if;
  update public.devices d set last_seen_at = now() where d.id = p_device;
end;
$$;

-- Cuts off a lost or sold device: any login on the account can do it. Its mail goes and its
-- login session ends.
create function public.revoke_device(p_device uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  session uuid;
begin
  select d.session_id into session from public.devices d
   where d.id = p_device and d.user_id = auth.uid() and d.revoked_at is null;
  if not found then
    return;
  end if;
  update public.devices d set revoked_at = now(), session_id = null where d.id = p_device;
  delete from public.envelopes e where e.to_device = p_device or e.from_device = p_device;
  if session is not null then
    delete from auth.sessions s where s.id = session and s.user_id = auth.uid();
  end if;
end;
$$;

revoke all on function public.register_device(text, text, text) from public, anon;
revoke all on function public.touch_device(uuid) from public, anon;
revoke all on function public.revoke_device(uuid) from public, anon;
grant execute on function public.register_device(text, text, text) to authenticated;
grant execute on function public.touch_device(uuid) to authenticated;
grant execute on function public.revoke_device(uuid) to authenticated;

-- Devices hear new mail at once over their own outgoing connection; RLS applies there too.
alter publication supabase_realtime add table public.envelopes;

-- Unread mail doesn't stay forever, and revoked devices are forgotten after a month.
create function private.sweep() returns void
language sql security definer set search_path = ''
as $$
  delete from public.envelopes where expires_at < now();
  delete from private.send_counts where hour < now() - interval '1 day';
  delete from public.devices where revoked_at < now() - interval '30 days';
$$;
revoke all on function private.sweep() from public;
select cron.schedule('rafiq-sweep', '7 * * * *', 'select private.sweep()');
