begin;

-- Every operational fact and derived decision belongs to one workspace. Existing
-- rows are assigned to the best matching brand workspace, then to the oldest
-- organization workspace so this migration is safe on populated installations.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'mapping_templates','import_errors','products','skus','locations',
    'inventory_snapshots','inventory_movements','sales_orders','sales_order_lines',
    'transfer_orders','dashboard_views','ax_conversations','ax_messages',
    'ax_recommendations','ax_action_events','analytics_refresh_runs',
    'forecast_snapshots','discount_recommendation_snapshots','product_reviews',
    'review_aspect_signals','recommendation_outcomes','decision_executions'
  ] loop
    if to_regclass('public.'||table_name) is not null then
      execute format('alter table public.%I add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade',table_name);
    end if;
  end loop;
end $$;

-- Existing records inherit their source/upload workspace where possible.
update public.mapping_templates t set workspace_id=d.workspace_id from public.data_sources d where t.workspace_id is null and t.data_source_id=d.id;
update public.import_errors e set workspace_id=j.workspace_id from public.import_jobs j where e.workspace_id is null and e.import_job_id=j.id;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'data_sources','raw_uploads','import_jobs','mapping_templates','import_errors',
    'products','skus','locations','inventory_snapshots','inventory_movements',
    'sales_orders','sales_order_lines','transfer_orders','dashboard_views',
    'audit_logs','ax_conversations','ax_messages','ax_recommendations',
    'ax_action_events','analytics_refresh_runs','forecast_snapshots',
    'discount_recommendation_snapshots','product_reviews','review_aspect_signals',
    'recommendation_outcomes','decision_executions'
  ] loop
    if to_regclass('public.'||table_name) is not null then
      execute format($sql$
        update public.%I row set workspace_id=coalesce(
          row.workspace_id,
          (select w.id from public.workspaces w
           where w.organization_id=row.organization_id
           order by (w.brand_id is not distinct from case when to_jsonb(row) ? 'brand_id' then (to_jsonb(row)->>'brand_id')::uuid else null end) desc,
                    (w.code='default') desc,w.created_at
           limit 1))
        where row.workspace_id is null
      $sql$,table_name);
      execute format('create index if not exists %I on public.%I(organization_id,workspace_id)',
        'idx_'||table_name||'_workspace',table_name);
    end if;
  end loop;
end $$;

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.workspaces w
    join public.organization_memberships m on m.organization_id=w.organization_id
    where w.id=target_workspace and m.user_id=auth.uid() and m.status='active'
      and (coalesce(jsonb_typeof(m.data_scope->'brands') <> 'array',true) or w.brand_id is null
        or m.data_scope->'brands' ? w.brand_id::text)
  )
$$;

commit;
