/* Site editor: Analytics tab. Reads Umami Cloud (visits, events) and keeps a month-by-month archive in the GitHub repo. */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const SE=()=>window.__se;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const LS={get(k){try{return localStorage.getItem(k)??sessionStorage.getItem(k)}catch(e){return null}},
  set(k,v,keep){try{(keep?localStorage:sessionStorage).setItem(k,v);(keep?sessionStorage:localStorage).removeItem(k)}catch(e){}},
  del(k){try{localStorage.removeItem(k);sessionStorage.removeItem(k)}catch(e){}}};
const TZ=(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||"Asia/Kolkata"}catch(e){return "Asia/Kolkata"}})();
const nf=new Intl.NumberFormat("en-IN");
const fmt=n=>nf.format(Math.round(n||0));
const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const PAGE_LABEL={home:"Home page",finunity:"FinUnity",advisor:"Advisor platform",finguard:"FinGuard",agrifunds:"AgriFunds",aster:"Aster Bank",autolore:"AutoLore",guru:"Guru Samman Samaroh"};
const SECTION_LABEL={hero:"Intro (top of page)",work:"Work",about:"About",testimonials:"What others say",quote:"Quote",contact:"Let’s connect",intro:"Intro (top of page)"};
const pageName=p=>PAGE_LABEL[p]||p;
const secName=s=>SECTION_LABEL[s]||s.replace(/-/g," ").replace(/^./,c=>c.toUpperCase());
const targetName=t=>{
  const m=t.match(/^(img|card|h1|h2|h3|li|div|span|p|figure|svg|section|a|button)-(.*)$/);
  if(!m) return t.replace(/-/g," ");
  const kind={img:"Image",card:"Work card",h1:"Heading",h2:"Heading",h3:"Heading",li:"List item",figure:"Figure",svg:"Graphic",a:"Link",button:"Button"}[m[1]]||"Text";
  return kind+": "+m[2].replace(/-/g," ");
};

let st={site:"",key:"",clarity:"",period:"30d",metric:"visitors",data:null,loading:false,archive:null,archiveSha:null,archiveDone:false};

/* ---------- Umami API ---------- */
async function um(path,params){
  const qs=new URLSearchParams(params||{}).toString();
  let r;
  try{ r=await fetch(`https://api.umami.is/v1/websites/${encodeURIComponent(st.site)}${path}${qs?"?"+qs:""}`,{headers:{"x-umami-api-key":st.key,Accept:"application/json"},cache:"no-store"}) }
  catch(e){ const err=new Error("NETWORK"); err.network=true; throw err }
  if(!r.ok){ let m=""; try{m=(await r.json()).error||""}catch(e){} const err=new Error(m||("Umami error "+r.status)); err.status=r.status; throw err }
  return r.json();
}
const val=(o,k)=>{const v=o?o[k]:0; return typeof v==="object"&&v?(+v.value||0):(+v||0)};
const prevVal=(o,k)=>{const v=o?o[k]:0; if(typeof v==="object"&&v&&"prev" in v) return +v.prev||0; if(o&&o.comparison&&k in o.comparison) return +o.comparison[k]||0; return null};
async function metrics(type,range,limit){
  try{ return await um("/metrics",{...range,type,limit:limit||50,timezone:TZ}) }
  catch(e){ if(type==="path"&&e.status&&e.status<500) return um("/metrics",{...range,type:"url",limit:limit||50,timezone:TZ}); throw e }
}

/* ---------- Periods ---------- */
function startOfDay(d){d=new Date(d); d.setHours(0,0,0,0); return d}
function period(p){
  const now=new Date(), end=now.getTime();
  let start, unit="day", label;
  if(p==="today"){start=startOfDay(now).getTime(); unit="hour"; label="Today"}
  else if(p==="7d"){start=startOfDay(now).getTime()-6*864e5; label="Last 7 days"}
  else if(p==="30d"){start=startOfDay(now).getTime()-29*864e5; label="Last 30 days"}
  else if(p==="month"){start=new Date(now.getFullYear(),now.getMonth(),1).getTime(); label="This month"}
  else if(p==="6m"){start=new Date(now.getFullYear(),now.getMonth()-5,1).getTime(); unit="month"; label="Last 6 months"}
  else if(p==="year"){start=new Date(now.getFullYear(),0,1).getTime(); unit="month"; label="This year"}
  else {start=new Date(2026,0,1).getTime(); unit="month"; label="All time"}
  /* Umami's free plan keeps 6 months; older months come from the archive */
  const keep=new Date(now.getFullYear(),now.getMonth()-5,1).getTime();
  const liveStart=Math.max(start,keep);
  return {startAt:liveStart,endAt:end,unit,label,fullStart:start,usesArchive:start<keep,len:end-liveStart};
}

