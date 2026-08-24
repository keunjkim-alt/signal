import {clearAuthCookies} from '../_lib/cookies.js';

export default {async fetch(request:Request){const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});clearAuthCookies(request).forEach(cookie=>headers.append('set-cookie',cookie));return new Response(JSON.stringify({ok:true}),{status:200,headers})}};
