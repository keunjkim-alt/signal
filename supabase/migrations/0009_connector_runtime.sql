begin;

alter table public.mapping_templates drop constraint if exists mapping_templates_entity_type_check;
alter table public.mapping_templates
  add constraint mapping_templates_entity_type_check check (
    entity_type in ('product_master','inventory_snapshot','inventory_movement','inbound_order','transfer_order','sales_order')
  );

create index if not exists data_sources_scheduled_sync_idx
  on public.data_sources(organization_id,status,sync_mode,last_synced_at)
  where status in ('draft','active','error') and sync_mode = 'scheduled';

commit;
