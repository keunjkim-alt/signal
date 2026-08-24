import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionActions,summarizeDecisionActions} from '../api/_lib/decision-actions.ts';

test('decision engine ranks urgent transfer and reorder signals before lower impact price actions',()=>{
  const actions=buildDecisionActions({
    transfers:[{status:'recommended',proposal_key:'sku:seongsu:gangnam',sku_id:'sku',from_location_id:'seongsu',to_location_id:'gangnam',recommended_qty:200,reason:{from_available:580,to_available:40},sku:{product_code:'ARC-07'},from_location:{location_name:'성수점'},to_location:{location_name:'강남점'}}],
    reorders:[{status:'proposed',product_code:'FLOW-22',product_name:'Drape Pants',recommended_reorder_qty:1200,forecast_quantity:2800,forecast_net_sales:22000000,available_qty:1600,confidence:.91,horizon_days:28}],
    discounts:[{recommendation_id:'discount-1',decision_status:'proposed',product_code:'EASE-19',channel_code:'W컨셉',current_discount_rate:5,recommended_discount_rate:10,contribution_uplift:5100000,inventory_cover_days:38,confidence:.79}]
  });
  assert.deepEqual(actions.slice(0,2).map(row=>row.priority),['P0','P0']);
  assert.equal(actions[0].kind,'reorder');
  assert.equal(actions.find(row=>row.kind==='transfer')?.execution.action,'approve_transfer');
  assert.equal(actions.find(row=>row.kind==='discount')?.execution.action,'approve_discount');
});

test('production signal advances the approved order to its next auditable stage',()=>{
  const [action]=buildDecisionActions({productionOrders:[{id:'reorder-1',production_order_no:'PO-001',product_code:'ARC-07',quantity:316,forecast_net_sales:265000000,confidence:.53,production_status:'planning',progress:10,due_date:'2026-09-11'}]});
  assert.equal(action.kind,'production');
  assert.equal(action.execution.status,'materials');
  assert.match(action.title,/원부자재/);
});

test('decision summary excludes approved actions from pending impact',()=>{
  const summary=summarizeDecisionActions([{priority:'P0',due:'오늘 16:00',impact_amount:100,decision_status:'proposed'},{priority:'P1',due:'오늘 18:00',impact_amount:900,decision_status:'approved'}]);
  assert.deepEqual(summary,{total:2,pending:1,approved:1,p0:1,dueToday:1,impactAmount:100});
});

test('customer and return intelligence become executable follow-up actions',()=>{
  const actions=buildDecisionActions({
    customerInsight:{hasData:true,summary:{anonymousCustomers:120,repeatCustomerPct:18,totalSales:100000000},regions:[{label:'서울 성동구',sales_share_pct:24}]},
    returnInsight:{hasData:true,summary:{returnRate:9.2,cancelRate:3.1,refundAmount:18000000,cancelAmount:4000000,processingCost:1000000},channels:[{label:'29CM'}],products:[{label:'Layer Top',product_code:'EASE-19'}]}
  });
  const returns=actions.find(row=>row.kind==='return_mitigation'),customer=actions.find(row=>row.kind==='customer_opportunity');
  assert.equal(returns?.priority,'P0');
  assert.equal(returns?.execution.action,'create_followup_task');
  assert.equal(returns?.target_page,'returns');
  assert.equal(customer?.priority,'P1');
  assert.equal(customer?.execution.action,'create_followup_task');
  assert.match(customer?.title,/서울 성동구/);
});
