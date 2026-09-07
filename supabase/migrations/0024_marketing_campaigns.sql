begin;

alter table public.mapping_templates drop constraint if exists mapping_templates_entity_type_check;
alter table public.mapping_templates
  add constraint mapping_templates_entity_type_check check (
    entity_type in ('product_master','inventory_snapshot','inventory_movement','inbound_order','transfer_order','sales_order','product_review','marketing_campaign')
  );

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  data_source_id uuid references public.data_sources(id) on delete set null,
  raw_upload_id uuid references public.raw_uploads(id) on delete set null,
  import_job_id uuid references public.import_jobs(id) on delete set null,
  source_campaign_id text not null,
  campaign_name text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  channel_code text not null,
  campaign_type text,
  budget numeric(16,2) not null default 0 check (budget >= 0),
  owner text,
  status text not null default 'planned' check (status in ('planned','in_progress','completed','paused','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id,workspace_id,source_campaign_id)
);

create table if not exists public.marketing_campaign_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  data_source_id uuid references public.data_sources(id) on delete set null,
  raw_upload_id uuid references public.raw_uploads(id) on delete set null,
  import_job_id uuid references public.import_jobs(id) on delete set null,
  observed_at timestamptz not null,
  spend numeric(16,2) not null default 0 check (spend >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  conversions bigint not null default 0 check (conversions >= 0),
  attributed_sales numeric(16,2) not null default 0 check (attributed_sales >= 0),
  control_group_size bigint check (control_group_size >= 0),
  control_group_conversions bigint check (control_group_conversions >= 0),
  created_at timestamptz not null default now(),
  unique nulls not distinct (organization_id,workspace_id,campaign_id,observed_at)
);

create index if not exists idx_marketing_campaigns_workspace_status on public.marketing_campaigns(organization_id,workspace_id,status,start_at desc);
create index if not exists idx_marketing_snapshots_workspace_date on public.marketing_campaign_snapshots(organization_id,workspace_id,observed_at desc);

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_campaign_snapshots enable row level security;

drop policy if exists marketing_campaigns_member_select on public.marketing_campaigns;
create policy marketing_campaigns_member_select on public.marketing_campaigns for select using (
  public.is_org_member(organization_id) and (workspace_id is null or public.is_workspace_member(workspace_id))
);
drop policy if exists marketing_campaigns_admin_write on public.marketing_campaigns;
create policy marketing_campaigns_admin_write on public.marketing_campaigns for all using (
  public.is_org_admin(organization_id) and (workspace_id is null or public.is_workspace_member(workspace_id))
) with check (
  public.is_org_admin(organization_id) and (workspace_id is null or public.is_workspace_member(workspace_id))
);

drop policy if exists marketing_snapshots_member_select on public.marketing_campaign_snapshots;
create policy marketing_snapshots_member_select on public.marketing_campaign_snapshots for select using (
  public.is_org_member(organization_id) and (workspace_id is null or public.is_workspace_member(workspace_id))
);
drop policy if exists marketing_snapshots_admin_write on public.marketing_campaign_snapshots;
create policy marketing_snapshots_admin_write on public.marketing_campaign_snapshots for all using (
  public.is_org_admin(organization_id) and (workspace_id is null or public.is_workspace_member(workspace_id))
) with check (
  public.is_org_admin(organization_id) and (workspace_id is null or public.is_workspace_member(workspace_id))
);

commit;