/* ---------- Archive (analytics-archive.json in the repo) ---------- */
async function loadArchive(){
  if(st.archive) return st.archive;
  try{ const f=await SE().getFile("analytics-archive.json",true); if(f){ st.archiveSha=f.sha; st.archive=JSON.parse(f.text||"{}") } }catch(e){}
  if(!st.archive||!st.archive.months) st.archive={note:"Monthly visitor totals saved by the site editor, so history outlasts Umami's 6-month free plan.",months:{}};
  return st.archive;
}
async function updateArchive(){
  if(st.archiveDone) return; st.archiveDone=true;
  const A=await loadArchive(), now=new Date(); let changed=false;
  for(let i=5;i>=0;i--){
    const s=new Date(now.getFullYear(),now.getMonth()-i,1), e=new Date(now.getFullYear(),now.getMonth()-i+1,1);
    const key=s.getFullYear()+"-"+String(s.getMonth()+1).padStart(2,"0");
    try{
      const r=await um("/stats",{startAt:s.getTime(),endAt:Math.min(e.getTime()-1,Date.now())});
      const rec={visitors:val(r,"visitors"),visits:val(r,"visits"),pageviews:val(r,"pageviews")};
      const old=A.months[key];
      if(i===5&&old&&old.visitors>rec.visitors) continue; /* oldest month may already be partly expired at Umami: keep the saved figure */
      if(!old||old.visitors!==rec.visitors||old.visits!==rec.visits||old.pageviews!==rec.pageviews){ if(rec.visitors||rec.pageviews||old){ A.months[key]=rec; changed=true } }
    }catch(e){ return }
  }
  if(changed){
    A.updated=new Date().toISOString();
    const json=JSON.stringify(A,null,2)+"\n";
    try{ st.archiveSha=await SE().putFile("analytics-archive.json",SE().b64(json),st.archiveSha,"Site editor: save monthly visitor totals") }catch(e){}
  }
}

/* ---------- Load data ---------- */
async function load(){
  const body=$("#anBody"); if(!st.site||!st.key){ renderSetup(); return }
  st.loading=true; body.innerHTML='<p class="an-hint">Loading visitor data…</p>';
  const P=period(st.period), range={startAt:P.startAt,endAt:P.endAt};
  const prevRange={startAt:P.startAt-(P.endAt-P.startAt),endAt:P.startAt-1};
  try{
    const [stats,series,events,pages,refs,countries,devices,browsers]=await Promise.all([
      um("/stats",range), um("/pageviews",{...range,unit:P.unit,timezone:TZ}),
      metrics("event",range,500), metrics("path",range,20), metrics("referrer",range,10),
      metrics("country",range,10), metrics("device",range,6), metrics("browser",range,6)
    ]);
    let prev=null; if(st.period!=="year"&&st.period!=="all"){ try{ prev=await um("/stats",prevRange) }catch(e){} }
    const D0=st.data={P,stats,prev,series,events:events||[],pages:pages||[],refs:refs||[],countries:countries||[],devices:devices||[],browsers:browsers||[]};
    render();
    updateArchive().then(()=>{ if(st.data===D0) render() });
  }catch(err){
    body.innerHTML=err.network
      ?`<div class="msg err">Your browser couldn’t reach Umami’s data service from this page. Open your full Umami dashboard instead: <a href="https://cloud.umami.is/websites/${encodeURIComponent(st.site)}" target="_blank" rel="noopener">cloud.umami.is</a>. Recordings and heatmaps are in <a href="${clarityUrl()}" target="_blank" rel="noopener">Microsoft Clarity</a>.</div>`
      :err.status===401||err.status===403?`<div class="msg err">Umami did not accept the API key. Check it in Setup (gear button).</div>`
      :err.status===404?`<div class="msg err">Umami can’t find that website ID. Check it in Setup (gear button).</div>`
      :`<div class="msg err">Could not load visitor data: ${esc(err.message)}</div>`;
  }finally{ st.loading=false }
}
const clarityUrl=()=>st.clarity?`https://clarity.microsoft.com/projects/view/${encodeURIComponent(st.clarity)}/dashboard`:"https://clarity.microsoft.com/";

