begin;

create table if not exists public.ax_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '새 AX 대화',
  page_key text not null default 'hub',
  status text not null default 'active' check (status in ('active','archived')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ax_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.ax_conversations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  page_key text,
  query_spec jsonb,
  visualization_spec jsonb,
  model text,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ax_conversations_user on public.ax_conversations(organization_id,user_id,last_message_at desc);
create index if not exists idx_ax_messages_thread on public.ax_messages(organization_id,conversation_id,created_at);

alter table public.ax_conversations enable row level security;
alter table public.ax_messages enable row level security;

drop policy if exists ax_conversations_owner on public.ax_conversations;
create policy ax_conversations_owner on public.ax_conversations for all
using (public.is_org_member(organization_id) and user_id=auth.uid())
with check (public.is_org_member(organization_id) and user_id=auth.uid());

drop policy if exists ax_messages_owner on public.ax_messages;
create policy ax_messages_owner on public.ax_messages for all
using (public.is_org_member(organization_id) and exists(select 1 from public.ax_conversations c where c.id=conversation_id and c.user_id=auth.uid()))
with check (public.is_org_member(organization_id) and exists(select 1 from public.ax_conversations c where c.id=conversation_id and c.user_id=auth.uid()));

commit;
