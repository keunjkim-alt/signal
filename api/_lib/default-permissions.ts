export const permissionPageKeys=['action','hub','targets','profitability','anomalies','sales','customers','returns','decisions','execution','planning','design','production','inventory','marketing','market','designer','connections','permissions'];

const commonPages=['action','hub'];
const fallbackTeamPages=['anomalies','sales','inventory'];
const teamPageRules:[RegExp,string[]][]=[
  [/판매|영업|리테일|store|sales/i,['targets','profitability','anomalies','sales','customers','returns','inventory']],
  [/상품|기획|md|merch/i,['sales','planning','design','market','designer']],
  [/디자인|design/i,['planning','design','market','designer']],
  [/생산|production|소싱/i,['design','production','inventory']],
  [/재고|물류|scm|logistics|warehouse/i,['sales','production','inventory']],
  [/마케팅|marketing|crm/i,['targets','profitability','customers','marketing','market']],
  [/고객|cs|cx|customer/i,['customers','returns']],
  [/데이터|ax|it|시스템|data/i,['anomalies','connections']]
];

export function defaultPermissionPages(role:string,teamCode=''){
  if(['owner','admin'].includes(role))return [];
  if(role==='viewer')return commonPages;
  const matched=teamPageRules.find(([pattern])=>pattern.test(String(teamCode||'')))?.[1]||fallbackTeamPages;
  return [...new Set([...commonPages,...matched])];
}

export function defaultPagePermissions(role:string,teamCode='',organizationId?:string,membershipId?:string){
  return defaultPermissionPages(role,teamCode).map(page_key=>({
    ...(organizationId?{organization_id:organizationId}:{}),
    ...(membershipId?{membership_id:membershipId}:{}),
    page_key,
    can_view:true,
    can_update:role!=='viewer',
    can_approve:role==='manager',
    data_scope:{}
  }));
}
