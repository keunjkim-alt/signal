const normalize=(value:any)=>String(value??'').trim().toLowerCase().replace(/[\s._\-/()]+/g,'');

export const PRODUCT_MASTER_FIELDS={
  product_code:['product_code','style_code','product_id','품번','스타일코드','상품코드','제품코드'],
  product_name:['product_name','style_name','item_name','상품명','제품명','품목명'],
  sku_code:['sku_code','sku','option_code','단품코드','옵션코드','sku코드'],
  category_l1:['category_l1','category','대분류','카테고리','상품군'],
  category_l2:['category_l2','subcategory','중분류','세부카테고리'],
  season:['season','시즌','시즌코드'],
  image_url:['image_url','product_image','image','이미지url','상품이미지','대표이미지'],
  barcode:['barcode','바코드','ean','upc'],
  color:['color','colour','색상','컬러'],
  size:['size','사이즈','규격'],
  list_price:['list_price','retail_price','정상가','소비자가','판매가'],
  unit_cost:['unit_cost','cost_price','원가','매입가','개당원가']
};

export const PRODUCT_MASTER_REQUIRED_FIELDS=['product_code','product_name'];

export function inferProductMapping(headers:string[],requested:any={}){
  const byNormalized=new Map(headers.map(header=>[normalize(header),header])),mapping:any={};
  for(const [canonical,aliases] of Object.entries(PRODUCT_MASTER_FIELDS)){
    const explicit=requested[canonical];if(explicit&&headers.includes(explicit)){mapping[canonical]=explicit;continue}
    const match=(aliases as string[]).map(normalize).find(alias=>byNormalized.has(alias));if(match)mapping[canonical]=byNormalized.get(match);
  }
  return mapping;
}

export function validateAndNormalizeProducts(rows:Record<string,any>[],mapping:any){
  const missingFields=PRODUCT_MASTER_REQUIRED_FIELDS.filter(field=>!mapping[field]);
  if(missingFields.length)return {validRows:[],errors:[],missingFields,period:{start:null,end:null}};
  const validRows:any[]=[],errors:any[]=[];
  rows.forEach((row,index)=>{
    const get=(field:string)=>row[mapping[field]],productCode=cleanCode(get('product_code')),productName=cleanText(get('product_name')),skuCode=cleanCode(get('sku_code'))||productCode;
    const invalid:string[]=[];if(!productCode)invalid.push('product_code');if(!productName)invalid.push('product_name');
    if(invalid.length){errors.push({row_number:index+2,error_code:'INVALID_ROW',field_name:invalid.join(','),message:`필수값 오류: ${invalid.join(', ')}`,raw_row:row});return}
    validRows.push({row_number:index+2,product_code:productCode,product_name:productName,sku_code:skuCode,category_l1:cleanText(get('category_l1')),category_l2:cleanText(get('category_l2')),season:cleanText(get('season')),image_url:cleanUrl(get('image_url')),barcode:cleanText(get('barcode')),color:cleanText(get('color')),size:cleanText(get('size')),list_price:nonNegativeNumber(get('list_price')),unit_cost:nonNegativeNumber(get('unit_cost')),raw_row:row});
  });
  return {validRows,errors,missingFields:[],period:{start:null,end:null}};
}

function cleanCode(value:any){return String(value??'').trim().toUpperCase()||null}
function cleanText(value:any){return String(value??'').trim()||null}
function cleanUrl(value:any){const text=cleanText(value);if(!text)return null;try{const url=new URL(text);return ['http:','https:'].includes(url.protocol)?url.toString():null}catch{return null}}
function nonNegativeNumber(value:any){if(value===null||value===undefined||value==='')return null;const parsed=Number(String(value).replace(/[,₩원\s]/g,''));return Number.isFinite(parsed)?Math.max(0,parsed):null}
