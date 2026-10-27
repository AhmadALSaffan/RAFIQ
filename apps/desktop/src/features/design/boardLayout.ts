/**
 * An app design as a board: the identity sheet first, then every screen in a phone frame,
 * in the order the model wrote them (the user's journey). The app draws it live
 * (Board.tsx) and writes it as one HTML file the user can open anywhere (`boardHtml`).
 */

import { guarded } from "./preview";

export interface BoardItem {
  /** The document's name (`<!-- file: home -->`), the id links point at. */
  id: string;
  /** What's printed above it: the document's <title>, else its name. */
  label: string;
  html: string;
  kind: "brand" | "screen";
}

/** The phone the screens are drawn in: an iPhone-sized screen, its frame and its corners. */
export const PHONE = { width: 390, height: 844, bezel: 12, radius: 56, screenRadius: 46 } as const;
export const SHEET_WIDTH = 1200;

const BRAND = /^(brand|identity|style-?guide|design-?system|الهوية)/i;

function titleOf(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const text = match?.[1].replace(/\s+/g, " ").trim();
  return text || null;
}

/** The board's items from the design's documents: the identity sheet(s) first. */
export function boardItems(files: { name: string; html: string }[]): BoardItem[] {
  const items = files
    // a board exported earlier sits in the same folder: it isn't one of its own screens
    .filter((f) => f.html.trim() && !/-board$/i.test(f.name))
    .map((f): BoardItem => ({ id: f.name, label: titleOf(f.html) ?? f.name, html: f.html, kind: BRAND.test(f.name) ? "brand" : "screen" }));
  return [...items.filter((i) => i.kind === "brand"), ...items.filter((i) => i.kind === "screen")];
}

/** The screen a link names ("cart.html", "#cart", "cart"), if the board has it. */
export function screenFor(items: BoardItem[], page: string): BoardItem | null {
  const name = page.split("#").pop()!.split("?")[0].split("/").pop()!.replace(/\.html?$/i, "").toLowerCase();
  if (!name) return null;
  return items.find((i) => i.id.toLowerCase() === name) ?? null;
}

/**
 * A screen on the board behaves like a phone under a finger: dragging with the mouse scrolls
 * whatever is under it (with a little momentum) instead of selecting text, and where nothing
 * can scroll that way the drag moves the board itself (`pan`). Text can't be selected
 * except in fields; a click that ended a drag doesn't press anything.
 */
const TOUCH_RUNTIME = `(function () {
  var style = document.createElement("style");
  style.textContent = "html{-webkit-user-select:none;user-select:none}input,textarea,select,[contenteditable],[contenteditable] *{-webkit-user-select:text;user-select:text}img,a{-webkit-user-drag:none}";
  (document.head || document.documentElement).appendChild(style);
  var root = document.documentElement;
  var drag = null, moved = false, glide = 0;
  // whether a box really moves that way (body's overflow often belongs to the viewport)
  var moves = function (el, axis) {
    var key = axis === "y" ? "scrollTop" : "scrollLeft", before = el[key];
    el[key] = before + 1;
    if (el[key] === before) el[key] = before - 1;
    var ok = el[key] !== before;
    el[key] = before;
    return ok;
  };
  var scroller = function (el, axis) {
    for (; el && el !== root && el !== document.body; el = el.parentElement) {
      if (el.nodeType !== 1) continue;
      var s = getComputedStyle(el), o = axis === "y" ? s.overflowY : s.overflowX;
      if (/(auto|scroll)/.test(o) && moves(el, axis)) return el;
    }
    var doc = document.scrollingElement || root;
    if (moves(doc, axis)) return doc;
    return document.body && moves(document.body, axis) ? document.body : null;
  };
  var by = function (box, axis, d) { if (axis === "y") box.scrollTop -= d; else box.scrollLeft -= d; };
  addEventListener("pointerdown", function (e) {
    glide++;
    moved = false;
    if (e.pointerType !== "mouse" || e.button !== 0 || root.hasAttribute("data-rafiq-picking")) return;
    if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
    drag = { x: e.clientX, y: e.clientY, t: e.timeStamp, v: 0, el: e.target, axis: null, box: null, id: e.pointerId };
  });
  addEventListener("pointermove", function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      drag.axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
      drag.box = scroller(drag.el, drag.axis);
      moved = true;
      try { root.setPointerCapture(drag.id); } catch (_) {}
    }
    var d = drag.axis === "y" ? dy : dx;
    drag.v = d / Math.max(1, e.timeStamp - drag.t);
    drag.x = e.clientX; drag.y = e.clientY; drag.t = e.timeStamp;
    if (drag.box) by(drag.box, drag.axis, d);
    else parent.postMessage({ source: "rafiq-board", type: "pan", dx: dx, dy: dy }, "*");
  });
  var end = function () {
    if (drag && drag.box && Math.abs(drag.v) > 0.2) {
      var box = drag.box, axis = drag.axis, v = drag.v * 16, mine = ++glide;
      (function step() { v *= 0.94; if (mine !== glide || Math.abs(v) < 0.5) return; by(box, axis, v); requestAnimationFrame(step); })();
    }
    drag = null;
  };
  addEventListener("pointerup", end);
  addEventListener("pointercancel", end);
  addEventListener("click", function (e) { if (moved) { moved = false; e.preventDefault(); e.stopPropagation(); } }, true);
  addEventListener("dragstart", function (e) { e.preventDefault(); });
})();`;

