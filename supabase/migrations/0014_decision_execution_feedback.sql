begin;

alter table public.recommendation_decisions
  add column if not exists decision_version integer not null default 1,
  add column if not exists decided_from_location_id uuid references public.locations(id) on delete set null,
  add column if not exists decided_to_location_id uuid references public.locations(id) on delete set null,
  add column if not exists requested_execution_date date,
  add column if not exists expected_effect_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists is_current boolean not null default true,
  add column if not exists supersedes_decision_id bigint references public.recommendation_decisions(id) on delete set null;

create unique index if not exists uq_recommendation_decisions_current
  on public.recommendation_decisions(recommendation_line_id)
  where is_current;

create table if not exists public.execution_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  decision_id bigint not null references public.recommendation_decisions(id) on delete cascade,
  transfer_order_id uuid references public.transfer_orders(id) on delete set null,
  execution_no text not null,
  execution_type text not null check (execution_type in ('transfer','reorder','allocation','other')),
  status text not null default 'requested' check (status in ('requested','accepted','in_progress','partially_completed','completed','cancelled','failed')),
  requested_qty numeric(16,3) not null check (requested_qty >= 0),
  executed_qty numeric(16,3) not null default 0 check (executed_qty >= 0),
  received_qty numeric(16,3) not null default 0 check (received_qty >= 0),
  external_system text,
  external_execution_id text,
  verification_method text not null default 'unverified' check (verification_method in ('unverified','manual','file_reconciled','api_confirmed','inferred')),
  verification_confidence numeric(7,4) check (verification_confidence is null or (verification_confidence between 0 and 1)),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,execution_no),
  unique (decision_id)
);

create table if not exists public.execution_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  execution_request_id uuid not null references public.execution_requests(id) on delete cascade,
  event_type text not null check (event_type in ('requested','accepted','dispatched','in_transit','partially_received','received','cancelled','failed','manual_verified','file_reconciled','api_confirmed','inventory_inferred')),
  previous_status text,
  next_status text,
  quantity numeric(16,3) check (quantity is null or quantity >= 0),
  occurred_at timestamptz not null default now(),
  source_type text not null default 'user' check (source_type in ('user','file','api','system')),
  external_reference text,
  evidence jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.policy_change_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  sku_id uuid references public.skus(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  candidate_type text not null check (candidate_type in ('capacity','safety_stock','review_period','lead_time','min_transfer','max_transfer','route_cost','forecast_bias')),
  current_value jsonb not null default '{}'::jsonb,
  proposed_value jsonb not null,
  evidence_count integer not null default 0 check (evidence_count >= 0),
  evidence jsonb not null default '[]'::jsonb,
  expected_improvement jsonb not null default '{}'::jsonb,
  confidence numeric(7,4) check (confidence is null or (confidence between 0 and 1)),
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','applied','expired')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.recommendation_outcomes
  add column if not exists execution_request_id uuid references public.execution_requests(id) on delete set null,
  add column if not exists verification_method text not null default 'unverified',
  add column if not exists learning_eligible boolean not null default false;

create index if not exists idx_execution_requests_queue on public.execution_requests(organization_id,status,requested_at desc);
create index if not exists idx_execution_events_timeline on public.execution_events(organization_id,execution_request_id,occurred_at);
create index if not exists idx_policy_candidates_review on public.policy_change_candidates(organization_id,status,confidence desc,created_at desc);
create index if not exists idx_recommendation_outcomes_execution on public.recommendation_outcomes(organization_id,execution_request_id,measurement_end_date);

alter table public.execution_requests enable row level security;
alter table public.execution_events enable row level security;
alter table public.policy_change_candidates enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['execution_requests','execution_events','policy_change_candidates']
  loop
    execute format('create policy %I_member_select on public.%I for select using (public.is_org_member(organization_id))',table_name,table_name);
    execute format('create policy %I_admin_write on public.%I for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id))',table_name,table_name);
  end loop;
end $$;

commit;
