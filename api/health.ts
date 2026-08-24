import {json} from './_lib/http.js';
import {backendConfigured} from './_lib/supabase.js';

export default {async fetch(){return json({ok:true,service:'viimsignal-api',backendConfigured:backendConfigured(),openaiConfigured:Boolean(process.env.OPENAI_API_KEY),time:new Date().toISOString()})}};
