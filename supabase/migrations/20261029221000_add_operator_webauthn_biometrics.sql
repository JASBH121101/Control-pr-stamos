create schema if not exists private;

create table if not exists private.operator_webauthn_credentials (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  sign_count bigint not null default 0 check (sign_count >= 0),
  transports text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.operator_webauthn_challenges (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('registration', 'authentication')),
  challenge text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
revoke all on table private.operator_webauthn_credentials from public, anon, authenticated;
revoke all on table private.operator_webauthn_challenges from public, anon, authenticated;
grant all on table private.operator_webauthn_credentials to service_role;
grant all on table private.operator_webauthn_challenges to service_role;

create index if not exists operator_webauthn_challenges_expires_at_idx
  on private.operator_webauthn_challenges (expires_at);
