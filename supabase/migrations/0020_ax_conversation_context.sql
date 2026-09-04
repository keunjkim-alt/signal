begin;

create table if not exists public.ax_conversation_contexts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ax_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  context_state jsonb not null default '{}'::jsonb,
  context_summary text,
  context_version integer not null default 1 check (context_version > 0),
  source_message_id uuid references public.ax_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id)
);

create index if not exists idx_ax_conversation_context_scope
  on public.ax_conversation_contexts(organization_id,workspace_id,user_id,updated_at desc);

alter table public.ax_conversation_contexts enable row level security;

drop policy if exists ax_conversation_contexts_owner on public.ax_conversation_contexts;
create policy ax_conversation_contexts_owner on public.ax_conversation_contexts for all
using (
  public.is_org_member(organization_id)
  and user_id=auth.uid()
  and (workspace_id is null or public.is_workspace_member(workspace_id))
  and exists(
    select 1 from public.ax_conversations c
    where c.id=conversation_id
      and c.organization_id=ax_conversation_contexts.organization_id
      and c.user_id=auth.uid()
      and c.workspace_id is not distinct from ax_conversation_contexts.workspace_id
  )
)
with check (
  public.is_org_member(organization_id)
  and user_id=auth.uid()
  and (workspace_id is null or public.is_workspace_member(workspace_id))
  and exists(
    select 1 from public.ax_conversations c
    where c.id=conversation_id
      and c.organization_id=ax_conversation_contexts.organization_id
      and c.user_id=auth.uid()
      and c.workspace_id is not distinct from ax_conversation_contexts.workspace_id
  )
);

commit;
