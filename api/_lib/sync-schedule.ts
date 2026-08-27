export function scheduleMinutes(schedule:any){const text=String(schedule||'').trim();if(!text)return 15;const minute=text.match(/^(\d+)\s*분$/);if(minute)return Math.max(5,Number(minute[1]));const hour=text.match(/^(\d+)\s*시간$/);if(hour)return Math.max(1,Number(hour[1]))*60;if(/^매일\s+\d{1,2}:\d{2}$/.test(text))return 24*60;const cronMinutes=text.match(/^\*\/(\d+)\s/);if(cronMinutes)return Math.max(5,Number(cronMinutes[1]));return 15}

export function sourceSyncDue(source:any,now=new Date()){
  if(source?.sync_mode!=='scheduled'||source?.status==='paused'||source?.config?.lifecycle?.archived_at)return false;
  const last=source?.last_synced_at?new Date(source.last_synced_at):null;if(!last||Number.isNaN(last.getTime()))return true;
  const daily=String(source.schedule||'').match(/^매일\s+(\d{1,2}):(\d{2})$/);if(daily){const current=kstParts(now),previous=kstParts(last),target=Number(daily[1])*60+Number(daily[2]),currentMinutes=current.hour*60+current.minute;return currentMinutes>=target&&previous.date<current.date}
  return now.getTime()-last.getTime()>=scheduleMinutes(source.schedule)*60*1000;
}

function kstParts(date:Date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date),value=(type:string)=>parts.find(part=>part.type===type)?.value||'00';return {date:`${value('year')}-${value('month')}-${value('day')}`,hour:Number(value('hour')),minute:Number(value('minute'))}}
