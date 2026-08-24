begin;

-- One active production execution per company and product. This keeps repeated
-- clicks and concurrent AX/dashboard approvals from creating duplicate orders.
create unique index if not exists uq_ax_active_reorder_execution
  on public.ax_recommendations (organization_id, recommendation_key)
  where page_key='inventory'
    and status='approved'
    and recommendation_key like 'reorder:%'
    and payload->>'kind'='reorder';

-- New approved reorder records must contain the fields used by the production
-- queue. NOT VALID preserves legacy approvals so the application repair action
-- can upgrade them in place before this constraint is validated later.
alter table public.ax_recommendations
  add constraint ax_approved_reorder_has_execution_payload
  check (
    not (
      page_key='inventory'
      and status='approved'
      and recommendation_key like 'reorder:%'
    )
    or (
      payload->>'kind'='reorder'
      and coalesce((payload->>'quantity')::numeric,0)>0
      and nullif(payload->>'product_code','') is not null
      and nullif(payload->>'production_status','') is not null
    )
  ) not valid;

commit;
