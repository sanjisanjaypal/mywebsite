/* Sanjay Pal portfolio: visitor analytics.
   - Umami (cookieless) counts visits and the events below; read in the admin panel's Analytics tab.
   - Microsoft Clarity records heatmaps and replays (consent asked for visitors in Europe).
   Event names are short codes, grouped by the admin dashboard:
     see:<page>:<section>   section was on screen for 1.5s      top:<page>:<section>  section read longest
     depth:<page>:<25..100> scrolled that far                    open:<case>          opened a case study
     pass:ok|wrong|cancel|request:<case>  password popup         gate:ok|wrong|request:<case> on a case page
     rage:<page>:<target>  3+ fast clicks on one spot            dead:<page>:<target> click on something that did nothing
     bounce:<page>         left within 8s without doing anything error:<page>        a script error
     resume:download, contact:*, about:<tab>, work:load-more, theme:toggle, a11y:open, out:<site>
*/
(function(){
  "use strict";
  var C = window.SP_ANALYTICS || {};
  var host = location.hostname;
  var live = /(^|\.)sanjaypal\.online$/i.test(host) || /\.github\.io$/i.test(host);
  var optedOut = false;
  try{ optedOut = localStorage.getItem("sp-no-track")==="1" || localStorage.getItem("umami.disabled")==="1" }catch(e){}
  var queue = [];
  var ready = false;
  window.spTrack = function(name){ if(!live || optedOut || !C.umamiWebsiteId || !name) return; name=String(name).slice(0,50); if(ready&&window.umami) { try{ window.umami.track(name) }catch(e){} } else queue.push(name) };
  if(!live || optedOut) return;

  /* ---------- Page name ---------- */
  var file = (location.pathname.split("/").pop() || "home.html").replace(/\.html$/,"");
  var page = file==="home"||file==="index"||file==="" ? "home" : file.replace(/^case-/,"");
  var isCase = /^case-/.test(file);
  var slug = function(s){ return String(s||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,22) };

  /* ---------- Umami ---------- */
  if(C.umamiWebsiteId){
    var s = document.createElement("script");
    s.defer = true; s.src = "https://cloud.umami.is/script.js";
    s.setAttribute("data-website-id", C.umamiWebsiteId);
    s.setAttribute("data-auto-track", "false");
    s.onload = function(){
      ready = true;
      /* Pages run inside the site frame, so the real referrer is the top page's */
      var ref = "";
      try{
        var first = !sessionStorage.getItem("sp-ref-done");
        if(first){ ref = (window.top!==window ? window.top.document.referrer : document.referrer) || ""; sessionStorage.setItem("sp-ref-done","1") }
        if(ref && new URL(ref).hostname===host) ref = "";
      }catch(e){}
      try{
        window.umami.track(function(p){ p.url = page==="home" ? "/" : "/case/"+page; p.referrer = ref; p.title = document.title; return p });
      }catch(e){}
      queue.splice(0).forEach(function(n){ try{ window.umami.track(n) }catch(e){} });
    };
    document.head.appendChild(s);
  }

  /* ---------- Microsoft Clarity (with consent for visitors in Europe) ---------- */
  if(C.clarityProjectId){
    (function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window,document,"clarity","script",C.clarityProjectId);
    try{ window.clarity("set","page",page) }catch(e){}
    var tz = ""; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "" }catch(e){}
    var europe = /^Europe\//.test(tz) || /^(Atlantic\/(Reykjavik|Canary|Madeira|Azores|Faroe))$/.test(tz);
    if(europe){
      var choice = null; try{ choice = localStorage.getItem("sp-consent") }catch(e){}
      var g = choice==="yes" ? "granted" : "denied";
      window.clarity("consentv2",{ad_Storage:"denied", analytics_Storage:g});
      if(!choice) document.addEventListener("DOMContentLoaded", showConsent);
      if(!choice && document.readyState!=="loading") showConsent();
    }
  }
  function showConsent(){
    if(document.getElementById("spConsent")) return;
    var b = document.createElement("div"); b.id="spConsent"; b.setAttribute("role","region"); b.setAttribute("aria-label","Cookie choice");
    b.innerHTML = '<p>This site uses a cookie from Microsoft Clarity to learn how visitors use it, so it can be improved. No advertising.</p>'+
      '<div><button type="button" data-c="yes">Allow</button><button type="button" data-c="no">No thanks</button></div>';
    var st = document.createElement("style");
    st.textContent = '#spConsent{position:fixed;left:max(16px,env(safe-area-inset-left,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:9000;max-width:min(420px,calc(100vw - 110px));'+
      'background:var(--surface,#fff);color:var(--ink,#13241A);border:1px solid var(--line,#D3D8CB);border-radius:16px;padding:.8rem 1rem;box-shadow:0 10px 30px rgba(0,0,0,.18);font:400 .88rem/1.45 "Instrument Sans",system-ui,sans-serif}'+
      '#spConsent p{margin:0 0 .6rem}#spConsent div{display:flex;gap:.5rem;flex-wrap:wrap}'+
      '#spConsent button{min-height:36px;padding:.3rem 1rem;border-radius:999px;border:1px solid var(--line,#D3D8CB);background:transparent;color:inherit;font:600 .85rem/1 inherit;cursor:pointer}'+
      '#spConsent button[data-c="yes"]{background:#4A1D7A;border-color:#4A1D7A;color:#fff}'+
      '#spConsent button:focus-visible{outline:3px solid #8B4FD0;outline-offset:2px}';
    b.appendChild(st);
    b.addEventListener("click",function(e){ var t=e.target.closest("button[data-c]"); if(!t) return;
      var yes = t.getAttribute("data-c")==="yes"; try{ localStorage.setItem("sp-consent", yes?"yes":"no") }catch(x){}
      window.clarity("consentv2",{ad_Storage:"denied", analytics_Storage: yes?"granted":"denied"}); b.remove(); });
    document.body.appendChild(b);
  }

  /* ---------- Events ---------- */
  var T = window.spTrack, interacted = false, t0 = Date.now();
  function desc(el){
    if(!el || el.nodeType!==1) return "page";
    var tag = el.tagName.toLowerCase();
    if(tag==="img"){ var src=(el.getAttribute("src")||"").split("/").pop().replace(/\.[a-z0-9]+$/i,""); return "img-"+slug(src||el.alt) }
    var card = el.closest(".case"); if(card){ var h=card.querySelector("h3"); return "card-"+slug(h?h.textContent:"work") }
    var lab = el.id || el.getAttribute("aria-label") || (el.textContent||"").trim().split(/\s+/).slice(0,4).join(" ") || (el.className&&String(el.className).split(" ")[0]) || tag;
    return tag+"-"+slug(lab);
  }

  document.addEventListener("click", function(e){
    interacted = true;
    var t = e.target, a = t.closest && t.closest("a[href]"), href = a ? a.getAttribute("href") : "";
    if(a){
      if(/^case-[a-z0-9-]+\.html/i.test(href)) T("open:"+href.replace(/^case-|\.html.*$/g,""));
      else if(/\.pdf(\?|#|$)/i.test(href)) T("resume:download");
      else if(/linkedin\.com/i.test(href)) T("contact:linkedin");
      else if(/^mailto:/i.test(href) && !a.matches("#csPassReq,#gateReq")) T("contact:email");
      else if(/#contact$/.test(href) || a.matches(".hdr-cta")) T("contact:get-in-touch");
      else if(/^https?:/i.test(href)){ try{ var u=new URL(href, location.href); if(u.hostname!==host) T("out:"+u.hostname.replace(/^www\./,"").slice(0,40)) }catch(x){} }
    }
    var b = t.closest && t.closest("button");
    if(b){
      if(b.id==="copyBtn") T("contact:email-copy");
      else if(b.id==="loadMore") T("work:load-more");
      else if(b.id==="themeBtn") T("theme:toggle");
      else if(b.id==="a11yBtn") T("a11y:open");
      else if(b.matches(".tab[role=tab]")) T("about:"+slug(b.textContent));
    }
  }, true);

  /* Rage clicks: 3+ clicks within 0.8s near the same spot */
  var clicks = [];
  document.addEventListener("click", function(e){
    var now = Date.now();
    clicks = clicks.filter(function(c){ return now-c.t<800 && Math.abs(c.x-e.clientX)<40 && Math.abs(c.y-e.clientY)<40 });
    clicks.push({t:now,x:e.clientX,y:e.clientY});
    if(clicks.length===3) T("rage:"+page+":"+desc(e.target));
  }, true);

  /* Dead clicks: a click on something that looks clickable (image, card, heading, chip, badge) where nothing happens */
  var INTERACTIVE = "a,button,input,select,textarea,label,summary,[role=button],[role=tab],[tabindex]:not([tabindex='-1']),[onclick],dialog";
  var LOOKS = "img,svg,.case,h1,h2,h3,.chip,li,[class*=badge],[class*=card],figure";
  document.addEventListener("click", function(e){
    var t = e.target; if(!t.closest || t.closest(INTERACTIVE) || !t.closest(LOOKS)) return;
    var el = t.closest(LOOKS), changed = false, y = scrollY, url = location.href;
    var mo = new MutationObserver(function(){ changed = true });
    mo.observe(document.body, {subtree:true, childList:true, attributes:true, characterData:true});
    setTimeout(function(){ mo.disconnect(); if(!changed && scrollY===y && location.href===url && document.visibilityState==="visible") T("dead:"+page+":"+desc(el)) }, 900);
  }, true);

  ["keydown","touchstart","wheel"].forEach(function(ev){ addEventListener(ev, function(){ interacted = true }, {passive:true, once:true}) });

  /* Sections seen, longest-read section, scroll depth */
  function ready2(fn){ if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", fn); else fn() }
  ready2(function(){
    var secs = [];
    if(isCase){ var h = document.querySelector(".cs-hero, header.cs-head, main > section:first-of-type"); if(h){ h.dataset.spSec = "intro"; secs.push(h) } document.querySelectorAll("section.cs-sec[id]").forEach(function(s){ s.dataset.spSec=s.id; secs.push(s) }) }
    else { var hero = document.querySelector(".hero-layout"); if(hero){ hero.dataset.spSec="hero"; secs.push(hero) } ["work","about","testimonials","quote","contact"].forEach(function(id){ var s=document.getElementById(id); if(s){ s.dataset.spSec=id; secs.push(s) } }) }
    var seen = {}, timers = {}, dwell = {}, since = {};
    if("IntersectionObserver" in window){
      var io = new IntersectionObserver(function(ents){
        ents.forEach(function(en){
          var id = en.target.dataset.spSec, vis = en.intersectionRatio>=0.35 || en.intersectionRect.height >= innerHeight*0.5;
          if(vis){ if(!since[id]) since[id]=Date.now(); if(!seen[id] && !timers[id]) timers[id]=setTimeout(function(){ seen[id]=1; T("see:"+page+":"+id) },1500) }
          else { clearTimeout(timers[id]); timers[id]=0; if(since[id]){ dwell[id]=(dwell[id]||0)+(Date.now()-since[id]); since[id]=0 } }
        });
      }, {threshold:[0,.35,.6,1]});
      secs.forEach(function(s){ io.observe(s) });
    }
    var marks = [25,50,75,100], hit = {};
    function depth(){
      var h = document.documentElement.scrollHeight - innerHeight; if(h<=0) return;
      var p = Math.round(scrollY/h*100);
      marks.forEach(function(m){ if(p>=m-2 && !hit[m]){ hit[m]=1; T("depth:"+page+":"+m) } });
      if(p>10) interacted = true;
    }
    addEventListener("scroll", function(){ clearTimeout(depth.t); depth.t=setTimeout(depth,250) }, {passive:true});
    var sent = false;
    function leave(){
      if(sent) return; sent = true;
      Object.keys(since).forEach(function(id){ if(since[id]){ dwell[id]=(dwell[id]||0)+(Date.now()-since[id]); since[id]=0 } });
      var best = null, max = 0; Object.keys(dwell).forEach(function(id){ if(dwell[id]>max){ max=dwell[id]; best=id } });
      if(best && max>4000) T("top:"+page+":"+best);
      if(!interacted && Date.now()-t0 < 8000) T("bounce:"+page);
    }
    document.addEventListener("visibilitychange", function(){ if(document.visibilityState==="hidden") leave() });
    addEventListener("pagehide", leave);
  });

  /* Script errors (once per page) */
  var errSent = false;
  addEventListener("error", function(){ if(!errSent){ errSent = true; T("error:"+page) } });
})();