/* ---------- Events → groups ---------- */
function group(events){
  const G={see:{},top:{},depth:{},open:{},pass:{},gate:{},rage:{},dead:{},bounce:{},error:{},contact:{},about:{},other:{},out:{}};
  let resume=0, loadMore=0, theme=0, a11y=0;
  for(const e of events){
    const n=String(e.x||""), y=+e.y||0, p=n.split(":");
    switch(p[0]){
      case "see": case "top": (G[p[0]][p[1]]=G[p[0]][p[1]]||{})[p[2]]=((G[p[0]][p[1]]||{})[p[2]]||0)+y; break;
      case "depth": (G.depth[p[1]]=G.depth[p[1]]||{})[p[2]]=y; break;
      case "open": G.open[p[1]]=(G.open[p[1]]||0)+y; break;
      case "pass": case "gate": (G[p[0]][p[2]]=G[p[0]][p[2]]||{})[p[1]]=((G[p[0]][p[2]]||{})[p[1]]||0)+y; break;
      case "rage": case "dead": G[p[0]][p[1]+":"+p.slice(2).join(":")]=(G[p[0]][p[1]+":"+p.slice(2).join(":")]||0)+y; break;
      case "bounce": case "error": G[p[0]][p[1]]=(G[p[0]][p[1]]||0)+y; break;
      case "contact": G.contact[p[1]]=(G.contact[p[1]]||0)+y; break;
      case "about": G.about[p[1]]=(G.about[p[1]]||0)+y; break;
      case "out": G.out[p.slice(1).join(":")]=(G.out[p.slice(1).join(":")]||0)+y; break;
      case "resume": resume+=y; break;
      case "work": loadMore+=y; break;
      case "theme": theme+=y; break;
      case "a11y": a11y+=y; break;
      default: G.other[n]=(G.other[n]||0)+y;
    }
  }
  return {...G,resume,loadMore,theme,a11y};
}

