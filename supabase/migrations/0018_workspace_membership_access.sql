begin;

-- Complete workspace lineage for child/event tables introduced by planning and
-- execution migrations. Keeping the workspace on each row makes filtering and
-- RLS deterministic without relying on joins at query time.
alter table public.inbound_order_lines add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.recommendation_decisions add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.recommendation_scenario_lines add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.execution_events add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.ax_query_cache add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

update public.inbound_order_lines l set workspace_id=o.workspace_id from public.inbound_orders o where l.workspace_id is null and l.inbound_order_id=o.id;
update public.recommendation_decisions d set workspace_id=s.workspace_id from public.recommendation_scenario_lines l join public.recommendation_scenarios s on s.id=l.scenario_id where d.workspace_id is null and d.recommendation_line_id=l.id;
update public.recommendation_scenario_lines l set workspace_id=s.workspace_id from public.recommendation_scenarios s where l.workspace_id is null and l.scenario_id=s.id;
update public.execution_events e set workspace_id=r.workspace_id from public.execution_requests r where e.workspace_id is null and e.execution_request_id=r.id;

create index if not exists idx_inbound_order_lines_workspace on public.inbound_order_lines(organization_id,workspace_id);
create index if not exists idx_recommendation_decisions_workspace on public.recommendation_decisions(organization_id,workspace_id);
create index if not exists idx_recommendation_scenario_lines_workspace on public.recommendation_scenario_lines(organization_id,workspace_id);
create index if not exists idx_execution_events_workspace on public.execution_events(organization_id,workspace_id);
create index if not exists idx_ax_query_cache_workspace on public.ax_query_cache(organization_id,workspace_id,expires_at);
create table if not exists public.workspace_memberships (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade, membership_id uuid not null references public.organization_memberships(id) on delete cascade,
  role text check (role is null or role in ('admin','manager','member','viewer')), status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,membership_id)
);
insert into public.workspace_memberships(organization_id,workspace_id,membership_id,role,status)
select w.organization_id,w.id,m.id,null,'active' from public.workspaces w join public.organization_memberships m on m.organization_id=w.organization_id
on conflict(workspace_id,membership_id) do nothing;
create index if not exists idx_workspace_memberships_member on public.workspace_memberships(membership_id,status,workspace_id);
alter table public.workspace_memberships enable row level security;
drop policy if exists workspace_memberships_member_select on public.workspace_memberships;
create policy workspace_memberships_member_select on public.workspace_memberships for select using (public.is_org_member(organization_id));
drop policy if exists workspace_memberships_admin_write on public.workspace_memberships;
create policy workspace_memberships_admin_write on public.workspace_memberships for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create or replace function public.is_workspace_member(target_workspace uuid) returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from public.workspace_memberships wm join public.organization_memberships m on m.id=wm.membership_id where wm.workspace_id=target_workspace and wm.status='active' and m.user_id=auth.uid() and m.status='active') $$;
commit;
