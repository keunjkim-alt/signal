begin;

-- A company can operate more than one brand workspace. Reorder idempotency must
-- therefore be enforced inside a workspace, not across the entire company.
drop index if exists public.uq_ax_active_reorder_execution;

create unique index uq_ax_active_reorder_execution
  on public.ax_recommendations (organization_id, workspace_id, recommendation_key)
  nulls not distinct
  where page_key='inventory'
    and status='approved'
    and recommendation_key like 'reorder:%'
    and payload->>'kind'='reorder';

commit;