/* ---------- Rendering ---------- */
function bars(rows,opts={}){
  /* rows: [[label, value, note?]] → horizontal bars (one colour, value labels in text ink) */
  if(!rows.length) return `<p class="an-empty">${opts.empty||"Nothing recorded in this period."}</p>`;
  const max=Math.max(...rows.map(r=>r[1]),1);
  return `<table class="an-bars"><tbody>${rows.map(r=>`<tr><th scope="row">${esc(r[0])}${r[2]?`<small>${esc(r[2])}</small>`:""}</th><td><span class="bar" style="width:${Math.max(2,r[1]/max*100)}%"></span></td><td class="num">${fmt(r[1])}</td></tr>`).join("")}</tbody></table>`;
}
function kpi(label,v,p,fmtFn,help,lowerIsBetter){
  let ch="";
  if(p!=null&&p>0){ const d=(v-p)/p*100; if(Math.abs(d)>=0.5){ ch=`<span class="an-ch">${d>0?"▲":"▼"} ${Math.abs(d).toFixed(0)}% <span>vs previous period</span></span>` } else ch=`<span class="an-ch">No change <span>vs previous period</span></span>` }
  else if(p===0&&v>0) ch=`<span class="an-ch">New <span>(none in previous period)</span></span>`;
  return `<div class="an-kpi"><div class="l">${label}</div><div class="v">${fmtFn(v)}</div>${ch}${help?`<div class="h">${help}</div>`:""}</div>`;
}
function chart(points,unit){
  /* points: [{t:Date,y}] single series bar chart with hover tooltip */
  if(!points.length) return '<p class="an-empty">No visits recorded in this period yet.</p>';
  const W=Math.max(320,Math.min(1100,(($("#anBody")||{}).clientWidth||800)-40)),H=W<500?200:230,pl=40,pr=8,pt=10,pb=26, iw=W-pl-pr, ih=H-pt-pb;
  const max=Math.max(...points.map(p=>p.y),1);
  const step=(()=>{const raw=max/4, e=Math.pow(10,Math.floor(Math.log10(raw))), f=raw/e; return Math.max(1,(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*e)})();
  const ticks=Math.ceil(max/step), nice=step*ticks;
  const bw=iw/points.length, gap=Math.min(2+bw*0.18,10);
  const lbl=d=>unit==="month"?MONTHS[d.getMonth()]+(points.length>12?" "+String(d.getFullYear()).slice(2):""):unit==="hour"?String(d.getHours()).padStart(2,"0")+":00":d.getDate()+" "+MONTHS[d.getMonth()];
  const every=Math.ceil(points.length/(unit==="month"?12:8));
  let g="";
  for(let i=0;i<=ticks;i++){ const v=step*i, y=pt+ih-ih*v/nice; g+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" class="grid"/><text x="${pl-6}" y="${y+4}" class="ax" text-anchor="end">${fmt(v)}</text>` }
  points.forEach((p,i)=>{
    const h=Math.max(p.y?2:0,ih*p.y/nice), x=pl+i*bw+gap/2, w=Math.max(1,bw-gap), y=pt+ih-h, r=Math.min(4,w/2,h);
    const tip=`${lbl(p.t)}${unit==="day"?" "+p.t.getFullYear():""}: ${fmt(p.y)} ${st.metric==="visitors"?"visitors":"page views"}`;
    g+=`<g class="col" data-tip="${esc(tip)}"><rect class="hit" x="${pl+i*bw}" y="${pt}" width="${bw}" height="${ih}"/>`+
      (h>0?`<path class="b" d="M${x},${y+h}V${y+r}Q${x},${y} ${x+r},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+h}Z"/>`:"")+`</g>`;
    if(i%every===0) g+=`<text x="${pl+i*bw+bw/2}" y="${H-8}" class="ax" text-anchor="middle">${lbl(p.t)}</text>`;
  });
  g+=`<line x1="${pl}" x2="${W-pr}" y1="${pt+ih}" y2="${pt+ih}" class="base"/>`;
  return `<div class="an-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${st.metric==="visitors"?"Visitors":"Page views"} over time">${g}</svg><div class="an-tip" hidden></div></div>`;
}
function toPoints(series,P){
  const arr=(st.metric==="visitors"?(series.sessions||series.visitors||[]):(series.pageviews||[]));
  const map=new Map(arr.map(o=>[keyOf(new Date(String(o.x).replace(" ","T")),P.unit),+o.y||0]));
  const pts=[], s=new Date(P.startAt), e=new Date(P.endAt);
  if(P.unit==="hour"){ for(let h=0;h<=e.getHours();h++){ const d=new Date(s); d.setHours(h); pts.push({t:d,y:map.get(keyOf(d,"hour"))||0}) } }
  else if(P.unit==="day"){ for(let d=new Date(s);d<=e;d=new Date(d.getTime()+864e5)) pts.push({t:new Date(d),y:map.get(keyOf(d,"day"))||0}) }
  else { for(let d=new Date(s.getFullYear(),s.getMonth(),1);d<=e;d=new Date(d.getFullYear(),d.getMonth()+1,1)) pts.push({t:d,y:map.get(keyOf(d,"month"))||0}) }
  return pts;
}
function keyOf(d,u){ return u==="hour"?d.toDateString()+d.getHours():u==="day"?d.toDateString():d.getFullYear()+"-"+d.getMonth() }
function monthPointsFromArchive(P){
  const A=st.archive&&st.archive.months||{}, pts=[], now=new Date();
  const s=new Date(P.fullStart); let first=new Date(s.getFullYear(),s.getMonth(),1);
  if(st.period==="all"){ const keys=Object.keys(A).sort(); if(keys[0]){ const [y,m]=keys[0].split("-").map(Number); first=new Date(y,m-1,1) } else first=new Date(now.getFullYear(),now.getMonth()-5,1) }
  for(let d=first; d<=now; d=new Date(d.getFullYear(),d.getMonth()+1,1)){
    const k=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"), r=A[k];
    pts.push({t:d,y:r?(st.metric==="visitors"?r.visitors:r.pageviews):0});
  }
  return pts;
}

function render(){
  const D=st.data; if(!D) return;
  const P=D.P, S=D.stats, G=group(D.events);
  const visitors=val(S,"visitors"), visits=val(S,"visits")||visitors, pv=val(S,"pageviews"), bounces=val(S,"bounces"), tt=val(S,"totaltime");
  const archiveMode=st.period==="year"||st.period==="all";
  const pr=k=>archiveMode?null:(D.prev?val(D.prev,k):prevVal(S,k));
  const since=archiveMode?new Date(P.startAt).toLocaleDateString("en-IN",{month:"short",year:"numeric"})+" onwards":null;
  const avg=visits?tt/visits:0, br=visits?bounces/visits*100:0;
  const fmtT=s=>{s=Math.round(s); return s<60?s+"s":Math.floor(s/60)+"m "+String(s%60).padStart(2,"0")+"s"};
  let pts=archiveMode?monthPointsFromArchive(P):toPoints(D.series,P);
  if(archiveMode){ /* live data wins for months Umami still holds */
    const live=toPoints(D.series,P); const lm=new Map(live.map(p=>[keyOf(p.t,"month"),p.y]));
    pts=pts.map(p=>lm.has(keyOf(p.t,"month"))?{t:p.t,y:lm.get(keyOf(p.t,"month"))}:p);
  }
  const yearTotal=archiveMode?pts.reduce((a,p)=>a+p.y,0):null;

  /* Interest */
  const homeSeen=G.see.home||{}, order=["hero","work","about","testimonials","quote","contact"];
  const seenRows=order.filter(k=>homeSeen[k]!=null).map(k=>[secName(k),homeSeen[k]]);
  const topRows=Object.entries(G.top.home||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[secName(k),v]);
  const cases=Object.keys(PAGE_LABEL).filter(k=>k!=="home");
  const caseRows=cases.map(c=>{const pa=G.pass[c]||{}, ga=G.gate[c]||{}; return {c,open:G.open[c]||0,ok:(pa.ok||0)+(ga.ok||0),wrong:(pa.wrong||0)+(ga.wrong||0),req:(pa.request||0)+(ga.request||0),cancel:pa.cancel||0,seen:Object.values(G.see[c]||{}).reduce((a,b)=>a+b,0),top:Object.entries(G.top[c]||{}).sort((a,b)=>b[1]-a[1])[0]}}).filter(r=>r.open||r.ok||r.wrong||r.req||r.seen);
  caseRows.sort((a,b)=>(b.open+b.ok)-(a.open+a.ok));

  /* Confusion */
  const stuck=[];
  Object.entries(G.rage).forEach(([k,v])=>{const [pg,...t]=k.split(":"); stuck.push({w:v*3,html:`<b>${fmt(v)}×</b> rage clicks on <b>${esc(targetName(t.join(":")))}</b> <span>(${esc(pageName(pg))})</span>`,why:"Clicked again and again in the same spot: they expected something to happen."})});
  Object.entries(G.dead).forEach(([k,v])=>{const [pg,...t]=k.split(":"); stuck.push({w:v*2,html:`<b>${fmt(v)}×</b> clicks that did nothing on <b>${esc(targetName(t.join(":")))}</b> <span>(${esc(pageName(pg))})</span>`,why:"It looks clickable but isn’t. Consider making it a link or making it look less like one."})});
  const wrong=caseRows.reduce((a,r)=>a+r.wrong,0), cancels=caseRows.reduce((a,r)=>a+r.cancel,0);
  if(wrong) stuck.push({w:wrong,html:`<b>${fmt(wrong)}</b> wrong case-study passwords`,why:"Visitors tried to open a case study without the right password."});
  if(cancels) stuck.push({w:cancels,html:`<b>${fmt(cancels)}</b> closed the password popup without entering`,why:"They wanted the case study but didn’t have the password."});
  Object.entries(G.bounce).forEach(([pg,v])=>stuck.push({w:v,html:`<b>${fmt(v)}</b> left <b>${esc(pageName(pg))}</b> within 8 seconds without scrolling or clicking`,why:"Quick exits: the first screen didn’t hold them."}));
  Object.entries(G.error).forEach(([pg,v])=>stuck.push({w:v*2,html:`<b>${fmt(v)}</b> script errors on <b>${esc(pageName(pg))}</b>`,why:"Something on the page broke for these visitors. Tell Claude which page."}));
  stuck.sort((a,b)=>b.w-a.w);

  /* Depth */
  const depthRows=Object.entries(G.depth).map(([pg,d])=>{const base=d["25"]||Math.max(...Object.values(d),1); return {pg,base,d}}).sort((a,b)=>b.base-a.base);

  const actions=[["Downloaded resume",G.resume],["Clicked “Get in touch”",G.contact["get-in-touch"]||0],["Clicked the email address",G.contact.email||0],["Copied the email address",G.contact["email-copy"]||0],["Opened LinkedIn",G.contact.linkedin||0],
    ["Asked for a case-study password",caseRows.reduce((a,r)=>a+r.req,0)],["Clicked “Load more work”",G.loadMore],["Switched light/dark theme",G.theme],["Opened accessibility options",G.a11y]].filter(r=>r[1]>0).sort((a,b)=>b[1]-a[1]);
  const TAB={"about-me":"About me","what-i-do":"What I do","how-i-work":"How I work","industries-and-regions":"Industries & regions"};
  const tabs=Object.entries(G.about).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[TAB[k]||k.replace(/-/g," ").replace(/^./,c=>c.toUpperCase()),v]);
  const out=Object.entries(G.out).sort((a,b)=>b[1]-a[1]).slice(0,8);

  const dn=(()=>{try{return new Intl.DisplayNames(["en"],{type:"region"})}catch(e){return null}})();
  const country=c=>{try{return dn&&c?dn.of(String(c).toUpperCase()):c}catch(e){return c}};
  const pagesRows=D.pages.map(p=>{const u=String(p.x||""); const m=u.match(/\/case\/([a-z0-9-]+)/); return [u==="/"||/home/.test(u)?"Home page":m?"Case study: "+pageName(m[1]):u,+p.y||0]});
  const refRows=D.refs.map(r=>[String(r.x||"").replace(/^https?:\/\//,"").replace(/^www\./,"")||"Direct / unknown",+r.y||0]);

  $("#anBody").innerHTML=`
  ${P.usesArchive?`<p class="an-note">Umami’s free plan keeps detail for 6 months. Visitor totals before that come from the monthly archive saved in your repository; the breakdowns below cover ${esc(new Date(P.startAt).toLocaleDateString("en-IN",{month:"short",year:"numeric"}))} onwards.</p>`:""}
  <div class="an-kpis">
    ${archiveMode?kpi(st.metric==="visitors"?"Visitors (months added up)":"Page views",yearTotal,null,fmt,st.period==="year"?"This calendar year":"Since tracking started"):kpi("Visitors",visitors,pr("visitors"),fmt,"Different people")}
    ${kpi("Visits",visits,pr("visits"),fmt,since||"Separate trips to the site")}
    ${kpi("Page views",pv,pr("pageviews"),fmt,since||"Home and case-study pages opened")}
    ${kpi("Avg. time per visit",avg,!archiveMode&&D.prev&&val(D.prev,"visits")?val(D.prev,"totaltime")/val(D.prev,"visits"):null,fmtT,since||"How long a visit lasts")}
    ${kpi("Left after one page",br,!archiveMode&&D.prev&&val(D.prev,"visits")?val(D.prev,"bounces")/val(D.prev,"visits")*100:null,v=>Math.round(v)+"%",since?since+" · lower is better":"Bounce rate: lower is better")}
  </div>

  <section class="an-card wide">
    <div class="an-head"><h3>${st.metric==="visitors"?"Visitors":"Page views"} ${P.unit==="hour"?"by hour":P.unit==="day"?"by day":"by month"}</h3>
      <div class="seg small" role="group" aria-label="Measure"><button type="button" data-metric="visitors" aria-pressed="${st.metric==="visitors"}">Visitors</button><button type="button" data-metric="pageviews" aria-pressed="${st.metric==="pageviews"}">Page views</button></div></div>
    ${chart(pts,archiveMode?"month":P.unit)}
  </section>

  <div class="an-grid">
    <section class="an-card"><h3>What they read on the home page</h3><p class="an-sub">Visits where each section stayed on screen for at least 1.5 seconds.</p>${bars(seenRows)}
      ${topRows.length?`<h4>Section read the longest</h4><p class="an-sub">Per visit, the section they spent the most time on.</p>${bars(topRows)}`:""}</section>

    <section class="an-card"><h3>Where they get stuck</h3><p class="an-sub">Signs of confusion, most important first.</p>
      ${stuck.length?`<ul class="an-stuck">${stuck.slice(0,10).map(s=>`<li>${s.html}<small>${esc(s.why)}</small></li>`).join("")}</ul>`:`<p class="an-empty">No signs of confusion in this period.</p>`}
      <p class="an-link"><a href="${clarityUrl()}" target="_blank" rel="noopener">Watch recordings and heatmaps in Microsoft Clarity ↗</a></p></section>

    <section class="an-card wide"><h3>Case studies</h3><p class="an-sub">Opened = clicked a card or menu item. Unlocked = entered the right password.</p>
      ${caseRows.length?`<div class="an-scroll"><table class="an-table"><thead><tr><th scope="col">Case study</th><th scope="col">Opened</th><th scope="col">Unlocked</th><th scope="col">Wrong password</th><th scope="col">Asked for password</th><th scope="col">Read most</th></tr></thead><tbody>
      ${caseRows.map(r=>`<tr><th scope="row">${esc(pageName(r.c))}</th><td>${fmt(r.open)}</td><td>${fmt(r.ok)}</td><td>${fmt(r.wrong)}</td><td>${fmt(r.req)}</td><td>${r.top?esc(secName(r.top[0])):"–"}</td></tr>`).join("")}</tbody></table></div>`:`<p class="an-empty">No case-study activity in this period.</p>`}</section>

    <section class="an-card"><h3>How far they scroll</h3><p class="an-sub">Of the visits that scrolled at least a quarter of each page, how many reached each point.</p>
      ${depthRows.length?depthRows.slice(0,6).map(r=>`<h4>${esc(pageName(r.pg))} <small>(${fmt(r.base)} visits)</small></h4>${bars(["25","50","75","100"].map(k=>[k+"% of the page",Math.round((r.d[k]||0)/r.base*100)]).filter(x=>x[1]>0)).replace(/(<td class="num">)([\d,]+)/g,"$1$2%")}`).join(""):`<p class="an-empty">No scrolling recorded yet.</p>`}</section>

    <section class="an-card"><h3>What they did</h3>${bars(actions,{empty:"No clicks on contact, resume or other actions in this period."})}
      ${tabs.length?`<h4>About tabs opened</h4>${bars(tabs)}`:""}
      ${out.length?`<h4>Links to other sites</h4>${bars(out)}`:""}</section>

    <section class="an-card"><h3>Pages</h3>${bars(pagesRows)}</section>
    <section class="an-card"><h3>Where they came from</h3>${bars(refRows,{empty:"No referring sites yet (direct visits only)."})}</section>
    <section class="an-card"><h3>Countries</h3>${bars(D.countries.map(c=>[country(c.x)||"Unknown",+c.y||0]))}</section>
    <section class="an-card"><h3>Devices and browsers</h3>${bars(D.devices.map(c=>[String(c.x||"Unknown").replace(/^./,m=>m.toUpperCase()),+c.y||0]))}<h4>Browsers</h4>${bars(D.browsers.map(c=>[String(c.x||"Unknown").replace(/^./,m=>m.toUpperCase()).replace(/^Ios$/,"iOS"),+c.y||0]))}</section>

    <section class="an-card wide"><h3>Year by year</h3><p class="an-sub">Visitors per month, from the archive this panel saves to your repository each time you open it.</p>${yearTable()}</section>
  </div>`;
  wireChart();
}
function yearTable(){
  const A=st.archive&&st.archive.months||{}; const years=[...new Set(Object.keys(A).map(k=>k.slice(0,4)))].sort().reverse();
  if(!years.length) return '<p class="an-empty">The archive starts filling in the first time this panel loads data.</p>';
  return `<div class="an-scroll"><table class="an-table"><thead><tr><th scope="col">Year</th>${MONTHS.map(m=>`<th scope="col">${m}</th>`).join("")}<th scope="col">Total</th></tr></thead><tbody>${years.map(y=>{let t=0; const cells=MONTHS.map((m,i)=>{const r=A[y+"-"+String(i+1).padStart(2,"0")]; if(r) t+=r.visitors; return `<td>${r?fmt(r.visitors):"–"}</td>`}).join(""); return `<tr><th scope="row">${y}</th>${cells}<td><b>${fmt(t)}</b></td></tr>`}).join("")}</tbody></table></div>`;
}
function wireChart(){
  const box=document.querySelector(".an-chart"); if(!box) return; const tip=box.querySelector(".an-tip");
  box.querySelectorAll(".col").forEach(g=>{
    const show=e=>{ tip.textContent=g.dataset.tip; tip.hidden=false; const r=box.getBoundingClientRect(), gr=g.getBoundingClientRect(); tip.style.left=Math.min(Math.max(0,gr.left-r.left+gr.width/2-tip.offsetWidth/2),r.width-tip.offsetWidth)+"px"; const b=g.querySelector(".b"); const top=b?b.getBoundingClientRect().top-r.top:r.height*0.8; tip.style.top=Math.max(tip.offsetHeight+4,top-6)+"px"; g.classList.add("on") };
    const hide=()=>{ tip.hidden=true; g.classList.remove("on") };
    g.addEventListener("mouseenter",show); g.addEventListener("mouseleave",hide); g.addEventListener("click",show);
  });
}

/* ---------- Setup ---------- */
function renderSetup(msg){
  const C=window.__seAnalyticsConfig||{};
  $("#anBody").innerHTML=`<section class="an-card setup"><h3>Connect your analytics</h3>
    <p class="an-sub">Free services count your visitors: <b>Umami</b> (visits and what people click) and <b>Microsoft Clarity</b> (recordings and heatmaps). Create both accounts once, then fill in the boxes below.</p>
    ${msg?`<div class="msg ${msg.ok?"ok":"err"}">${esc(msg.t)}</div>`:""}
    <label for="anSite">Umami website ID</label><input type="text" id="anSite" value="${esc(st.site||C.umamiWebsiteId||"")}" placeholder="e.g. 3c255b6d-678a-42dd-8074-272ee5b78484" spellcheck="false">
    <label for="anKey">Umami API key (for this dashboard)</label><input type="password" id="anKey" value="${esc(st.key)}" placeholder="From Umami: Settings → API keys" spellcheck="false">
    <p class="an-hint">The API key stays in this browser only; it is never saved to your site.</p>
    <label for="anClar">Microsoft Clarity project ID</label><input type="text" id="anClar" value="${esc(st.clarity||C.clarityProjectId||"")}" placeholder="e.g. abcd1234ef" spellcheck="false">
    <label class="check" style="margin-top:1rem"><input type="checkbox" id="anRemember" ${LS.get("se-umami-key")&&(()=>{try{return !!localStorage.getItem("se-umami-key")}catch(e){return false}})()?"checked":""}> <span style="font-weight:500">Remember the API key on this computer</span></label>
    <label class="check"><input type="checkbox" id="anMe" ${noTrack()?"checked":""}> <span style="font-weight:500">Don’t count my own visits from this browser</span></label>
    <p style="margin:1.1rem 0 0;display:flex;gap:.6rem;flex-wrap:wrap"><button class="btn primary" type="button" id="anSave">Save and turn on tracking</button>${st.site&&st.key?'<button class="btn" type="button" id="anBack">Back to dashboard</button>':""}</p>
    <p class="an-hint">“Save” writes the two IDs into <code>analytics-config.js</code> on your site (through GitHub), so tracking starts on the live site about a minute later.</p>
    <details class="help"><summary>Step by step: get the IDs</summary><ol>
      <li>Go to <b>cloud.umami.is/signup</b> and sign up (free Hobby plan). Choose the data region nearest your visitors.</li>
      <li>Click <b>Add website</b>: name “Sanjay Pal portfolio”, domain <b>sanjaypal.online</b>. Save.</li>
      <li>Open the website’s <b>Edit</b> page and copy the <b>Website ID</b> into the first box.</li>
      <li>In Umami, open <b>Settings → API keys</b> (under your account), click <b>Create key</b>, reveal it and copy it into the second box.</li>
      <li>Go to <b>clarity.microsoft.com</b>, sign in (Microsoft, Google or Facebook account) and click <b>New project</b>: name “Sanjay Pal portfolio”, website <b>https://sanjaypal.online</b>.</li>
      <li>When Clarity shows the install choices, pick <b>Install manually</b>, and copy the 10-character code after <code>clarity.ms/tag/</code> (or from Settings → Overview → Project ID) into the third box.</li>
      <li>Click <b>Save and turn on tracking</b>.</li></ol></details>
  </section>`;
  $("#anSave").onclick=saveSetup; if($("#anBack")) $("#anBack").onclick=()=>load();
}
function noTrack(){ try{ return localStorage.getItem("sp-no-track")==="1" }catch(e){ return false } }
function setNoTrack(on){ try{ if(on){ localStorage.setItem("sp-no-track","1"); localStorage.setItem("umami.disabled","1") } else { localStorage.removeItem("sp-no-track"); localStorage.removeItem("umami.disabled") } }catch(e){} }
async function saveSetup(){
  const site=$("#anSite").value.trim(), key=$("#anKey").value.trim(), clar=$("#anClar").value.trim();
  if(site && !/^[0-9a-f-]{20,}$/i.test(site)) return renderSetup({t:"That website ID doesn’t look right. It is a long code of letters, numbers and dashes from Umami."});
  if(clar && !/^[a-z0-9]{6,20}$/i.test(clar)) return renderSetup({t:"That Clarity project ID doesn’t look right. It is a short code of letters and numbers."});
  setNoTrack($("#anMe").checked);
  st.site=site; st.key=key; st.clarity=clar;
  LS.set("se-umami-site",site,true); LS.set("se-clarity",clar,true);
  if(key) LS.set("se-umami-key",key,$("#anRemember").checked); else LS.del("se-umami-key");
  const btn=$("#anSave"); btn.disabled=true; btn.textContent="Saving…";
  try{
    const f=await SE().getFile("analytics-config.js",true);
    const js=`/* Visitor analytics settings. Filled in from the admin panel (Analytics → Setup). Leave empty to switch tracking off. */\nwindow.SP_ANALYTICS = {\n  umamiWebsiteId: ${JSON.stringify(site)},\n  clarityProjectId: ${JSON.stringify(clar)}\n};\n`;
    if(!f||f.text!==js) await SE().putFile("analytics-config.js",SE().b64(js),f&&f.sha,"Site editor: analytics settings");
    window.__seAnalyticsConfig={umamiWebsiteId:site,clarityProjectId:clar};
    const has=await SE().getFile("analytics.js",true);
    if(!has) return renderSetup({t:"Saved. But analytics.js is missing from your repository: upload it from the latest zip so tracking can run."});
    if(site&&key) load(); else renderSetup({ok:true,t:"Saved. Tracking is on. Add the Umami API key to see the dashboard here."});
  }catch(err){ renderSetup({t:"Could not save to GitHub: "+err.message}) }
}

/* ---------- Mount ---------- */
window.__seAnalytics={
  open(){
    st.site=st.site||LS.get("se-umami-site")||""; st.key=st.key||LS.get("se-umami-key")||""; st.clarity=st.clarity||LS.get("se-clarity")||"";
    if(!LS.get("se-an-init")){ setNoTrack(true); LS.set("se-an-init","1",true) } /* the site owner's own visits aren't counted by default */
    (async()=>{
      if(!st.site){ try{ const f=await SE().getFile("analytics-config.js",true); const m=f&&f.text.match(/umamiWebsiteId:\s*"([^"]*)"[\s\S]*?clarityProjectId:\s*"([^"]*)"/); if(m){ st.site=m[1]; st.clarity=st.clarity||m[2]; window.__seAnalyticsConfig={umamiWebsiteId:m[1],clarityProjectId:m[2]} } }catch(e){} }
      await loadArchive();
      if(!st.site||!st.key) renderSetup(); else if(!st.data) load(); else render();
    })();
  }
};
document.addEventListener("click",e=>{
  const p=e.target.closest("#anPeriods button[data-p]"); if(p){ st.period=p.dataset.p; document.querySelectorAll("#anPeriods button").forEach(b=>b.setAttribute("aria-pressed",String(b===p))); load(); return }
  const m=e.target.closest("button[data-metric]"); if(m){ st.metric=m.dataset.metric; render(); return }
  if(e.target.closest("#anRefresh")){ st.data=null; load(); return }
  if(e.target.closest("#anSetup")){ renderSetup(); return }
});
})();
