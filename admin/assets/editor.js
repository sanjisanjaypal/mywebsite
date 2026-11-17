/* Runs inside the admin preview. Highlights editable items, lets text be typed in place,
   and tells the admin panel what was selected. All changes go through the panel (postMessage). */
(function () {
  "use strict";
  if (window.parent === window) return;
  const P = window.parent, ORIGIN = location.origin;
  const page = (new URLSearchParams(location.search)).get("page") || "home.html";
  let mode = "edit", selected = null, editing = null;
  const send = (m) => P.postMessage(Object.assign({ cms: 1, page }, m), ORIGIN);
  document.documentElement.classList.add("cms-editing");

  const label = (el) => {
    const pick = el.matches("h1,h2,h3,h4,figcaption,li,p,a,span,button") ? el : el.querySelector("h1,h2,h3,h4,.cs-kicker,figcaption,.sm-t,b,strong,p,li");
    const src = pick || el;
    const c = src.cloneNode(true); c.querySelectorAll(".sr-only,.zoom-hint,.lbl,svg,script,style").forEach((x) => x.remove());
    const t = (el.getAttribute("aria-label") || c.textContent || (el.querySelector("img") || {}).alt || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
    return t.slice(0, 60) || el.tagName.toLowerCase();
  };
  const listName = (L) => {
    const el = document.querySelector('[data-cms-list="' + CSS.escape(L) + '"]');
    if (!el) return "List";
    const c = el.className || "";
    if (/bento/.test(c)) return "Work cards";
    if (el.id === "workMenu") return "Work menu";
    if (/cs-body/.test(c)) return "Sections";
    if (/cs-sec/.test(c)) return "Section content";
    if (/cs-gallery/.test(c)) return "Gallery";
    if (/tags/.test(c)) return "Tags";
    if (/impact|cs-stats|stats/.test(c)) return "Figures";
    if (/cta-row/.test(c)) return "Buttons";
    if (/hero-copy|about-cols/.test(c)) return "Paragraphs";
    if (/awards/.test(c)) return "Recognition";
    if (/socials/.test(c)) return "Links";
    return el.tagName === "UL" || el.tagName === "OL" ? "List" : "Group";
  };

  function context(el) {
    const items = [];
    let n = el.closest("[data-cms-item]");
    while (n) {
      const list = n.parentElement && n.parentElement.closest("[data-cms-list]");
      if (!list) break;
      const L = list.getAttribute("data-cms-list");
      const sibs = [...list.querySelectorAll(":scope > [data-cms-item]")];
      items.push({ item: n.getAttribute("data-cms-item"), list: L, listName: listName(L), index: sibs.indexOf(n) + 1, count: sibs.length,
                   hidden: n.hasAttribute("data-cms-hidden"), more: n.hasAttribute("data-more"), label: label(n) });
      n = list.closest("[data-cms-item]");
    }
    return items;
  }

  function describe(el, ev) {
    const info = { type: "select", items: context(el) };
    const leaf = el.closest("[data-cms-k]");
    if (leaf) { info.text = { key: leaf.getAttribute("data-cms-k"), html: leaf.innerHTML, tag: leaf.tagName.toLowerCase() }; }
    const runEl = !leaf && el.closest("[data-cms-tn]");
    if (runEl) {
      const keys = runEl.getAttribute("data-cms-tn").split(/\s+/);
      const runs = [...runEl.childNodes].filter((x) => x.nodeType === 3 && x.textContent.trim());
      info.runs = keys.map((k, i) => ({ key: k, text: runs[i] ? runs[i].textContent.trim() : "" }));
    }
    const img = el.closest("img[data-cms-a]") || (el.tagName === "IMG" && el.hasAttribute("data-cms-a") ? el : null);
    if (img) info.image = { key: img.getAttribute("data-cms-a"), src: img.getAttribute("src"), alt: img.getAttribute("alt") || "",
                            hasAlt: img.hasAttribute("alt"), width: img.getAttribute("width"), height: img.getAttribute("height") };
    const a = el.closest("a[data-cms-a]");
    if (a) info.link = { key: a.getAttribute("data-cms-a"), href: a.getAttribute("href") || "", label: label(a) };
    const card = el.closest("article[data-cms-a]");
    if (card) {
      const g = card.querySelector("[data-shape]");
      info.card = { key: card.getAttribute("data-cms-a"), tint: (card.getAttribute("style") || "").replace(/.*--tint:\s*([^;]+).*/, "$1").trim(), shape: g ? g.getAttribute("data-shape") : "" };
    }
    return info;
  }

  function outline(el) {
    document.querySelectorAll(".cms-sel").forEach((x) => x.classList.remove("cms-sel"));
    if (el) el.classList.add("cms-sel");
  }

  function stopEditing() {
    if (!editing) return;
    editing.removeAttribute("contenteditable"); editing.classList.remove("cms-typing"); editing = null;
  }

  function startEditing(leaf) {
    if (editing === leaf) return;
    stopEditing();
    editing = leaf; leaf.setAttribute("contenteditable", "true"); leaf.classList.add("cms-typing");
    leaf.focus({ preventScroll: true });
  }

  document.addEventListener("click", (ev) => {
    if (mode !== "edit") return;
    const el = ev.target.closest("[data-cms-k],[data-cms-tn],[data-cms-a],[data-cms-item]");
    if (editing && editing.contains(ev.target)) return;            // keep caret moves inside the text being typed
    ev.preventDefault(); ev.stopPropagation();
    if (!el) { stopEditing(); outline(null); selected = null; send({ type: "deselect" }); return; }
    const leaf = ev.target.closest("[data-cms-k]");
    const target = leaf || ev.target.closest("img[data-cms-a]") || ev.target.closest("[data-cms-tn]") || ev.target.closest("a[data-cms-a]") || ev.target.closest("article[data-cms-a]") || el;
    selected = target; outline(target);
    send(describe(target, ev));
    if (leaf) startEditing(leaf); else stopEditing();
  }, true);

  // keep page scripts from reacting to clicks while editing (tabs, menus, links)
  ["mousedown", "mouseup", "pointerup", "submit"].forEach((t) => document.addEventListener(t, (ev) => {
    if (mode === "edit" && !(editing && editing.contains(ev.target))) { if (t === "submit") ev.preventDefault(); }
  }, true));

  document.addEventListener("keydown", (ev) => {
    if (!editing) return;
    if (ev.key === "Enter") { ev.preventDefault(); document.execCommand("insertLineBreak"); }
    if (ev.key === "Escape") { ev.preventDefault(); stopEditing(); }
    if ((ev.metaKey || ev.ctrlKey) && ["b", "i", "u"].includes(ev.key.toLowerCase())) {
      ev.preventDefault(); document.execCommand({ b: "bold", i: "italic", u: "underline" }[ev.key.toLowerCase()]);
    }
  }, true);

  document.addEventListener("paste", (ev) => {
    if (!editing) return;
    ev.preventDefault();
    const t = (ev.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, t);
  }, true);

  document.addEventListener("input", (ev) => {
    if (!editing || !editing.contains(ev.target)) return;
    send({ type: "text", key: editing.getAttribute("data-cms-k"), html: editing.innerHTML });
  }, true);

  window.addEventListener("message", (ev) => {
    if (ev.origin !== ORIGIN || !ev.data || !ev.data.cms) return;
    const m = ev.data;
    if (m.type === "mode") {
      mode = m.mode; document.documentElement.classList.toggle("cms-browse", mode !== "edit");
      if (mode !== "edit") { stopEditing(); outline(null); }
    }
    if (m.type === "set-text") {
      document.querySelectorAll('[data-cms-k="' + CSS.escape(m.key) + '"]').forEach((el) => { if (el !== editing) el.innerHTML = m.html; });
    }
    if (m.type === "set-run") {
      document.querySelectorAll("[data-cms-tn]").forEach((el) => {
        const keys = el.getAttribute("data-cms-tn").split(/\s+/), i = keys.indexOf(m.key);
        if (i < 0) return;
        const runs = [...el.childNodes].filter((x) => x.nodeType === 3 && x.textContent.trim());
        if (runs[i]) runs[i].textContent = runs[i].textContent.replace(runs[i].textContent.trim(), m.text);
      });
    }
    if (m.type === "exec" && editing) { editing.focus(); document.execCommand(m.cmd, false, m.value || null); send({ type: "text", key: editing.getAttribute("data-cms-k"), html: editing.innerHTML }); }
    if (m.type === "scroll") window.scrollTo(0, m.y || 0);
    if (m.type === "find") {
      const el = document.querySelector('[data-cms-item="' + CSS.escape(m.item) + '"]') || document.querySelector('[data-cms-k="' + CSS.escape(m.item) + '"]');
      if (el) { el.scrollIntoView({ block: "center" }); selected = el; outline(el); send(describe(el)); }
    }
  });

  let st;
  window.addEventListener("scroll", () => { clearTimeout(st); st = setTimeout(() => send({ type: "scrolled", y: window.scrollY }), 120); }, { passive: true });

  function ready() {
    const lists = [...document.querySelectorAll("[data-cms-list]")].map((el) => ({ key: el.getAttribute("data-cms-list"), name: listName(el.getAttribute("data-cms-list")),
      count: el.querySelectorAll(":scope > [data-cms-item]").length, nested: !!el.parentElement.closest("[data-cms-item]"),
      items: [...el.querySelectorAll(":scope > [data-cms-item]")].map((n) => ({ id: n.getAttribute("data-cms-item"), label: label(n), hidden: n.hasAttribute("data-cms-hidden") })) }));
    send({ type: "ready", title: document.title, lists, defaults: window.__cmsDefaults || null, icons: window.__cmsIcons || null, height: document.documentElement.scrollHeight });
  }
  if (document.readyState === "complete") setTimeout(ready, 50); else window.addEventListener("load", () => setTimeout(ready, 50));
})();
