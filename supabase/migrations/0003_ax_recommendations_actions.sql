begin;

create table if not exists public.ax_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.ax_conversations(id) on delete cascade,
  recommendation_key text not null,
  page_key text not null,
  title text not null,
  status text not null default 'proposed' check (status in ('proposed','approved','adjustment_requested','review_requested','held','executed')),
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,conversation_id,recommendation_key)
);

create table if not exists public.ax_action_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_id uuid not null references public.ax_recommendations(id) on delete cascade,
  conversation_id uuid not null references public.ax_conversations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('approved','adjustment_requested','review_requested','held','executed')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ax_recommendations_queue on public.ax_recommendations(organization_id,page_key,status,updated_at desc);
create index if not exists idx_ax_action_events_thread on public.ax_action_events(organization_id,conversation_id,created_at desc);

alter table public.ax_recommendations enable row level security;
alter table public.ax_action_events enable row level security;

drop policy if exists ax_recommendations_member_select on public.ax_recommendations;
create policy ax_recommendations_member_select on public.ax_recommendations for select
using (public.is_org_member(organization_id));

drop policy if exists ax_recommendations_admin_write on public.ax_recommendations;
create policy ax_recommendations_admin_write on public.ax_recommendations for all
using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists ax_action_events_member_select on public.ax_action_events;
create policy ax_action_events_member_select on public.ax_action_events for select
using (public.is_org_member(organization_id));

drop policy if exists ax_action_events_admin_write on public.ax_action_events;
create policy ax_action_events_admin_write on public.ax_action_events for all
using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

commit;
