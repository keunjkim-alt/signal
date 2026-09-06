import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionActions} from '../api/_lib/decision-actions.ts';
import {buildOperationalTask,deriveOperationalNotifications} from '../api/_lib/beta-operations.ts';

test('a virtual brand day produces executable work for every supported decision type',()=>{
  const actions=buildDecisionActions({
    transfers:[{status:'recommended',proposal_key:'arc:seongsu:gangnam',sku_id:'sku-1',from_location_id:'seongsu',to_location_id:'gangnam',recommended_qty:180,reason:{from_available:620,to_available:24},sku:{product_code:'ARC-07'},from_location:{location_name:'성수점'},to_location:{location_name:'강남점'}}],
    reorders:[{status:'proposed',product_code:'FLOW-22',product_name:'드레이프 팬츠',recommended_reorder_qty:800,forecast_quantity:839,forecast_net_sales:123000000,available_qty:725,confidence:.77,horizon_days:28}],
    discounts:[{recommendation_id:'disc-1',decision_status:'proposed',product_code:'EASE-19',channel_code:'자사몰',current_discount_rate:20,recommended_discount_rate:10,contribution_uplift:9400000,inventory_cover_days:21,confidence:.84}],
    productionOrders:[{id:'po-1',production_order_no:'PO-001',product_code:'LAYER-11',quantity:400,forecast_net_sales:88000000,confidence:.82,production_status:'planning',progress:10,due_date:'2026-09-24'}],
    returnInsight:{hasData:true,summary:{returnRate:9.4,cancelRate:4.1,refundAmount:16000000,cancelAmount:3000000,processingCost:1200000},channels:[{label:'29CM'}],products:[{product_code:'EASE-19'}]},
    reviewInsight:{hasData:true,summary:{negativePct:26,responseNeeded:32,returnRisk:18},actions:[{team:'디자인',title:'사이즈·핏 부정 신호 확인',detail:'부정 31건'}],products:[{product_code:'ARC-07'}]},
    customerInsight:{hasData:true,summary:{anonymousCustomers:640,repeatCustomerPct:19,totalSales:420000000},regions:[{label:'서울 성동구',sales_share_pct:22}]}
  });
  const types=new Set(actions.map(row=>row.execution.action));
  assert.deepEqual([...['approve_transfer','approve_reorder','approve_discount','update_production_order','create_followup_task'].filter(type=>types.has(type))].sort(),['approve_discount','approve_reorder','approve_transfer','create_followup_task','update_production_order'].sort());
  const followups=actions.filter(row=>row.execution.action==='create_followup_task').map(row=>buildOperationalTask(row,new Date('2026-09-07T09:00:00+09:00')));
  assert.deepEqual(new Set(followups.map(row=>row.task_type)),new Set(['return_mitigation','review_response','customer_growth']));
  const notifications=deriveOperationalNotifications({actions:actions.map(row=>({...row,decision_status:'proposed'})),tasks:followups},new Date('2026-09-07T09:00:00+09:00'));
  assert.ok(notifications.some(row=>row.kind==='decision'));assert.ok(notifications.some(row=>row.kind==='task'));
});
