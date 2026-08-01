-- owner: identity
-- reviewed: 2026-08-01

create schema if not exists identity;

create table if not exists identity.identities (
  id uuid primary key,
  email text not null,
  created_at timestamptz not null default now(),
  constraint identities_email_key unique (email)
);
