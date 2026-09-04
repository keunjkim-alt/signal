begin;

alter table public.operational_events
  add column if not exists dedupe_key text,
  add column if not exists processed_at timestamptz;

alter table public.attention_items
  add column if not exists dedupe_key text,
  add column if not exists response_due_at timestamptz,
  add column if not exists resolution_due_at timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists source_object_type text,
  add column if not exists source_object_id text;

create unique index if not exists operational_events_dedupe_idx
  on public.operational_events(organization_id,dedupe_key)
  where dedupe_key is not null;

create unique index if not exists attention_items_active_dedupe_idx
  on public.attention_items(organization_id,dedupe_key)
  where dedupe_key is not null and status not in ('resolved','dismissed');

create table if not exists public.operational_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  brand_id uuid references public.brands(id) on delete set null,
  attention_item_id uuid references public.attention_items(id) on delete set null,
  incident_id uuid,
  task_type text not null,
  priority text not null default 'p2' check (priority in ('p0','p1','p2','p3')),
  status text not null default 'ready' check (status in ('ready','in_progress','verification','completed','cancelled')),
  title text not null,
  description text,
  assigned_team text,
  assigned_user_id uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  completion_criteria jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  resolution_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  source_attention_item_id uuid references public.attention_items(id) on delete set null,
  incident_key text not null unique,
  severity text not null check (severity in ('p0','p1','p2')),
  status text not null default 'investigating' check (status in ('investigating','identified','monitoring','resolved','closed')),
  title text not null,
  summary text,
  incident_commander_id uuid references auth.users(id) on delete set null,
  affected_organization_ids uuid[] not null default '{}',
  affected_workspace_ids uuid[] not null default '{}',
  affected_features text[] not null default '{}',
  customer_message text,
  next_update_at timestamptz,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.operational_tasks
  drop constraint if exists operational_tasks_incident_id_fkey;
alter table public.operational_tasks
  add constraint operational_tasks_incident_id_fkey foreign key (incident_id) references public.incidents(id) on delete set null;

create table if not exists public.incident_updates (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  status text not null,
  internal_note text,
  customer_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_operational_tasks_queue on public.operational_tasks(status,priority,due_at,created_at desc);
create index if not exists idx_operational_tasks_scope on public.operational_tasks(organization_id,workspace_id,status);
create index if not exists idx_incidents_status on public.incidents(status,severity,started_at desc);
create index if not exists idx_incident_updates_timeline on public.incident_updates(incident_id,created_at desc);

alter table public.operational_tasks enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_updates enable row level security;

drop policy if exists operational_tasks_org_admin_select on public.operational_tasks;
create policy operational_tasks_org_admin_select on public.operational_tasks for select
using (public.is_org_admin(organization_id));

drop policy if exists incidents_org_admin_select on public.incidents;
create policy incidents_org_admin_select on public.incidents for select
using (organization_id is not null and public.is_org_admin(organization_id));

commit;
