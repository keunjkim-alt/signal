import * as XLSX from 'xlsx';
import {errorResponse,json} from '../_lib/http.js';
import {audit,insert,requestContext,requireRole,supabase} from '../_lib/supabase.js';

const roles=new Set(['owner','admin','manager','member','viewer']);
const roleAliases:any={'대표':'owner','전체 관리자':'admin','관리자':'admin','팀 관리자':'manager','팀장':'manager','팀 구성원':'member','구성원':'member','조회 전용':'viewer','조회':'viewer'};
const pageAliases:any={'판매 허브':'hub','전사 목표·마감예측':'targets','수익성·할인 분석':'profitability','판매 이상 감지':'anomalies','제품 판매·생애주기':'sales','고객·지역 분석':'customers','반품·취소 분석':'returns','경영 의사결정':'decisions','상품기획':'planning','디자인':'design','생산':'production','재고 운영':'inventory','마케팅':'marketing','마켓레이더':'market','디자이너 360':'designer','데이터 연결 관리':'connections','사용자·권한 관리':'permissions'};
const defaultPages:any={owner:['*'],admin:['*'],manager:['hub'],member:['hub'],viewer:['hub']};
const value=(row:any,names:string[])=>{const key=Object.keys(row).find(k=>names.includes(String(k).trim().toLowerCase()));return key?row[key]:null};
const list=(input:any)=>String(input||'').split(/[,;|]/).map(x=>x.trim()).filter(Boolean);

function parse(file:File){return file.arrayBuffer().then(buffer=>{const book=XLSX.read(new Uint8Array(buffer),{type:'array'}),sheet=book.Sheets[book.SheetNames[0]];return XLSX.utils.sheet_to_json(sheet,{defval:''}) as any[]})}

export default {async fetch(request:Request){
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
  try{
    const context=await requestContext(request);requireRole(context,['owner','admin']);const form=await request.formData(),file=form.get('file');if(!(file instanceof File))return json({ok:false,error:'file is required'},400);if(file.size>5*1024*1024)return json({ok:false,error:'사용자 파일은 최대 5MB까지 지원합니다.'},413);
    const rows=await parse(file),org=context.membership.organization_id,results:any[]=[];
    for(let index=0;index<rows.length;index++){
      const row=rows[index],email=String(value(row,['email','이메일','메일'])||'').trim().toLowerCase(),displayName=String(value(row,['name','display_name','이름','성명'])||email).trim(),team=String(value(row,['team','team_code','팀','부서'])||'').trim();
      let role=String(value(row,['role','역할','권한'])||'member').trim();role=roleAliases[role]||role.toLowerCase();
      if(!email||!email.includes('@')){results.push({row:index+2,email,status:'error',message:'유효한 이메일이 필요합니다.'});continue}if(!roles.has(role)){results.push({row:index+2,email,status:'error',message:'지원하지 않는 역할입니다.'});continue}if(role==='owner'&&context.membership.role!=='owner'){results.push({row:index+2,email,status:'error',message:'대표 권한은 대표만 등록할 수 있습니다.'});continue}
      try{
        const invitation=(await supabase('/auth/v1/invite',{serviceRole:true,method:'POST',body:{email,data:{display_name:displayName},redirect_to:process.env.APP_URL||undefined}})).data,userId=invitation.id||invitation.user?.id;if(!userId)throw new Error('초대 사용자 ID가 없습니다.');
        const membership=(await insert('organization_memberships',{organization_id:org,user_id:userId,role,team_code:team||null,status:'invited',data_scope:{brands:'all',countries:'all',channels:'all',locations:'all'}},{upsert:true,onConflict:'organization_id,user_id'}))?.[0];
        const requested=list(value(row,['pages','페이지','허용 페이지'])),pageKeys=(requested.length?requested.map(p=>pageAliases[p]||p):defaultPages[role]).filter(p=>p!=='*');
        if(pageKeys.length)await insert('page_permissions',pageKeys.map(page_key=>({organization_id:org,membership_id:membership.id,page_key,can_view:true,can_update:role!=='viewer',can_approve:['owner','admin','manager'].includes(role),data_scope:{}})),{upsert:true,onConflict:'membership_id,page_key'});
        results.push({row:index+2,email,status:'invited',role,team_code:team,pageCount:pageKeys.length});
      }catch(error:any){results.push({row:index+2,email,status:'error',message:error.message})}
    }
    await audit(context,'membership.bulk_invited','organization',org,{filename:file.name,total:rows.length,success:results.filter(r=>r.status==='invited').length,error:results.filter(r=>r.status==='error').length});
    return json({ok:true,total:rows.length,success:results.filter(r=>r.status==='invited').length,error:results.filter(r=>r.status==='error').length,results},201);
  }catch(error:any){return errorResponse(error,error.status||500)}
}};
