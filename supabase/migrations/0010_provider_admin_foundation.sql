begin;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete set null,
  name text not null,
  code text not null,
  status text not null default 'active' check (status in ('onboarding','active','paused','offboarded')),
  service_stage text not null default 'live' check (service_stage in ('setup','validation','live','care')),
  timezone text not null default 'Asia/Seoul',
  data_region text not null default 'ap-northeast-2',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

insert into public.workspaces (organization_id,brand_id,name,code,status,service_stage,timezone)
select b.organization_id,b.id,b.name,b.code,'active','live',o.timezone
from public.brands b join public.organizations o on o.id=b.organization_id
on conflict (organization_id,code) do nothing;

insert into public.workspaces (organization_id,name,code,status,service_stage,timezone)
select o.id,o.name,'default','active','live',o.timezone
from public.organizations o
where not exists (select 1 from public.workspaces w where w.organization_id=o.id)
on conflict (organization_id,code) do nothing;

alter table public.data_sources add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;
alter table public.import_jobs add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;
alter table public.raw_uploads add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;
alter table public.audit_logs add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;
alter table public.audit_logs add column if not exists trace_id text;
alter table public.audit_logs add column if not exists reason text;

update public.data_sources d set workspace_id=coalesce(
  (select w.id from public.workspaces w where w.organization_id=d.organization_id and w.brand_id=d.brand_id limit 1),
  (select w.id from public.workspaces w where w.organization_id=d.organization_id order by (w.code='default') desc,w.created_at limit 1)
) where d.workspace_id is null;

update public.raw_uploads r set workspace_id=coalesce(
  (select d.workspace_id from public.data_sources d where d.id=r.data_source_id),
  (select w.id from public.workspaces w where w.organization_id=r.organization_id order by (w.code='default') desc,w.created_at limit 1)
) where r.workspace_id is null;

update public.import_jobs j set workspace_id=coalesce(
  (select r.workspace_id from public.raw_uploads r where r.id=j.raw_upload_id),
  (select d.workspace_id from public.data_sources d where d.id=j.data_source_id),
  (select w.id from public.workspaces w where w.organization_id=j.organization_id order by (w.code='default') desc,w.created_at limit 1)
) where j.workspace_id is null;

create table if not exists public.provider_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('service_ops','data_ops','product_ops','customer_success','account_manager','sre','auditor','super_admin')),
  status text not null default 'active' check (status in ('invited','active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.provider_assignments (
  id uuid primary key default gen_random_uuid(),
  provider_membership_id uuid not null references public.provider_memberships(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (organization_id is not null or workspace_id is not null),
  unique nulls not distinct (provider_membership_id,organization_id,workspace_id)
);

create table if not exists public.operational_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  brand_id uuid references public.brands(id) on delete set null,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  object_type text not null,
  object_id text,
  correlation_id text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.attention_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  brand_id uuid references public.brands(id) on delete set null,
  source_event_id bigint references public.operational_events(id) on delete set null,
  severity text not null check (severity in ('warning','critical')),
  status text not null default 'open' check (status in ('open','acknowledged','in_progress','resolved','dismissed')),
  category text not null,
  title text not null,
  summary text,
  assigned_team text,
  assigned_user_id uuid references auth.users(id) on delete set null,
  sla_due_at timestamptz,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workspaces_org_status on public.workspaces(organization_id,status);
create index if not exists idx_provider_assignments_member on public.provider_assignments(provider_membership_id,organization_id,workspace_id);
create index if not exists idx_operational_events_scope on public.operational_events(organization_id,workspace_id,occurred_at desc);
create index if not exists idx_attention_items_queue on public.attention_items(status,severity,sla_due_at,detected_at desc);
create index if not exists idx_data_sources_workspace on public.data_sources(workspace_id,status);

alter table public.workspaces enable row level security;
alter table public.provider_memberships enable row level security;
alter table public.provider_assignments enable row level security;
alter table public.operational_events enable row level security;
alter table public.attention_items enable row level security;

drop policy if exists workspaces_org_member_select on public.workspaces;
create policy workspaces_org_member_select on public.workspaces for select using (public.is_org_member(organization_id));
drop policy if exists operational_events_org_member_select on public.operational_events;
create policy operational_events_org_member_select on public.operational_events for select using (public.is_org_member(organization_id));
drop policy if exists attention_items_org_admin_select on public.attention_items;
create policy attention_items_org_admin_select on public.attention_items for select using (public.is_org_admin(organization_id));

commit;