/** A document as the board shows it: the preview runtime (links stay inside the design),
 *  the touch runtime, plus its height, so an identity sheet is drawn whole. */
export function framed(html: string): string {
  return `${guarded(html)}
<script>${TOUCH_RUNTIME}</script>
<script>(function () {
  var send = function () { parent.postMessage({ source: "rafiq-board", type: "height", h: document.documentElement.scrollHeight }, "*"); };
  addEventListener("load", function () { send(); setTimeout(send, 400); setTimeout(send, 1500); });
})();</script>`;
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The status bar drawn over every screen: the time, signal, wifi, battery. */
export const STATUS_BAR_SVG = `<svg width="68" height="13" viewBox="0 0 68 13" fill="currentColor" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="4.5" y="6" width="3" height="6" rx="1"/><rect x="9" y="3.5" width="3" height="8.5" rx="1"/><rect x="13.5" y="1" width="3" height="11" rx="1"/><path d="M28 3.2c2.3 0 4.4.9 6 2.4l1.2-1.2A10.2 10.2 0 0 0 28 1.5c-2.8 0-5.3 1.1-7.2 2.9l1.2 1.2A8.5 8.5 0 0 1 28 3.2Zm0 3.4c1.4 0 2.6.5 3.6 1.4l1.2-1.2A6.8 6.8 0 0 0 28 4.9a6.8 6.8 0 0 0-4.8 1.9L24.4 8c1-.9 2.2-1.4 3.6-1.4Zm0 3.4c.5 0 1 .2 1.3.5L28 11.8l-1.3-1.3c.3-.3.8-.5 1.3-.5Z"/><rect x="42" y="1.5" width="22" height="10" rx="3" fill="none" stroke="currentColor" stroke-opacity=".4"/><rect x="44" y="3.5" width="16" height="6" rx="1.6"/><path d="M65.5 5v3a1.6 1.6 0 0 0 0-3Z" fill-opacity=".4"/></svg>`;

/**
 * The board as a file of its own: every document in an iframe of its own (so their styles
 * never meet), the phones drawn in CSS, and a little script to pan (drag) and zoom (wheel,
 * or the buttons). Opens in any browser, no network needed beyond the designs' own fonts.
 */
export function boardHtml(title: string, items: BoardItem[], dir: "rtl" | "ltr", subtitle: string): string {
  const sheets = items.filter((i) => i.kind === "brand");
  const screens = items.filter((i) => i.kind === "screen");
  const sheet = (i: BoardItem) =>
    `<figure class="card sheet" id="b-${escapeAttr(i.id)}"><figcaption>${escapeText(i.label)}</figcaption><iframe sandbox="allow-scripts" title="${escapeAttr(i.label)}" srcdoc="${escapeAttr(framed(i.html))}"></iframe></figure>`;
  const phone = (i: BoardItem, n: number) =>
    `<figure class="card" id="b-${escapeAttr(i.id)}"><figcaption><b>${String(n + 1).padStart(2, "0")}</b> ${escapeText(i.label)}</figcaption><div class="phone"><iframe sandbox="allow-scripts" title="${escapeAttr(i.label)}" srcdoc="${escapeAttr(framed(i.html))}"></iframe><div class="status"><span>9:41</span><div class="island"></div>${STATUS_BAR_SVG}</div><div class="home"></div></div></figure>`;
  return `<!doctype html>
<html lang="${dir === "rtl" ? "ar" : "en"}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
<style>
  :root { --bg: #ececec; --dot: #c9c9c9; --ink: #161616; --muted: #6b6b6b; --card: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151515; --dot: #2c2c2c; --ink: #f2f2f2; --muted: #9a9a9a; --card: #1f1f1f; } }
  html, body { margin: 0; height: 100%; overflow: hidden; overscroll-behavior: none; -webkit-user-select: none; user-select: none; background: var(--bg); color: var(--ink); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
  #view { position: fixed; inset: 0; cursor: grab; background-image: radial-gradient(var(--dot) 1px, transparent 1px); background-size: 24px 24px; }
  #view.drag { cursor: grabbing; }
  #view.drag iframe { pointer-events: none; }
  #board { position: absolute; top: 0; left: 0; transform-origin: 0 0; padding: 96px; display: flex; flex-direction: column; gap: 72px; }
  header h1 { margin: 0; font-size: 44px; letter-spacing: -0.02em; }
  header p { margin: 6px 0 0; color: var(--muted); font-size: 16px; }
  .row { display: flex; gap: 72px; align-items: flex-start; }
  .card { margin: 0; display: flex; flex-direction: column; gap: 14px; }
  figcaption { font-size: 15px; color: var(--muted); }
  figcaption b { color: var(--ink); font-variant-numeric: tabular-nums; margin-inline-end: 6px; }
  .sheet iframe { width: ${SHEET_WIDTH}px; height: 900px; border: 0; border-radius: 20px; background: var(--card); box-shadow: 0 30px 80px -40px rgba(0,0,0,.45); }
  .phone { position: relative; width: ${PHONE.width}px; height: ${PHONE.height}px; padding: ${PHONE.bezel}px; border-radius: ${PHONE.radius}px; background: #0c0c0d; box-shadow: inset 0 0 0 2px #2b2b2e, 0 40px 90px -40px rgba(0,0,0,.6); }
  .phone iframe { display: block; width: ${PHONE.width}px; height: ${PHONE.height}px; border: 0; border-radius: ${PHONE.screenRadius}px; background: #fff; }
  .status { position: absolute; top: ${PHONE.bezel}px; left: ${PHONE.bezel}px; right: ${PHONE.bezel}px; height: 54px; display: flex; align-items: center; justify-content: space-between; padding: 0 30px 0 38px; direction: ltr; color: #fff; mix-blend-mode: difference; pointer-events: none; font: 600 16px/1 -apple-system, "SF Pro Text", system-ui, sans-serif; }
  .island { position: absolute; left: 50%; top: 11px; width: 124px; height: 36px; margin-left: -62px; border-radius: 20px; background: #000; mix-blend-mode: normal; }
  .home { position: absolute; bottom: ${PHONE.bezel + 8}px; left: 50%; width: 134px; height: 5px; margin-left: -67px; border-radius: 3px; background: #fff; mix-blend-mode: difference; pointer-events: none; }
  #zoom { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--card); box-shadow: 0 8px 30px -10px rgba(0,0,0,.35); direction: ltr; }
  #zoom button { border: 0; background: transparent; color: var(--ink); min-width: 34px; height: 30px; border-radius: 999px; font: inherit; cursor: pointer; }
  #zoom button:hover { background: var(--bg); }
</style>
</head>
<body>
<div id="view"><div id="board">
  <header><h1>${escapeText(title)}</h1><p>${escapeText(subtitle)}</p></header>
  ${sheets.length ? `<div class="row">${sheets.map(sheet).join("")}</div>` : ""}
  <div class="row">${screens.map(phone).join("")}</div>
</div></div>
<div id="zoom"><button data-z="out" aria-label="Zoom out">−</button><button data-z="fit" id="pct">100%</button><button data-z="in" aria-label="Zoom in">+</button></div>
<script>
(function () {
  var view = document.getElementById("view"), board = document.getElementById("board"), pct = document.getElementById("pct");
  var s = 1, x = 0, y = 0;
  function apply() { board.style.transform = "translate(" + x + "px," + y + "px) scale(" + s + ")"; pct.textContent = Math.round(s * 100) + "%"; }
  function zoomAt(k, cx, cy) { var n = Math.min(2, Math.max(0.08, s * k)); x = cx - (cx - x) * (n / s); y = cy - (cy - y) * (n / s); s = n; apply(); }
  function fit() { var w = board.scrollWidth, h = board.scrollHeight, room = innerHeight - 64; s = Math.min(1, innerWidth / w, room / h); x = (innerWidth - w * s) / 2; y = Math.max(0, (room - h * s) / 2); apply(); }
  view.addEventListener("wheel", function (e) { e.preventDefault(); if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY); else { x -= e.deltaX; y -= e.deltaY; apply(); } }, { passive: false });
  var drag = null;
  view.addEventListener("pointerdown", function (e) { if (e.target.closest("iframe")) return; drag = { px: e.clientX, py: e.clientY, x: x, y: y }; view.classList.add("drag"); view.setPointerCapture(e.pointerId); });
  view.addEventListener("pointermove", function (e) { if (!drag) return; x = drag.x + e.clientX - drag.px; y = drag.y + e.clientY - drag.py; apply(); });
  view.addEventListener("pointerup", function () { drag = null; view.classList.remove("drag"); });
  document.getElementById("zoom").addEventListener("click", function (e) { var z = e.target.getAttribute("data-z"); if (z === "fit") fit(); if (z === "in") zoomAt(1.25, innerWidth / 2, innerHeight / 2); if (z === "out") zoomAt(0.8, innerWidth / 2, innerHeight / 2); });
  addEventListener("message", function (e) {
    var d = e.data || {};
    if (d.source === "rafiq-board" && d.type === "height") {
      document.querySelectorAll(".sheet iframe").forEach(function (f) { if (f.contentWindow === e.source) f.style.height = Math.max(400, Math.min(6000, d.h)) + "px"; });
    }
    if (d.source === "rafiq-board" && d.type === "pan") { x += d.dx * s; y += d.dy * s; apply(); }
    if (d.source === "rafiq-preview" && d.type === "missing" && d.page) {
      var id = String(d.page).split("#").pop().split("/").pop().replace(/\\.html?$/i, "");
      var target = document.getElementById("b-" + id);
      if (!target) return;
      var r = target.getBoundingClientRect();
      x += innerWidth / 2 - (r.left + r.width / 2); y += innerHeight / 2 - (r.top + r.height / 2); apply();
    }
  });
  addEventListener("load", fit);
  fit();
})();
</script>
</body>
</html>
`;
}
