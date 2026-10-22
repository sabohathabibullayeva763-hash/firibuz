// FiribStop UZ live cybersecurity news proxy. Node.js 18+; no API keys required.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const CACHE_MS = 10 * 60 * 1000;
let newsCache = { items: [], sources: [], updatedAt: null, fetchedAt: 0 };
let geoCache = null;
const FEEDS = [
  { name: 'CISA — официальные рекомендации', url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml', official: true },
  { name: 'CISA — новости', url: 'https://www.cisa.gov/news.xml', official: true },
  { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', official: false },
  { name: 'SecurityWeek', url: 'https://www.securityweek.com/feed/', official: false }
];
const TYPES = [
  ['ransomware', /ransomware|ransom|шифровальщик|вымогател/i],
  ['уязвимости', /vulnerabilit|cve-|zero.day|уязвимост|эксплуатац/i],
  ['фишинг', /phish|scam|fraud|фишинг|мошеннич/i],
  ['утечка данных', /data breach|leak|exposed data|утечк/i],
  ['вредоносное ПО', /malware|trojan|botnet|вредоносн|троян/i],
  ['кибератака / инцидент', /cyber.?attack|hack(ed|ing)?|incident|attack|кибератак|взлом|инцидент/i]
];
function decode(s='') { return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/\s+/g,' ').trim(); }
function tag(block, names) { for (const name of names) { const re = new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'\\s*>','i'); const m=block.match(re); if(m) return m[1]; } return ''; }
function classify(text) { for(const [name,re] of TYPES) if(re.test(text)) return name; return 'кибербезопасность'; }
function cleanUrl(raw) { const s=decode(raw); try { const u=new URL(s); return ['http:','https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
function parseFeed(xml, feed) {
 const blocks = xml.match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)\s*>/gi) || [];
 return blocks.map((b,i)=>{
   const title=decode(tag(b,['title']));
   let link=tag(b,['link']);
   if(!link){const m=b.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);if(m)link=m[1];}
   let url=cleanUrl(link);
   if(!url){const m=b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);if(m)url=cleanUrl(m[1]);}
   const description=decode(tag(b,['description','summary','content:encoded','content'])).slice(0,700);
   const date=decode(tag(b,['pubDate','published','updated','dc:date','date']));
   const parsedDate=date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null;
   if(!title || !url) return null;
   const text=title+' '+description;
   return { id:Buffer.from(url).toString('base64url').slice(0,80), title, description, url, date:parsedDate, source:feed.name, category:classify(text), important:/critical|actively exploited|zero.day|ransomware|data breach|кибератак|критическ|активно эксплуат/i.test(text), official:feed.official, region:null, confidence:'Источник публикации; географическая привязка не подтверждена' };
 }).filter(Boolean);
}
async function fetchFeed(feed) {
 const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),9000);
 try { const r=await fetch(feed.url,{signal:controller.signal,headers:{'user-agent':'FiribStop-Community-Security-News/1.0','accept':'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'}}); if(!r.ok)throw new Error('HTTP '+r.status); const xml=await r.text(); if(!xml.includes('<'))throw new Error('Ответ не похож на XML'); return {items:parseFeed(xml,feed),status:{name:feed.name,ok:true,count:parseFeed(xml,feed).length}}; }
 finally {clearTimeout(timer);}
}
async function loadNews(force=false) {
 if(!force && newsCache.fetchedAt && Date.now()-newsCache.fetchedAt<CACHE_MS) return newsCache;
 const results=await Promise.all(FEEDS.map(async f=>{try{return await fetchFeed(f)}catch(e){return {items:[],status:{name:f.name,ok:false,error:String(e.message||e).slice(0,120),count:0}}}}));
 let items=results.flatMap(r=>r.items);
 const seen=new Set(); items=items.filter(x=>{const key=x.url.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>Date.parse(b.date||0)-Date.parse(a.date||0)).slice(0,160);
 newsCache={items,sources:results.map(r=>r.status),updatedAt:new Date().toISOString(),fetchedAt:Date.now()};
 return newsCache;
}
async function loadGeo() {
 if(geoCache)return geoCache;
 const urls=['https://raw.githubusercontent.com/akbartus/GeoJSON-Uzbekistan/main/geojson/uzbekistan_regional.geojson','https://raw.githubusercontent.com/negeloT/uzbekistan_borders/main/GEOJSON_LVL/uzbekistan_lvl2.geojson'];
 for(const url of urls){try{const r=await fetch(url,{headers:{'user-agent':'FiribStop-Community-Map/1.0'},signal:AbortSignal.timeout(10000)});if(!r.ok)continue;const j=await r.json();if(j&&j.type==='FeatureCollection'&&Array.isArray(j.features)&&j.features.length>=10){geoCache=j;return j;}}catch{}}
 throw new Error('Геоданные регионов временно недоступны');
}
function send(res,code,data,type='application/json; charset=utf-8'){const body=type.startsWith('application/json')?JSON.stringify(data):data;res.writeHead(code,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','access-control-allow-origin':'*','access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'Content-Type, Accept'});res.end(body);}
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'Content-Type, Accept'});return res.end();}
 const u=new URL(req.url,'http://localhost');
 try {
  if(req.method==='GET'&&u.pathname==='/api/health')return send(res,200,{ok:true,service:'FiribStop live threat news',now:new Date().toISOString(),cacheMinutes:CACHE_MS/60000});
  if(req.method==='GET'&&u.pathname==='/api/news'){const d=await loadNews(u.searchParams.get('refresh')==='1');return send(res,200,{items:d.items,sources:d.sources,updatedAt:d.updatedAt,stale:Date.now()-d.fetchedAt>CACHE_MS});}
  if(req.method==='GET'&&u.pathname==='/api/analytics'){const d=await loadNews(false),categories={},sources={},months={};for(const n of d.items){categories[n.category]=(categories[n.category]||0)+1;sources[n.source]=(sources[n.source]||0)+1;if(n.date){const m=n.date.slice(0,7);months[m]=(months[m]||0)+1;}}return send(res,200,{total:d.items.length,important:d.items.filter(x=>x.important).length,categories,sources,months,updatedAt:d.updatedAt,method:'Статистика публикаций из RSS, не статистика всех кибератак.'});}
  if(req.method==='GET'&&u.pathname==='/api/attacks'){const d=await loadNews(false);return send(res,200,{items:d.items.filter(x=>/кибератак \/ инцидент|вредоносное ПО|утечка данных|фишинг|ransomware|уязвимости/i.test(x.category)),updatedAt:d.updatedAt,notice:'Это сообщения СМИ и бюллетени безопасности, не подтверждённый глобальный поток атак.'});}
  if(req.method==='GET'&&u.pathname==='/api/regions'){const g=await loadGeo();return send(res,200,g);}
  if(req.method==='GET'){
   let p=decodeURIComponent(u.pathname);if(p==='/')p='/index.html';const full=path.resolve(ROOT,'.'+p);if(!full.startsWith(ROOT+path.sep)&&full!==path.join(ROOT,'index.html'))return send(res,403,{error:'Forbidden'});
   fs.readFile(full,(err,data)=>{if(err)return send(res,404,{error:'Not found'});send(res,200,data,MIME[path.extname(full)]||'application/octet-stream');});return;
  }
  return send(res,405,{error:'Method not allowed'});
 }catch(e){return send(res,502,{error:e.message||'Upstream source unavailable',items:[],sources:[],updatedAt:newsCache.updatedAt||null});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`FiribStop server listening on ${PORT}`));
