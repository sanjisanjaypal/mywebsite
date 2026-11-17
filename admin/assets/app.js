/* Sanjay Pal CMS admin. Plain JavaScript, no build step. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $("#app");

  /* ---------- tiny DOM builder ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const ICONS = {
    pages: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    cases: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2"/>',
    lists: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    media: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 3"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 5.1A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17.8 17.8 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  };
  const ic = (n) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true"); s.innerHTML = ICONS[n] || ""; return s; };
  const fmtDate = (s) => s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";
  const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const rid = () => "c" + Math.random().toString(16).slice(2, 8);

  /* ---------- state and API ---------- */
  const S = { csrf: "", user: null, registry: null, settings: null, draft: null, rev: 0, changed: false, published: null,
              pageDefaults: {}, listDefaults: {}, dataDefaults: null, icons: null, saveT: null, saving: false, scroll: {}, media: null };

  async function api(action, opt = {}) {
    const q = new URLSearchParams(Object.assign({ a: action }, opt.query || {}));
    const init = { method: opt.method || (opt.body || opt.form ? "POST" : "GET"), headers: {}, credentials: "same-origin" };
    if (init.method === "POST") init.headers["X-CSRF"] = S.csrf;
    if (opt.form) init.body = opt.form;
    else if (opt.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opt.body); }
    const r = await fetch("api.php?" + q, init);
    let d = {};
    try { d = await r.json(); } catch (e) { d = { error: "The server sent an unexpected reply (" + r.status + ")." }; }
    if (r.status === 401 && action !== "login") { S.user = null; render(); }
    if (!r.ok) { const e = new Error(d.error || "Request failed"); e.data = d; e.status = r.status; throw e; }
    return d;
  }

  function toast(msg, bad) {
    const t = h("div", { class: "toast" + (bad ? " bad" : ""), text: msg });
    $("#toasts").append(t); setTimeout(() => t.remove(), bad ? 6000 : 3200);
  }

  function modal(title, body, buttons, wide) {
    return new Promise((resolve) => {
      const d = h("dialog", { class: "modal" + (wide ? " wide" : ""), "aria-labelledby": "mT" });
      const close = (v) => { d.close(); d.remove(); resolve(v); };
      d.append(h("div", { class: "mh" }, h("h2", { id: "mT", text: title }), h("button", { class: "btn ghost icon", "aria-label": "Close", title: "Close", onclick: () => close(null) }, "✕")),
        h("div", { class: "mb" }, body),
        h("div", { class: "mf" }, ...(buttons || []).map((b) => h("button", { class: "btn " + (b.cls || ""), type: "button", onclick: async () => {
          if (b.action) { const v = await b.action(); if (v === false) return; close(v === undefined ? b.value : v); } else close(b.value);
        } }, b.label))));
      d.addEventListener("cancel", (e) => { e.preventDefault(); close(null); });
      document.body.append(d); d.showModal();
      const f = d.querySelector("input,textarea,select"); if (f) f.focus();
    });
  }
  const confirmBox = (title, text, ok = "Confirm", danger = false) =>
    modal(title, h("p", { text, style: "margin:0" }), [{ label: "Cancel", value: false }, { label: ok, value: true, cls: danger ? "danger" : "primary" }]).then(Boolean);

  /* ---------- draft saving ---------- */
  function markDirty(now) {
    S.changed = true; setStatus("saving");
    clearTimeout(S.saveT);
    if (now) return saveDraft();
    S.saveT = setTimeout(saveDraft, 700);
    return null;
  }
  // saves run one after another, so a quick second change never races the first
  function saveDraft() {
    S.saveChain = (S.saveChain || Promise.resolve()).then(doSave, doSave);
    return S.saveChain;
  }
  async function doSave() {
    try {
      const r = await api("draft", { body: { content: S.draft, rev: S.rev } });
      S.rev = r.rev; S.draft.rev = r.rev; setStatus();
    } catch (e) {
      if (e.data && e.data.conflict) {
        setStatus("error");
        if (await confirmBox("Someone else saved changes", "Another admin saved this draft after you opened it. Reload to see their version? Your last change here will be lost.", "Reload")) await boot();
      } else { toast(e.message, true); setStatus("error"); }
    }
  }
  async function saveNow() { clearTimeout(S.saveT); await saveDraft(); }
  function setStatus(kind) {
    const el = $("#status"); if (!el) return;
    el.className = "status" + (kind === "saving" ? " saving" : S.changed ? " unpub" : "");
    el.lastChild.textContent = kind === "saving" ? "Saving…" : kind === "error" ? "Not saved" : S.changed ? "Draft saved · not published" : "Published · up to date";
  }

  /* ---------- list state (mirrors the server) ---------- */
  async function listDefaults(file) {
    if (!S.listDefaults[file]) S.listDefaults[file] = await api("defaults", { query: { page: file } });
    return S.listDefaults[file];
  }
  function baseKey(k) { const i = k.lastIndexOf("~"); return i < 0 ? k : k.slice(i + 1); }
  function listState(L, D) {
    const lists = S.draft.lists || {};
    if (lists[L]) return Object.assign({ hidden: [], more: [] }, clone(lists[L]));
    let prefix = "", k = L, st = null;
    while (k.includes("~")) { const i = k.indexOf("~"); prefix += k.slice(0, i + 1); k = k.slice(i + 1); if (lists[k]) { st = lists[k]; break; } }
    if (!st) st = (D.lists || {})[baseKey(L)] || { order: [] };
    const map = (ids) => (ids || []).map((x) => x.startsWith(prefix) ? x : prefix + x);
    return { order: map(st.order), hidden: map(st.hidden), more: map(st.more) };
  }
  function setList(L, st) { S.draft.lists = S.draft.lists || {}; S.draft.lists[L] = st; }

  /* ---------- boot and routing ---------- */
  async function boot() {
    const st = await api("state");
    S.csrf = st.csrf; S.user = st.user; S.setup = st.setup; S.writable = st.writable;
    if (S.user) {
      const b = await api("bootstrap");
      Object.assign(S, { registry: b.registry, settings: b.settings, draft: b.draft, rev: b.draft.rev || 0, changed: b.changed, published: b.published, pageDefaults: b.pageDefaults, user: b.user });
      ["t", "n", "a", "lists", "pages", "data"].forEach((k) => { if (!S.draft[k] || Array.isArray(S.draft[k])) S.draft[k] = {}; });
    }
    render();
  }
  window.addEventListener("hashchange", () => render());

  function render() {
    if (S.setup) return viewSetup();
    if (!S.user) return viewLogin();
    const [route, arg] = location.hash.replace(/^#\/?/, "").split("/");
    const admin = S.user.role === "admin";
    const views = { pages: viewPages, edit: viewEditor, cases: viewCases, lists: viewLists, media: viewMedia, history: viewHistory, account: viewAccount,
                    settings: admin && viewSettings, users: admin && viewUsers, activity: admin && viewActivity };
    (views[route] || viewPages)(decodeURIComponent(arg || ""));
  }

  /* ---------- auth screens ---------- */
  function passField(id, label, auto) {
    const inp = h("input", { type: "password", id, autocomplete: auto, required: true });
    const btn = h("button", { type: "button", class: "btn ghost icon", "aria-label": "Show password", title: "Show password", onclick: () => {
      const show = inp.type === "password"; inp.type = show ? "text" : "password";
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password"); btn.title = btn.getAttribute("aria-label");
      btn.replaceChildren(ic(show ? "eye" : "eyeoff"));
    } }, ic("eyeoff"));
    return h("label", { class: "field", for: id }, h("span", { text: label }), h("div", { class: "row", style: "flex-wrap:nowrap" }, inp, btn));
  }

  function viewLogin() {
    document.title = "Log in · Sanjay Pal admin";
    const err = h("p", { class: "err", role: "alert" });
    const form = h("form", { class: "auth-card", novalidate: true },
      h("div", { class: "brandmark" }, h("b", { text: "SP" }), "Sanjay Pal · Admin"),
      h("h1", { text: "Log in" }), h("p", { class: "lead", text: "Edit and publish your portfolio." }),
      h("label", { class: "field", for: "u" }, h("span", { text: "Username" }), h("input", { type: "text", id: "u", autocomplete: "username", required: true })),
      passField("p", "Password", "current-password"), err,
      h("button", { class: "btn primary", type: "submit", style: "width:100%;min-height:42px" }, "Log in"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); err.textContent = "";
      const b = form.querySelector("button[type=submit]"); b.disabled = true;
      try { const r = await api("login", { body: { username: $("#u").value, password: $("#p").value } }); S.csrf = r.csrf; await boot(); }
      catch (ex) { err.textContent = ex.message; b.disabled = false; }
    });
    app.replaceChildren(h("div", { class: "auth" }, form));
  }

  function viewSetup() {
    document.title = "Set up · Sanjay Pal admin";
    const err = h("p", { class: "err", role: "alert" });
    const form = h("form", { class: "auth-card", novalidate: true },
      h("div", { class: "brandmark" }, h("b", { text: "SP" }), "Sanjay Pal · Admin"),
      h("h1", { text: "Create your admin account" }),
      h("p", { class: "lead", text: "This is the first visit to /admin. The account you create here can manage everything, including other users." }),
      !S.writable ? h("p", { class: "err", text: "The server cannot write to the site folder or /cms-data. Set those folders to writable (755 or 775) in your hosting file manager, then reload." }) : null,
      h("label", { class: "field", for: "code" }, h("span", { text: "Setup code" }), h("input", { type: "text", id: "code", autocomplete: "off", spellcheck: "false" }),
        h("p", { class: "hint", text: "Open cms-data/SETUP-CODE.txt in the files you uploaded and copy the code. It works once." })),
      h("label", { class: "field", for: "n" }, h("span", { text: "Your name" }), h("input", { type: "text", id: "n", autocomplete: "name", value: "Sanjay Pal" })),
      h("label", { class: "field", for: "u" }, h("span", { text: "Username" }), h("input", { type: "text", id: "u", autocomplete: "username", required: true })),
      passField("p", "Password", "new-password"),
      h("p", { class: "hint", text: "At least 10 characters, with letters and a number." }), err,
      h("button", { class: "btn primary", type: "submit", style: "width:100%;min-height:42px;margin-top:8px" }, "Create account and log in"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); err.textContent = "";
      try { const r = await api("setup", { body: { code: $("#code").value, name: $("#n").value, username: $("#u").value, password: $("#p").value } }); S.csrf = r.csrf; S.setup = false; await boot(); }
      catch (ex) { err.textContent = ex.message; }
    });
    app.replaceChildren(h("div", { class: "auth" }, form));
  }

  /* ---------- layout ---------- */
  function layout(route, title, body, extra) {
    document.title = title + " · Sanjay Pal admin";
    const admin = S.user.role === "admin";
    const link = (r, label, icon) => h("a", { href: "#/" + r, "aria-current": route === r ? "page" : null }, ic(icon), label);
    const side = h("aside", { class: "side" },
      h("div", { class: "brandmark" }, h("b", { text: "SP" }), "Sanjay Pal"),
      h("nav", { "aria-label": "Admin" },
        h("div", { class: "navlabel", text: "Content" }),
        link("pages", "Pages", "pages"), link("cases", "Case studies", "cases"), link("lists", "Lists", "lists"), link("media", "Media", "media"),
        h("div", { class: "navlabel", text: "Site" }),
        admin ? link("settings", "Settings", "settings") : null, link("history", "History", "history"),
        admin ? link("users", "Users", "users") : null, admin ? link("activity", "Activity", "activity") : null),
      h("div", { class: "me" }, h("b", { text: S.user.name }), (admin ? "Administrator" : "Editor") + " · ",
        h("a", { href: "#/account", style: "color:var(--lime)" }, "Account"), " · ",
        h("button", { type: "button", onclick: async () => { await api("logout", { body: {} }); S.user = null; render(); } }, "Log out")));
    const status = h("span", { class: "status", id: "status" }, h("i"), "");
    const top = h("div", { class: "topbar" }, h("h1", { text: title }), status, h("div", { class: "grow" }),
      extra || null,
      h("a", { class: "btn", href: "../", target: "_blank", rel: "noopener", title: "Open the live site in a new tab" }, ic("ext"), "View site"),
      h("button", { class: "btn", type: "button", onclick: discard, title: "Throw away unpublished changes" }, "Discard"),
      h("button", { class: "btn primary", type: "button", onclick: publish }, "Publish"));
    app.replaceChildren(h("div", { class: "shell" }, side, h("main", { class: "main" }, top, body)));
    setStatus();
  }

  async function publish() {
    await saveNow();
    const note = h("input", { type: "text", id: "pubNote", placeholder: "e.g. Updated Aster Bank case study" });
    const ok = await modal("Publish changes", h("div", {},
      h("p", { class: "lede", text: "Publishing rebuilds every page of the site from your draft, so visitors see your changes right away. A copy of this version is kept in History." }),
      h("label", { class: "field", for: "pubNote" }, h("span", { text: "What changed (optional)" }), note)),
      [{ label: "Cancel", value: false }, { label: "Publish now", cls: "primary", action: async () => {
        try { const r = await api("publish", { body: { note: note.value } }); S.changed = false; S.rev = r.rev; S.draft.rev = r.rev; setStatus();
              toast("Published " + r.pages.length + " pages"); return true; }
        catch (e) { toast(e.message, true); return false; }
      } }]);
    if (ok) render();
  }
  async function discard() {
    if (!S.changed) { toast("There are no unpublished changes."); return; }
    if (!await confirmBox("Discard unpublished changes?", "Your draft goes back to the published version. Settings and case studies you added stay.", "Discard changes", true)) return;
    try { await api("discard", { body: {} }); await boot(); toast("Draft reset to the published version"); } catch (e) { toast(e.message, true); }
  }

  /* ---------- pages ---------- */
  const pageTitle = (f) => (S.draft.pages[f] && S.draft.pages[f].title) || (S.pageDefaults[f] && S.pageDefaults[f].title) || f;
  async function exposureCheck(box) {
    if (S.exposed === undefined) {
      try { const r = await fetch("../cms-data/registry.json", { cache: "no-store", credentials: "omit" }); S.exposed = r.ok; } catch (e) { S.exposed = false; }
    }
    if (S.exposed) box.replaceChildren(h("div", { class: "card card-b", style: "border-color:var(--danger);background:var(--danger-soft)" },
      h("b", { text: "Your private CMS folder can be read from the web." }),
      h("p", { class: "hint", style: "color:inherit", text: "Your server is ignoring the .htaccess file in /cms-data. On Nginx, add the rule from the install guide; on other hosts, ask support to deny web access to /cms-data. Until then, user names and drafts are visible to anyone who knows the address." })));
  }
  function viewPages() {
    const pcard = (f, label, sub) => h("a", { class: "pagecard", href: "#/edit/" + f }, h("b", { text: label }), h("span", { text: sub }));
    const cases = (S.registry.order || Object.keys(S.registry.cases)).filter((s) => S.registry.cases[s]);
    const warn = h("div");
    exposureCheck(warn);
    layout("pages", "Pages", h("div", { class: "content stack" }, warn,
      h("p", { class: "lede", text: "Pick a page to edit. Click any text, image, link or card in the preview to change it. Changes save as a draft automatically; Publish puts them live." }),
      h("div", { class: "card" }, h("div", { class: "card-h" }, h("h2", { text: "Site pages" })), h("div", { class: "card-b pages" },
        pcard("home.html", "Home", "Hero, badges, work cards, About, testimonials, contact"),
        pcard("about.html", "About", "Shares its About section with Home"),
        pcard("contact.html", "Contact", "Shares its contact section with Home"),
        pcard("index.html", "Site frame", "Music player and loading screen"))),
      h("div", { class: "card" }, h("div", { class: "card-h" }, h("h2", { text: "Case studies" }), h("div", { class: "grow" }), h("a", { class: "btn sm", href: "#/cases" }, "Manage case studies")),
        h("div", { class: "card-b pages" }, cases.map((s) => pcard(S.registry.cases[s].file, pageTitle(S.registry.cases[s].file), S.registry.cases[s].file)))),
      h("div", { class: "card" }, h("div", { class: "card-b row" },
        h("span", { class: "chip " + (S.changed ? "warn" : "ok"), text: S.changed ? "Unpublished changes" : "Live site is up to date" }),
        h("span", { class: "hint", text: "Last published: " + fmtDate(S.published) })))));
  }

  /* ---------- visual editor ---------- */
  let ED = null;
  function viewEditor(arg) {
    const [file, q] = (arg || "home.html").split("?");
    const find = new URLSearchParams(q || "").get("find");
    const allPages = [["home.html", "Home"], ["about.html", "About"], ["contact.html", "Contact"], ["index.html", "Site frame"]]
      .concat((S.registry.order || Object.keys(S.registry.cases)).filter((s) => S.registry.cases[s]).map((s) => [S.registry.cases[s].file, pageTitle(S.registry.cases[s].file)]));
    const sel = h("select", { "aria-label": "Page", onchange: (e) => { location.hash = "#/edit/" + e.target.value; } },
      allPages.map(([f, l]) => h("option", { value: f, selected: f === file ? true : null, text: l })));
    const frame = h("div", { class: "frame" });
    const iframe = h("iframe", { title: "Page preview", src: "api.php?a=preview&page=" + encodeURIComponent(file) + "&t=" + Date.now() });
    const loading = h("div", { class: "loading", text: "Loading preview…" });
    frame.append(iframe, loading);
    const dev = (w, l) => h("button", { type: "button", "aria-pressed": w === "desktop" ? "true" : "false", onclick: (e) => {
      $$("button", e.target.parentElement).forEach((b) => b.setAttribute("aria-pressed", String(b === e.target))); frame.className = "frame " + w; } }, l);
    const modeSeg = h("div", { class: "seg", role: "group", "aria-label": "Mode" },
      ...[["edit", "Edit"], ["browse", "Browse"]].map(([m, l]) => h("button", { type: "button", "aria-pressed": m === "edit" ? "true" : "false", title: m === "edit" ? "Click items to edit them" : "Use the page normally: open tabs, menus and Load more", onclick: (e) => {
        $$("button", modeSeg).forEach((b) => b.setAttribute("aria-pressed", String(b === e.target))); post({ type: "mode", mode: m }); } }, l)));
    const insp = h("div", { class: "insp", "aria-label": "Inspector" });
    const stage = h("div", { class: "stage" }, h("div", { class: "stagebar" }, sel,
      h("div", { class: "seg", role: "group", "aria-label": "Screen size" }, dev("desktop", "Desktop"), dev("tablet", "Tablet"), dev("phone", "Phone")),
      modeSeg, h("div", { class: "grow" }),
      h("button", { class: "btn sm", type: "button", onclick: () => pagePanel() }, "Page settings"),
      h("a", { class: "btn sm", href: "../" + (file === "index.html" ? "" : file), target: "_blank", rel: "noopener", title: "Open the published page" }, ic("ext"), "Live")), frame);
    layout("pages", "Edit · " + (allPages.find((p) => p[0] === file) || [file, file])[1], h("div", { class: "editor" }, stage, insp));
    ED = { file, iframe, insp, loading, lists: [], sel: null, find };
    iframe.addEventListener("load", () => { loading.hidden = true; });
    pagePanel();
  }
  function post(m) { if (ED && ED.iframe.contentWindow) ED.iframe.contentWindow.postMessage(Object.assign({ cms: 1 }, m), location.origin); }
  function reloadPreview() {
    if (!ED) return;
    ED.loading.hidden = false;
    ED.iframe.src = "api.php?a=preview&page=" + encodeURIComponent(ED.file) + "&t=" + Date.now();
  }

  window.addEventListener("message", (ev) => {
    if (ev.origin !== location.origin || !ev.data || !ev.data.cms || !ED) return;
    const m = ev.data;
    if (m.type === "ready") {
      ED.lists = m.lists || []; ED.loading.hidden = true;
      if (m.defaults) S.dataDefaults = m.defaults; if (m.icons) S.icons = m.icons;
      if (S.scroll[ED.file]) post({ type: "scroll", y: S.scroll[ED.file] });
      if (ED.find) { post({ type: "find", item: ED.find }); ED.find = null; }
      if (!ED.sel) pagePanel();
    }
    if (m.type === "scrolled") S.scroll[ED.file] = m.y;
    if (m.type === "select") { ED.sel = m; inspect(m); }
    if (m.type === "deselect") { ED.sel = null; pagePanel(); }
    if (m.type === "text") {
      S.draft.t[m.key] = m.html; markDirty();
      const box = $("#rte"); if (box && box.dataset.key === m.key && document.activeElement !== box) box.innerHTML = m.html;
    }
  });

  function pagePanel() {
    if (!ED) return; ED.sel = null;
    const f = ED.file, def = S.pageDefaults[f] || {}, cur = S.draft.pages[f] || {};
    const upd = (k, v) => { S.draft.pages[f] = Object.assign({}, S.draft.pages[f], { [k]: v }); markDirty(); };
    const top = ED.lists.filter((l) => !l.nested);
    ED.insp.replaceChildren(
      h("section", {}, h("h3", { text: "How to edit" }),
        h("p", { class: "hint", text: "Click text in the preview to type over it. Click an image, link or card to change it. Lists, sections and cards can be moved, copied, hidden or deleted from here once selected." }),
        h("p", { class: "hint", style: "margin-top:6px", text: "Switch to Browse to open tabs, menus or Load more, then back to Edit." })),
      h("section", {}, h("h3", { text: "Search and sharing" }),
        h("label", { class: "field", for: "pt" }, h("span", { text: "Page title" }), h("input", { type: "text", id: "pt", value: cur.title || "", placeholder: def.title || "", oninput: (e) => upd("title", e.target.value) })),
        h("label", { class: "field", for: "pd" }, h("span", { text: "Description" }), h("textarea", { id: "pd", rows: 3, placeholder: def.description || "", oninput: (e) => upd("description", e.target.value) }, cur.description || "")),
        h("p", { class: "hint", text: "Shown in Google results and when the link is shared. Leave empty to keep the original." })),
      h("section", {}, h("h3", { text: "On this page" }),
        top.length ? h("div", { class: "structure" }, top.map((l) => h("button", { type: "button", onclick: () => post({ type: "find", item: l.items[0] && l.items[0].id }) },
          h("b", { text: l.name }), " ", h("span", { class: "hint", text: l.count + " items" })))) : h("p", { class: "empty", text: "This page has no repeatable lists." })));
  }

  async function inspect(m) {
    const D = await listDefaults(ED.file);
    const box = [];
    if (m.text) {
      const k = m.text.key;
      const rte = h("div", { class: "rte", id: "rte", contenteditable: "true", "data-key": k, role: "textbox", "aria-multiline": "true", "aria-label": "Text", html: m.text.html });
      const exec = (cmd, val) => { rte.focus(); document.execCommand(cmd, false, val || null); syncRte(); };
      const syncRte = () => { S.draft.t[k] = rte.innerHTML; post({ type: "set-text", key: k, html: rte.innerHTML }); markDirty(); };
      rte.addEventListener("input", syncRte);
      rte.addEventListener("paste", (e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); });
      box.push(h("section", {}, h("h3", { text: "Text" }),
        h("div", { class: "rte-bar" },
          h("button", { type: "button", title: "Bold", "aria-label": "Bold", onclick: () => exec("bold") }, "B"),
          h("button", { type: "button", title: "Italic", "aria-label": "Italic", onclick: () => exec("italic"), style: "font-style:italic" }, "I"),
          h("button", { type: "button", title: "Add link", "aria-label": "Add link", onclick: async () => {
            const inp = h("input", { type: "url", id: "lnk", placeholder: "https://… or case-aster.html" });
            const v = await modal("Add link", h("label", { class: "field", for: "lnk" }, h("span", { text: "Link to" }), inp), [{ label: "Cancel", value: null }, { label: "Add link", cls: "primary", action: () => inp.value }]);
            if (v) exec("createLink", v);
          } }, "🔗"),
          h("button", { type: "button", title: "Remove link", "aria-label": "Remove link", onclick: () => exec("unlink") }, "⛓"),
          h("button", { type: "button", title: "Clear formatting", "aria-label": "Clear formatting", onclick: () => exec("removeFormat") }, "T̸")),
        rte,
        h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "btn sm", type: "button", onclick: async () => { delete S.draft.t[k]; await markDirty(true); reloadPreview(); toast("Text reset to the original"); } }, "Reset to original"))));
    }
    if (m.runs && m.runs.length) {
      box.push(h("section", {}, h("h3", { text: "Text" }), m.runs.map((r, i) => h("label", { class: "field", for: "run" + i }, h("span", { text: m.runs.length > 1 ? "Text " + (i + 1) : "Label" }),
        h("input", { type: "text", id: "run" + i, value: S.draft.n[r.key] != null ? S.draft.n[r.key] : r.text, oninput: (e) => { S.draft.n[r.key] = e.target.value; post({ type: "set-run", key: r.key, text: e.target.value }); markDirty(); } })))));
    }
    if (m.image) {
      const k = m.image.key; const cur = Object.assign({}, S.draft.a[k]);
      box.push(h("section", {}, h("h3", { text: "Image" }), h("img", { class: "imgprev", src: "../" + (cur.src || m.image.src), alt: "" }),
        h("div", { class: "row", style: "margin:10px 0" }, h("button", { class: "btn sm", type: "button", onclick: async () => {
          const it = await pickMedia("image"); if (!it) return;
          S.draft.a[k] = Object.assign({}, S.draft.a[k], { src: it.path }, m.image.width && it.width ? { width: String(it.width), height: String(it.height) } : {});
          await markDirty(true); reloadPreview();
        } }, "Replace image"), h("button", { class: "btn sm", type: "button", onclick: async () => { delete S.draft.a[k]; await markDirty(true); reloadPreview(); } }, "Reset")),
        m.image.hasAlt ? h("label", { class: "field", for: "alt" }, h("span", { text: "Description for screen readers (alt text)" }),
          h("textarea", { id: "alt", rows: 3, oninput: (e) => { S.draft.a[k] = Object.assign({}, S.draft.a[k], { alt: e.target.value }); markDirty(); } }, cur.alt != null ? cur.alt : m.image.alt)) : null));
    }
    if (m.link) {
      const k = m.link.key; const cur = S.draft.a[k] || {};
      const pages = ["home.html", "about.html", "contact.html"].concat(Object.values(S.registry.cases).map((c) => c.file));
      box.push(h("section", {}, h("h3", { text: "Link" }),
        h("label", { class: "field", for: "href" }, h("span", { text: "Goes to" }),
          h("input", { type: "text", id: "href", list: "pagelist", value: cur.href != null ? cur.href : m.link.href, onchange: async (e) => { S.draft.a[k] = Object.assign({}, S.draft.a[k], { href: e.target.value.trim() }); await markDirty(true); } }),
          h("datalist", { id: "pagelist" }, pages.map((p) => h("option", { value: p })))),
        h("p", { class: "hint", text: "A page of this site (e.g. case-aster.html), a full web address, mailto:you@example.com, or #section." })));
    }
    if (m.card) {
      const k = m.card.key; const cur = S.draft.a[k] || {};
      const shapes = [["house", "House (property)"], ["growth", "Rising bars (wealth)"], ["shield", "Shield (security)"], ["wheat", "Wheat (farming)"], ["car", "Classic car"], ["learn", "Screen with play (learning)"], ["trophy", "Trophy (events)"]];
      box.push(h("section", {}, h("h3", { text: "Work card" }),
        h("div", { class: "row field" }, h("input", { type: "color", id: "tint", value: /^#[0-9a-f]{6}$/i.test(cur.tint || m.card.tint) ? (cur.tint || m.card.tint) : "#7C3AED",
          onchange: async (e) => { S.draft.a[k] = Object.assign({}, S.draft.a[k], { tint: e.target.value }); await markDirty(true); reloadPreview(); } }), h("label", { for: "tint", text: "Card colour" })),
        h("label", { class: "field", for: "shape" }, h("span", { text: "Animated graphic" }), h("select", { id: "shape", onchange: async (e) => { S.draft.a[k] = Object.assign({}, S.draft.a[k], { shape: e.target.value }); await markDirty(true); reloadPreview(); } },
          shapes.map(([v, l]) => h("option", { value: v, selected: (cur.shape || m.card.shape) === v ? true : null, text: l }))))));
    }
    if (m.items && m.items.length) {
      const work = S.registry.workList;
      box.push(h("section", {}, h("h3", { text: "Position" }), m.items.map((it, depth) => {
        const st = listState(it.list, D);
        const i = st.order.indexOf(it.item);
        const op = async (fn, msg) => { fn(st); setList(it.list, st); await markDirty(true); reloadPreview(); if (msg) toast(msg); };
        const hidden = st.hidden.includes(it.item), more = st.more.includes(it.item);
        return h("div", { class: "itemctl" },
          h("b", { text: it.listName }), " ", h("small", { text: "item " + (i + 1) + " of " + st.order.length }),
          h("div", { class: "hint", text: "“" + it.label + "”" }),
          h("div", { class: "row" },
            h("button", { class: "btn sm icon", type: "button", title: "Move up", "aria-label": "Move up", disabled: i <= 0 ? true : null, onclick: () => op((s) => { s.order.splice(i - 1, 0, s.order.splice(i, 1)[0]); }) }, ic("up")),
            h("button", { class: "btn sm icon", type: "button", title: "Move down", "aria-label": "Move down", disabled: i >= st.order.length - 1 ? true : null, onclick: () => op((s) => { s.order.splice(i + 1, 0, s.order.splice(i, 1)[0]); }) }, ic("down")),
            h("button", { class: "btn sm", type: "button", title: "Add a copy after this one", onclick: () => op((s) => { s.order.splice(i + 1, 0, rid() + "~" + it.item); }, "Copy added. Click it to edit.") }, ic("copy"), "Duplicate"),
            h("button", { class: "btn sm", type: "button", onclick: () => op((s) => { s.hidden = hidden ? s.hidden.filter((x) => x !== it.item) : s.hidden.concat(it.item); }, hidden ? "Shown again" : "Hidden from visitors") }, ic(hidden ? "eye" : "eyeoff"), hidden ? "Show" : "Hide"),
            it.list === work ? h("button", { class: "btn sm", type: "button", title: "Show this card only after Load more work", onclick: () => op((s) => { s.more = more ? s.more.filter((x) => x !== it.item) : s.more.concat(it.item); }) }, more ? "Show first" : "Under Load more") : null,
            h("button", { class: "btn sm danger", type: "button", onclick: async () => {
              if (!await confirmBox("Delete this item?", "“" + it.label + "” will be removed from the " + it.listName.toLowerCase() + ". You can bring it back from History.", "Delete", true)) return;
              op((s) => { s.order = s.order.filter((x) => x !== it.item); s.hidden = s.hidden.filter((x) => x !== it.item); s.more = s.more.filter((x) => x !== it.item); }, "Deleted");
            } }, ic("trash"), "Delete")));
      })));
    }
    if (!box.length) box.push(h("section", {}, h("p", { class: "empty", text: "This part of the page is fixed. Select text, an image or a link inside it." })));
    box.push(h("section", {}, h("button", { class: "btn sm", type: "button", onclick: () => { post({ type: "deselect" }); pagePanel(); } }, "Done")));
    ED.insp.replaceChildren(...box);
  }

  /* ---------- media picker and library ---------- */
  async function loadMedia() { S.media = (await api("media")).items; return S.media; }
  const kindOf = (t) => ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(t) ? "image" : t === "mp3" ? "audio" : "doc";
  function mediaTile(it, onclick, pressed) {
    const th = h("div", { class: "th" }, kindOf(it.type) === "image" ? h("img", { src: "../" + it.path, alt: "", loading: "lazy" }) : it.type);
    return h("button", { type: "button", class: "mitem", "aria-pressed": pressed ? "true" : "false", onclick, title: it.path }, th,
      h("span", { class: "nm", text: it.name }), h("span", { class: "mt", text: [it.width ? it.width + "×" + it.height : null, fmtSize(it.size)].filter(Boolean).join(" · ") }));
  }
  function uploader(onDone, accept) {
    const inp = h("input", { type: "file", multiple: true, accept: accept || "image/*,audio/mpeg,application/pdf", class: "sr-only", id: "upl" });
    const zone = h("div", { class: "drop" }, "Drag files here or ", h("label", { for: "upl", class: "btn sm", style: "margin-left:6px" }, "Choose files"), inp,
      h("p", { class: "hint", style: "margin-top:6px", text: "JPG, PNG, WebP, GIF, AVIF, MP3 or PDF, up to 20 MB each." }));
    const send = async (files) => {
      if (!files.length) return;
      const fd = new FormData(); [...files].forEach((f) => fd.append("files[]", f)); fd.append("csrf", S.csrf);
      zone.classList.add("over");
      try { const r = await api("upload", { form: fd }); r.items.forEach((x) => x.error ? toast(x.error, true) : null);
            const ok = r.items.filter((x) => !x.error); if (ok.length) toast(ok.length + " file" + (ok.length > 1 ? "s" : "") + " uploaded"); await loadMedia(); onDone(ok); }
      catch (e) { toast(e.message, true); } finally { zone.classList.remove("over"); inp.value = ""; }
    };
    inp.addEventListener("change", () => send(inp.files));
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); send(e.dataTransfer.files); });
    return zone;
  }
  async function pickMedia(kind) {
    const items = await loadMedia();
    let chosen = null;
    const grid = h("div", { class: "media" });
    const search = h("input", { type: "search", placeholder: "Search files", "aria-label": "Search files", oninput: () => draw() });
    const draw = () => grid.replaceChildren(...S.media.filter((it) => kindOf(it.type) === kind && it.path.toLowerCase().includes(search.value.toLowerCase()))
      .map((it) => mediaTile(it, () => { chosen = it; $$(".mitem", grid).forEach((b) => b.setAttribute("aria-pressed", String(b.title === it.path))); }, chosen && chosen.path === it.path)));
    draw();
    return modal(kind === "image" ? "Choose an image" : "Choose an audio file", h("div", {}, uploader((ok) => { draw(); if (ok[0]) { chosen = S.media.find((m) => m.path === ok[0].path); draw(); } }, kind === "image" ? "image/*" : "audio/mpeg"),
      h("div", { style: "margin-bottom:12px" }, search), grid), [{ label: "Cancel", value: null }, { label: "Use this file", cls: "primary", action: () => chosen || false }], true);
  }

  async function viewMedia() {
    const grid = h("div", { class: "media" }, h("p", { class: "empty", text: "Loading…" }));
    let filter = "all";
    const search = h("input", { type: "search", placeholder: "Search files", "aria-label": "Search files", oninput: () => draw() });
    const fseg = h("div", { class: "seg", role: "group", "aria-label": "File type" }, ...[["all", "All"], ["image", "Images"], ["audio", "Audio"], ["doc", "Documents"]].map(([k, l]) =>
      h("button", { type: "button", "aria-pressed": k === "all" ? "true" : "false", onclick: (e) => { filter = k; $$("button", fseg).forEach((b) => b.setAttribute("aria-pressed", String(b === e.target))); draw(); } }, l)));
    const draw = () => grid.replaceChildren(...(S.media || []).filter((it) => (filter === "all" || kindOf(it.type) === filter) && it.path.toLowerCase().includes(search.value.toLowerCase()))
      .map((it) => mediaTile(it, () => details(it))));
    const details = (it) => modal(it.name, h("div", { class: "stack" },
      kindOf(it.type) === "image" ? h("img", { class: "imgprev", src: "../" + it.path, alt: "" }) : kindOf(it.type) === "audio" ? h("audio", { controls: true, src: "../" + it.path, style: "width:100%" }) : null,
      h("div", { class: "row" }, h("input", { type: "text", readonly: true, value: it.path, "aria-label": "File path", class: "grow" }),
        h("button", { class: "btn sm", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(it.path); toast("Path copied"); } catch (e) { toast("Select the path and copy it", true); } } }, ic("copy"), "Copy")),
      h("p", { class: "hint", text: [it.width ? it.width + " × " + it.height + " px" : null, fmtSize(it.size), "Updated " + fmtDate(it.modified)].filter(Boolean).join(" · ") }),
      !it.deletable ? h("p", { class: "hint", text: "Built-in site file. It can be replaced on the page, but not deleted here." }) : null),
      [it.deletable ? { label: "Delete file", cls: "danger", action: async () => {
        if (!await confirmBox("Delete " + it.name + "?", "Pages that still use this file will show a broken image. Check before deleting.", "Delete", true)) return false;
        try { await api("media-delete", { body: { path: it.path } }); toast("Deleted"); await loadMedia(); draw(); } catch (e) { toast(e.message, true); return false; }
      } } : null, { label: "Close", value: null }].filter(Boolean));
    layout("media", "Media", h("div", { class: "content" },
      h("p", { class: "lede", text: "Upload images, music and PDFs, then use them on any page: select an image in the editor and choose Replace image." }),
      uploader(() => draw()), h("div", { class: "row", style: "margin-bottom:14px" }, fseg, h("div", { class: "grow" }, search)), grid));
    await loadMedia(); draw();
  }

  /* ---------- case studies ---------- */
  async function viewCases() {
    const D = await listDefaults("home.html");
    const R = S.registry, W = R.workList, N = R.navList;
    const bySlugCard = Object.fromEntries(Object.entries(R.cases).map(([s, c]) => [c.card, s]));
    const body = h("div", { class: "content stack" });
    const draw = () => {
      const st = listState(W, D);
      const rows = st.order.map((id) => ({ id, slug: bySlugCard[id] })).filter((r) => r.slug);
      const move = async (i, d) => {
        const s = listState(W, D); const ids = rows.map((r) => r.id); const j = i + d; if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        const others = s.order.filter((x) => !ids.includes(x)); s.order = ids.concat(others); setList(W, s);
        const ns = listState(N, D); const navIds = ids.map((cid) => R.cases[bySlugCard[cid]].nav).filter(Boolean);
        ns.order = navIds.concat(ns.order.filter((x) => !navIds.includes(x))); setList(N, ns);
        await markDirty(true); draw();
      };
      const toggle = async (slug, part) => {
        const c = R.cases[slug]; const s = listState(W, D);
        const on = s[part].includes(c.card);
        s[part] = on ? s[part].filter((x) => x !== c.card) : s[part].concat(c.card); setList(W, s);
        if (part === "hidden" && c.nav) { const ns = listState(N, D); ns.hidden = on ? ns.hidden.filter((x) => x !== c.nav) : ns.hidden.concat(c.nav); setList(N, ns); }
        await markDirty(true); draw();
      };
      body.replaceChildren(
        h("div", { class: "row" }, h("p", { class: "lede grow", style: "margin:0", text: "The order here is the order of the cards on the home page and in the Work menu. Cards under “Load more” appear after visitors click Load more work." }),
          h("button", { class: "btn primary", type: "button", onclick: () => newCase() }, ic("plus"), "New case study")),
        h("div", { class: "card tbl-wrap" }, h("table", { class: "t" },
          h("thead", {}, h("tr", {}, h("th", { text: "Order" }), h("th", { text: "Case study" }), h("th", { text: "On the site" }), h("th", { text: "Actions" }))),
          h("tbody", {}, rows.map((r, i) => {
            const c = R.cases[r.slug], hidden = st.hidden.includes(r.id), more = st.more.includes(r.id);
            return h("tr", {},
              h("td", { class: "num" }, h("div", { class: "row", style: "flex-wrap:nowrap" },
                h("button", { class: "btn sm icon", type: "button", "aria-label": "Move up", title: "Move up", disabled: i === 0 ? true : null, onclick: () => move(i, -1) }, ic("up")),
                h("button", { class: "btn sm icon", type: "button", "aria-label": "Move down", title: "Move down", disabled: i === rows.length - 1 ? true : null, onclick: () => move(i, 1) }, ic("down")))),
              h("td", {}, h("b", { text: pageTitle(c.file) }), h("div", { class: "hint", text: c.file })),
              h("td", {}, h("div", { class: "row" },
                h("button", { class: "chip " + (hidden ? "mute" : "ok"), type: "button", title: "Show or hide this case study", onclick: () => toggle(r.slug, "hidden") }, hidden ? "Hidden" : "Visible"),
                h("button", { class: "chip " + (more ? "warn" : ""), type: "button", title: "Show first, or only after Load more work", onclick: () => toggle(r.slug, "more") }, more ? "Under Load more" : "Shown first"))),
              h("td", {}, h("div", { class: "row" },
                h("a", { class: "btn sm", href: "#/edit/" + c.file }, "Edit page"),
                h("a", { class: "btn sm", href: "#/edit/home.html?find=" + encodeURIComponent(r.id) }, "Edit card"),
                h("button", { class: "btn sm", type: "button", onclick: () => newCase(r.slug) }, ic("copy"), "Duplicate"),
                S.user.role === "admin" ? h("button", { class: "btn sm danger", type: "button", onclick: async () => {
                  if (!await confirmBox("Delete " + pageTitle(c.file) + "?", "The page, its home card and its menu item are removed when you publish. A backup is kept in History.", "Delete case study", true)) return;
                  try { await api("case-delete", { body: { slug: r.slug } }); await boot(); location.hash = "#/cases"; toast("Case study deleted. Publish to remove it from the site."); } catch (e) { toast(e.message, true); }
                } }, ic("trash")) : null)));
          })))),
        h("p", { class: "hint", text: "Hidden case studies keep their page file until you publish; visitors cannot reach them from the menu or cards." }));
    };
    const newCase = async (src) => {
      const slugs = Object.keys(R.cases);
      const name = h("input", { type: "text", id: "ncN", placeholder: "e.g. Nova Insurance claims app" });
      const slug = h("input", { type: "text", id: "ncS", placeholder: "nova-claims" });
      name.addEventListener("input", () => { if (!slug.dataset.touched) slug.value = name.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); });
      slug.addEventListener("input", () => { slug.dataset.touched = "1"; });
      const from = h("select", { id: "ncF" }, slugs.map((s) => h("option", { value: s, selected: s === (src || "aster") ? true : null, text: pageTitle(R.cases[s].file) })));
      const res = await modal(src ? "Duplicate case study" : "New case study", h("div", {},
        h("p", { class: "lede", text: "A new case study starts as a copy of an existing one, with the same sections, images and layout. Change the text and images, and hide or delete the sections you do not need." }),
        h("label", { class: "field", for: "ncF" }, h("span", { text: "Start from" }), from),
        h("label", { class: "field", for: "ncN" }, h("span", { text: "Name" }), name),
        h("label", { class: "field", for: "ncS" }, h("span", { text: "Web address" }), h("div", { class: "row", style: "flex-wrap:nowrap" }, h("span", { class: "hint", text: "case-" }), slug, h("span", { class: "hint", text: ".html" })))),
        [{ label: "Cancel", value: null }, { label: "Create", cls: "primary", action: async () => {
          try { return await api("case-duplicate", { body: { source: from.value, slug: slug.value || name.value, title: name.value } }); } catch (e) { toast(e.message, true); return false; }
        } }]);
      if (res) { await boot(); toast("Created. Edit the page, then publish."); location.hash = "#/edit/" + res.file; }
    };
    layout("cases", "Case studies", body); draw();
  }

  /* ---------- runtime lists (testimonials, process, principles, industries, map) ---------- */
  async function loadDataDefaults() {
    if (S.dataDefaults) return S.dataDefaults;
    return new Promise((resolve) => {
      const f = h("iframe", { src: "api.php?a=preview&page=home.html&t=" + Date.now(), style: "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none", "aria-hidden": "true", tabindex: "-1" });
      const on = (ev) => { if (ev.origin === location.origin && ev.data && ev.data.cms && ev.data.type === "ready") {
        window.removeEventListener("message", on); S.dataDefaults = ev.data.defaults || {}; S.icons = ev.data.icons || []; f.remove(); resolve(S.dataDefaults); } };
      window.addEventListener("message", on); document.body.append(f);
    });
  }
  async function viewLists() {
    const body = h("div", { class: "content stack" }, h("p", { class: "empty", text: "Loading lists…" }));
    layout("lists", "Lists", body);
    const DD = await loadDataDefaults();
    const get = (k) => S.draft.data[k] ? clone(S.draft.data[k]) : clone(DD[k] || []);
    const put = (k, v) => { S.draft.data[k] = v; markDirty(); };
    const reorder = (k, arr, i, d, redraw) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; put(k, arr); redraw(); };
    function block(k, title, help, fields, blank) {
      const wrap = h("div", { class: "card" });
      const draw = () => {
        const arr = get(k);
        wrap.replaceChildren(h("div", { class: "card-h" }, h("h2", { text: title }), h("span", { class: "chip", text: arr.length }), h("div", { class: "grow" }),
          S.draft.data[k] ? h("button", { class: "btn sm", type: "button", onclick: () => { delete S.draft.data[k]; markDirty(); draw(); } }, "Reset to original") : null,
          h("button", { class: "btn sm", type: "button", onclick: () => { const a = get(k); a.push(clone(blank)); put(k, a); draw(); } }, ic("plus"), "Add")),
          h("div", { class: "card-b" }, h("p", { class: "hint", style: "margin-bottom:12px", text: help }),
            arr.map((row, i) => h("div", { class: "lrow" },
              h("div", { class: "ord" }, h("button", { class: "btn sm icon", type: "button", "aria-label": "Move up", title: "Move up", onclick: () => reorder(k, get(k), i, -1, draw) }, ic("up")),
                h("button", { class: "btn sm icon", type: "button", "aria-label": "Move down", title: "Move down", onclick: () => reorder(k, get(k), i, 1, draw) }, ic("down"))),
              h("div", {}, fields.map(([f, label, type, opts]) => {
                const id = k + i + f; const val = Array.isArray(row) ? row[f] : row[f];
                const set = (v) => { const a = get(k); if (Array.isArray(a[i])) a[i][f] = v; else a[i][f] = v; put(k, a); };
                const inp = type === "textarea" ? h("textarea", { id, rows: 3, oninput: (e) => set(e.target.value) }, val || "")
                  : type === "select" ? h("select", { id, onchange: (e) => set(e.target.value) }, (opts || []).map((o) => h("option", { value: o, selected: o === val ? true : null, text: o })))
                  : h("input", { type: "text", id, value: val || "", oninput: (e) => set(e.target.value) });
                return h("label", { class: "field", for: id }, h("span", { text: label }), inp);
              })),
              h("button", { class: "btn sm icon danger", type: "button", "aria-label": "Remove", title: "Remove", onclick: () => { const a = get(k); a.splice(i, 1); put(k, a); draw(); } }, ic("trash"))))));
      };
      draw(); return wrap;
    }
    const places = DD.places || [];
    const mapCard = h("div", { class: "card" }, h("div", { class: "card-h" }, h("h2", { text: "Map: clients by location" })),
      h("div", { class: "card-b grid2" }, places.map((p) => {
        const cur = (S.draft.data.places || {})[p.id];
        return h("label", { class: "field", for: "pl" + p.id }, h("span", { text: p.name }),
          h("textarea", { id: "pl" + p.id, rows: 4, placeholder: "One client per line. Empty shows " + p.n + " logo placeholders.", oninput: (e) => {
            S.draft.data.places = Object.assign({}, S.draft.data.places, { [p.id]: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) }); markDirty(); } }, cur ? cur.join("\n") : ""));
      })));
    body.replaceChildren(
      h("p", { class: "lede", text: "These lists are drawn by the page when it loads: the testimonials carousel, the About tabs and the map. Changes save as a draft; publish to put them live." }),
      block("testimonials", "Testimonials", "Short quote shows on the card; the full text opens when visitors click Read more.", [["q", "Short quote", "textarea"], ["full", "Full text", "textarea"], ["n", "Name or role", "text"], ["r", "Project or company", "text"]], { q: "", full: "", n: "", r: "" }),
      block("process", "How I work: process steps", "Shown in the How I work tab.", [["t", "Step", "text"], ["d", "Description", "textarea"]], { t: "", d: "" }),
      block("principles", "How I work: principles", "Shown as cards under the process.", [["t", "Principle", "text"], ["d", "Description", "textarea"]], { t: "", d: "" }),
      block("industries", "Industries", "Shown under the map in Industries & regions.", [[0, "Industry", "text"], [1, "Icon", "select", S.icons || []]], ["", "gear"]),
      mapCard);
  }

  /* ---------- settings ---------- */
  const COLOR_TOKENS = [["--forest", "Deep green (dark sections, footer)", "#062216"], ["--lime", "Lime accent", "#DDF3AA"], ["--btn-bg", "Green buttons and links", "#027742"],
    ["--pp", "Purple buttons", "#4A1D7A"], ["--bg", "Light page background", "#F9F9EF"], ["--ink", "Text on light pages", "#062216"], ["--sig-red", "Signature red dot", "#E0322B"]];
  const FONTS_DISPLAY = ["", "Newsreader", "Fraunces", "Playfair Display", "DM Serif Display", "Lora", "Instrument Serif", "Libre Caslon Text"];
  const FONTS_BODY = ["", "Instrument Sans", "Inter", "DM Sans", "Manrope", "Work Sans", "IBM Plex Sans", "Source Sans 3"];
  const DEFAULT_TRACKS = [{ src: "music/happy-music.mp3", title: "Happy Music" }, { src: "music/happy-main.mp3", title: "Happy Main" }, { src: "music/funk-electro.mp3", title: "Funk Electro" }];
  function viewSettings() {
    const s = clone(S.settings || {}); s.colors = s.colors || {}; s.fonts = s.fonts || {}; s.tracks = (s.tracks && s.tracks.length) ? s.tracks : clone(DEFAULT_TRACKS);
    let casePw = "";
    const colors = h("div", { class: "colors" }, COLOR_TOKENS.map(([v, l, d]) => {
      const inp = h("input", { type: "color", id: "col" + v, value: s.colors[v] || d, onchange: (e) => { s.colors[v] = e.target.value; } });
      return h("div", { class: "row" }, h("label", { for: "col" + v, class: "grow", text: l }), inp,
        h("button", { class: "btn sm ghost", type: "button", onclick: () => { delete s.colors[v]; inp.value = d; } }, "Default"));
    }));
    const fontSel = (role, list, label) => {
      const cur = s.fonts[role] || "";
      const custom = cur && !list.includes(cur);
      const other = h("input", { type: "text", id: "fo" + role, placeholder: "Any Google Fonts name", value: custom ? cur : "", hidden: custom ? null : true, oninput: (e) => { s.fonts[role] = e.target.value.trim(); } });
      const sel = h("select", { id: "f" + role, onchange: (e) => { other.hidden = e.target.value !== "__other"; s.fonts[role] = e.target.value === "__other" ? other.value : e.target.value; } },
        list.map((f) => h("option", { value: f, selected: f === cur ? true : null, text: f || "Site default" })), h("option", { value: "__other", selected: custom ? true : null, text: "Other…" }));
      return h("label", { class: "field", for: "f" + role }, h("span", { text: label }), sel, other);
    };
    const tracksBox = h("div");
    const drawTracks = () => tracksBox.replaceChildren(...s.tracks.map((t, i) => h("div", { class: "lrow" },
      h("div", { class: "ord" }, h("button", { class: "btn sm icon", type: "button", "aria-label": "Move up", title: "Move up", onclick: () => { if (i) { s.tracks.splice(i - 1, 0, s.tracks.splice(i, 1)[0]); drawTracks(); } } }, ic("up")),
        h("button", { class: "btn sm icon", type: "button", "aria-label": "Move down", title: "Move down", onclick: () => { if (i < s.tracks.length - 1) { s.tracks.splice(i + 1, 0, s.tracks.splice(i, 1)[0]); drawTracks(); } } }, ic("down"))),
      h("div", {}, h("label", { class: "field", for: "tt" + i }, h("span", { text: "Title" }), h("input", { type: "text", id: "tt" + i, value: t.title, oninput: (e) => { t.title = e.target.value; } })),
        h("div", { class: "row" }, h("span", { class: "hint grow", text: t.src }), h("button", { class: "btn sm", type: "button", onclick: async () => { const it = await pickMedia("audio"); if (it) { t.src = it.path; drawTracks(); } } }, "Change file"),
          h("label", { class: "row" }, h("input", { type: "checkbox", checked: t.off ? null : true, onchange: (e) => { t.off = !e.target.checked; } }), "Plays"))),
      h("button", { class: "btn sm icon danger", type: "button", "aria-label": "Remove", title: "Remove", onclick: () => { s.tracks.splice(i, 1); drawTracks(); } }, ic("trash")))),
      h("button", { class: "btn sm", type: "button", onclick: async () => { const it = await pickMedia("audio"); if (it) { s.tracks.push({ src: it.path, title: it.name.replace(/\.mp3$/i, "") }); drawTracks(); } } }, ic("plus"), "Add track"));
    drawTracks();
    const og = h("input", { type: "text", id: "og", value: s.ogImage || "", placeholder: "e.g. uploads/share.jpg", oninput: (e) => { s.ogImage = e.target.value; } });
    const save = async () => {
      try { const r = await api("settings", { body: { settings: s, casePassword: casePw } }); S.settings = Object.assign(s, { casePasswordSet: S.settings.casePasswordSet || !!casePw }); S.changed = true; setStatus(); toast(r.note); viewSettings(); }
      catch (e) { toast(e.message, true); }
    };
    layout("settings", "Settings", h("div", { class: "content stack" },
      h("p", { class: "lede", text: "Site-wide settings. Save here, then Publish to apply them to the live site." }),
      h("div", { class: "grid2" },
        h("div", { class: "card" }, h("div", { class: "card-h" }, h("h2", { text: "Colours" })), h("div", { class: "card-b" }, colors,
          h("p", { class: "hint", style: "margin-top:10px", text: "These replace the main brand colours on every page. Dark mode keeps its own palette." }))),
        h("div", { class: "card" }, h("div", { class: "card-h" }, h("h2", { text: "Fonts" })), h("div", { class: "card-b" },
          fontSel("display", FONTS_DISPLAY, "Headings"), fontSel("body", FONTS_BODY, "Body text"),
          h("p", { class: "hint", text: "Loaded from Google Fonts. Type the exact family name for any other font." }))),
        h("div", { class: "card" }, h("div", { class: "card-h" }, h("h2", { text: "Case-study password" })), h("div", { class: "card-b" },
          h("p", { class: "hint", style: "margin-bottom:10px", text: S.settings.casePasswordSet ? "A custom password is set." : "The original password is in use." }),
          passField("cpw", "New password", "new-password"),
          h("p", { class: "hint", text: "Leave empty to keep the current one. At least 8 characters. Visitors who already unlocked keep access until they close the browser." }))),
        h("div", { class: "card" }, h("div", { class: "card-h" }, h("h2", { text: "Sharing" })), h("div", { class: "card-b" },
          h("label", { class: "field", for: "og" }, h("span", { text: "Image shown when the site is shared" }), h("div", { class: "row", style: "flex-wrap:nowrap" }, og,
            h("button", { class: "btn sm", type: "button", onclick: async () => { const it = await pickMedia("image"); if (it) { og.value = it.path; s.ogImage = it.path; } } }, "Choose"))),
          h("p", { class: "hint", text: "Page titles and descriptions are set per page under Pages → Page settings." })))),
      h("div", { class: "card" }, h("div", { class: "card-h" }, h("h2", { text: "Background music" })), h("div", { class: "card-b" },
        h("p", { class: "hint", style: "margin-bottom:12px", text: "Tracks play in this order across all pages. Upload MP3 files in Media first." }), tracksBox)),
      h("div", {}, h("button", { class: "btn primary", type: "button", onclick: save }, "Save settings"))));
    $("#cpw").addEventListener("input", (e) => { casePw = e.target.value; });
  }

  /* ---------- history, activity, users, account ---------- */
  async function viewHistory() {
    const body = h("div", { class: "content" }, h("p", { class: "empty", text: "Loading…" }));
    layout("history", "History", body);
    const r = await api("history");
    const kinds = { publish: "Published", "before-restore": "Backup before restore", "before-delete": "Backup before delete" };
    body.replaceChildren(h("p", { class: "lede", text: "Every publish is saved here, along with automatic backups. Restoring loads that version into your draft; nothing changes on the live site until you publish." }),
      h("div", { class: "card tbl-wrap" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, h("th", { text: "When" }), h("th", { text: "What" }), h("th", { text: "Who" }), h("th", { text: "" }))),
        h("tbody", {}, r.items.length ? r.items.map((it) => h("tr", {},
          h("td", { class: "num", text: fmtDate(it.time) }), h("td", {}, h("b", { text: kinds[it.kind] || it.kind }), it.note ? h("div", { class: "hint", text: it.note }) : null),
          h("td", { text: it.by }),
          h("td", {}, S.user.role === "admin" ? h("button", { class: "btn sm", type: "button", onclick: async () => {
            if (!await confirmBox("Restore this version?", "Your current draft, settings and case-study list are replaced by this version (a backup is made first). Publish afterwards to put it live.", "Restore")) return;
            try { await api("restore", { body: { id: it.id } }); await boot(); location.hash = "#/pages"; toast("Restored into the draft. Review it, then publish."); } catch (e) { toast(e.message, true); }
          } }, "Restore") : null))) : h("tr", {}, h("td", { colspan: 4, class: "empty", text: "Nothing published from the admin yet." }))))));
  }
  async function viewActivity() {
    const body = h("div", { class: "content" }, h("p", { class: "empty", text: "Loading…" }));
    layout("activity", "Activity", body);
    const r = await api("activity");
    const names = { login: "Logged in", "login-failed": "Failed login", logout: "Logged out", publish: "Published", upload: "Uploaded", "media-delete": "Deleted file", settings: "Changed settings",
      "case-password": "Changed case-study password", restore: "Restored a version", discard: "Discarded draft", "case-duplicate": "Created case study", "case-delete": "Deleted case study",
      "user-save": "Saved user", "user-delete": "Deleted user", password: "Changed own password", setup: "Set up the admin" };
    body.replaceChildren(h("div", { class: "card tbl-wrap" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, ["When", "Who", "What", "Details", "IP address"].map((x) => h("th", { text: x })))),
      h("tbody", {}, r.items.map((it) => h("tr", {}, h("td", { class: "num", text: fmtDate(it.t) }), h("td", { text: it.u }), h("td", {}, h("span", { class: "chip" + (it.a === "login-failed" ? " warn" : ""), text: names[it.a] || it.a })),
        h("td", { text: it.d || "" }), h("td", { class: "num", text: it.ip })))))));
  }
  async function viewUsers() {
    const body = h("div", { class: "content stack" }, h("p", { class: "empty", text: "Loading…" }));
    layout("users", "Users", body);
    const r = await api("users");
    const edit = async (u) => {
      const un = h("input", { type: "text", id: "uu", value: u ? u.username : "", autocomplete: "off" });
      const nm = h("input", { type: "text", id: "un", value: u ? u.name : "" });
      const role = h("select", { id: "ur" }, [["editor", "Editor: edit content, media and case studies, publish"], ["admin", "Administrator: everything, including settings and users"]]
        .map(([v, l]) => h("option", { value: v, selected: (u ? u.role : "editor") === v ? true : null, text: l })));
      const pw = passField("upw", u ? "New password (leave empty to keep)" : "Password", "new-password");
      const ok = await modal(u ? "Edit " + u.username : "Add user", h("div", {}, h("label", { class: "field", for: "un" }, h("span", { text: "Name" }), nm),
        h("label", { class: "field", for: "uu" }, h("span", { text: "Username" }), un), h("label", { class: "field", for: "ur" }, h("span", { text: "Role" }), role), pw,
        h("p", { class: "hint", text: "At least 10 characters, with letters and a number." })),
        [{ label: "Cancel", value: false }, { label: u ? "Save" : "Add user", cls: "primary", action: async () => {
          try { await api("user-save", { body: { id: u ? u.id : null, username: un.value, name: nm.value, role: role.value, password: $("#upw").value } }); return true; } catch (e) { toast(e.message, true); return false; }
        } }]);
      if (ok) { toast("Saved"); viewUsers(); }
    };
    body.replaceChildren(h("div", { class: "row" }, h("p", { class: "lede grow", style: "margin:0", text: "Editors can change content and publish. Administrators can also change settings, restore versions, delete case studies and manage users." }),
      h("button", { class: "btn primary", type: "button", onclick: () => edit(null) }, ic("plus"), "Add user")),
      h("div", { class: "card tbl-wrap" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, ["Name", "Username", "Role", "Last login", ""].map((x) => h("th", { text: x })))),
        h("tbody", {}, r.items.map((u) => h("tr", {}, h("td", {}, h("b", { text: u.name })), h("td", { text: u.username }), h("td", {}, h("span", { class: "chip" + (u.role === "admin" ? " ok" : ""), text: u.role === "admin" ? "Administrator" : "Editor" })),
          h("td", { class: "num", text: fmtDate(u.lastLogin) }),
          h("td", {}, h("div", { class: "row" }, h("button", { class: "btn sm", type: "button", onclick: () => edit(u) }, "Edit"),
            u.id !== S.user.id ? h("button", { class: "btn sm danger", type: "button", onclick: async () => {
              if (!await confirmBox("Delete " + u.username + "?", "They will no longer be able to log in.", "Delete user", true)) return;
              try { await api("user-delete", { body: { id: u.id } }); toast("Deleted"); viewUsers(); } catch (e) { toast(e.message, true); }
            } }, "Delete") : h("span", { class: "hint", text: "You" })))))))));
  }
  function viewAccount() {
    const err = h("p", { class: "err", role: "alert" });
    const form = h("form", { class: "card card-b", style: "max-width:460px", novalidate: true },
      h("p", { class: "lede", text: "Signed in as " + S.user.username + "." }),
      passField("cur", "Current password", "current-password"), passField("new", "New password", "new-password"),
      h("p", { class: "hint", text: "At least 10 characters, with letters and a number." }), err,
      h("button", { class: "btn primary", type: "submit", style: "margin-top:8px" }, "Change password"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); err.textContent = "";
      try { await api("password", { body: { current: $("#cur").value, new: $("#new").value } }); toast("Password changed"); form.reset(); } catch (ex) { err.textContent = ex.message; }
    });
    layout("account", "Account", h("div", { class: "content" }, form));
  }

  boot().catch((e) => { app.replaceChildren(h("div", { class: "content" }, h("p", { class: "err", text: "The admin could not start: " + e.message }))); });
})();
