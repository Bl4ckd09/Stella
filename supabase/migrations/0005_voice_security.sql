-- Shared security state for browser voice sessions.
-- The tables store only HMAC hashes, counters, and expiry times.

create table if not exists voice_session_tokens (
  jti_hash    text primary key check (length(jti_hash) = 64),
  expires_at  timestamptz not null,
  redeemed_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists voice_rate_limits (
  key_hash      text not null check (length(key_hash) = 64),
  window_start  bigint not null,
  request_count integer not null default 1,
  created_at    timestamptz not null default now(),
  primary key (key_hash, window_start)
);

create index if not exists voice_session_tokens_expires_idx on voice_session_tokens (expires_at);
create index if not exists voice_rate_limits_window_idx on voice_rate_limits (window_start);

alter table voice_session_tokens enable row level security;
alter table voice_rate_limits enable row level security;

create or replace function consume_voice_rate_limit(
  p_key_hash text,
  p_limit integer default 10,
  p_window_seconds integer default 60
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_epoch bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  current_window bigint;
  current_count integer;
  retry_after integer;
begin
  if length(p_key_hash) <> 64 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid_voice_rate_limit';
  end if;

  current_window := current_epoch / p_window_seconds;
  retry_after := greatest(1, p_window_seconds - (current_epoch % p_window_seconds));

  insert into voice_rate_limits (key_hash, window_start, request_count)
  values (p_key_hash, current_window, 1)
  on conflict (key_hash, window_start)
  do update set request_count = voice_rate_limits.request_count + 1
  returning request_count into current_count;

  delete from voice_rate_limits
  where window_start < current_window - 2;

  return jsonb_build_object(
    'allowed', current_count <= p_limit,
    'retry_after_seconds', retry_after
  );
end;
$$;

create or replace function register_voice_session(
  p_jti_hash text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if length(p_jti_hash) <> 64 or p_expires_at <= now() then
    return false;
  end if;

  insert into voice_session_tokens (jti_hash, expires_at)
  values (p_jti_hash, p_expires_at)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;

  delete from voice_session_tokens
  where expires_at < now() - interval '5 minutes';

  return inserted_count = 1;
end;
$$;

create or replace function redeem_voice_session(
  p_jti_hash text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  redeemed_count integer;
begin
  if length(p_jti_hash) <> 64 then
    return false;
  end if;

  update voice_session_tokens
  set redeemed_at = now()
  where jti_hash = p_jti_hash
    and redeemed_at is null
    and expires_at > now();
  get diagnostics redeemed_count = row_count;

  delete from voice_session_tokens
  where expires_at < now() - interval '5 minutes';

  return redeemed_count = 1;
end;
$$;

revoke execute on function consume_voice_rate_limit(text, integer, integer) from public;
revoke execute on function register_voice_session(text, timestamptz) from public;
revoke execute on function redeem_voice_session(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on voice_session_tokens from anon;
    revoke all on voice_rate_limits from anon;
    revoke execute on function consume_voice_rate_limit(text, integer, integer) from anon;
    revoke execute on function register_voice_session(text, timestamptz) from anon;
    revoke execute on function redeem_voice_session(text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on voice_session_tokens from authenticated;
    revoke all on voice_rate_limits from authenticated;
    revoke execute on function consume_voice_rate_limit(text, integer, integer) from authenticated;
    revoke execute on function register_voice_session(text, timestamptz) from authenticated;
    revoke execute on function redeem_voice_session(text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function consume_voice_rate_limit(text, integer, integer) to service_role;
    grant execute on function register_voice_session(text, timestamptz) to service_role;
    grant execute on function redeem_voice_session(text) to service_role;
  end if;
end;
$$;
