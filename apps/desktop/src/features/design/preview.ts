/** Rendering a design's HTML safely inside the app (the preview, and history's compare). */

/**
 * The preview is a `srcdoc` document, so it inherits the app's URL as its base: the design's
 * own links (`#contact`, `about.html`) would load the app — or nothing — into the frame
 * instead of the design's page. This runtime keeps navigation inside the design: `#id` links
 * move within the document (hashchange included, for designs that route on it), links to
 * another page jump to the section with that name, web links open in the browser, and forms
 * don't navigate. It also keeps the webview's own menu (with Inspect) out of the frame, and
 * keeps the reader where they were when the model sends a new version: the frame's
 * `window.name` survives the reload, so the scroll position rides in it.
 * Only the rendered copy is touched; what we copy, save and hand off stays the model's HTML.
 */
const PREVIEW_RUNTIME = `(function () {
  var post = function (data) { data.source = "rafiq-preview"; parent.postMessage(data, "*"); };
  var find = function (name) {
    if (!name) return null;
    var esc = CSS.escape(name);
    return document.getElementById(name) ||
      document.querySelector('[name="' + esc + '"], [data-page="' + esc + '"], #page-' + esc + ', #' + esc + '-page');
  };
  var go = function (name) {
    var target = find(name);
    var id = target && target.id ? target.id : name;
    var hash = id ? "#" + id : "";
    if (location.hash !== hash) location.hash = hash;
    if (target) target.scrollIntoView();
    else if (!name) scrollTo(0, 0);
  };
  var KEY = "rafiq-scroll:";
  var pending = false;
  addEventListener("scroll", function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; window.name = KEY + Math.round(scrollY); });
  }, { passive: true });
  var restore = function () {
    var y = window.name.indexOf(KEY) === 0 ? parseInt(window.name.slice(KEY.length), 10) : 0;
    if (y > 0 && !location.hash) scrollTo(0, y);
  };
  if (document.readyState === "complete") restore(); else addEventListener("load", restore);
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  document.addEventListener("submit", function (e) { if (!e.defaultPrevented) e.preventDefault(); });
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    var link = e.target.closest ? e.target.closest("a[href]") : null;
    if (!link) return;
    var href = link.getAttribute("href").trim();
    if (!href || /^javascript:/i.test(href)) return;
    e.preventDefault();
    if (/^(https?:|mailto:|tel:)/i.test(href)) return post({ type: "open", url: href });
    var parts = href.split("#");
    var fragment = decodeURIComponent(parts[1] || "");
    var file = parts[0].split("?")[0].replace(/\\/+$/, "").split("/").pop() || "";
    var page = file.replace(/\\.html?$/i, "");
    if (!page || /^(index|home)$/i.test(page)) return go(fragment);
    if (find(page)) return go(page);
    post({ type: "missing", page: file });
  });
})();`;

/**
 * Picking parts of the design to talk about. The app sends `{ source: "rafiq-host", type:
 * "pick", on }`; while it's on, the frame outlines what's under the pointer, and each click
 * marks that element (a second click on it unmarks it) and sends back what it is — a
 * selector, its text, its HTML — instead of acting on it. The app numbers the marks
 * (`marks`: the ones it keeps, with their numbers) and removes them all with `clear`.
 * Escape stops picking and keeps the marks.
 */
const PICK_RUNTIME = `(function () {
  var post = function (data) { data.source = "rafiq-preview"; parent.postMessage(data, "*"); };
  var root = document.documentElement;
  var on = false, color = "#e8833a", hover = null, hoverBox = null, next = 1;
  var marks = [];
  var place = function (box, el, solid) {
    if (!el || !el.isConnected) { box.style.display = "none"; return; }
    var r = el.getBoundingClientRect();
    box.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;border-radius:4px;" +
      "left:" + (r.left - 2) + "px;top:" + (r.top - 2) + "px;width:" + (r.width + 4) + "px;height:" + (r.height + 4) + "px;" +
      "border:2px " + (solid ? "solid " : "dashed ") + color + ";background:color-mix(in srgb, " + color + " " + (solid ? 10 : 6) + "%, transparent)";
  };
  var layer = function () {
    var el = document.createElement("div");
    el.setAttribute("data-rafiq-pick", "");
    root.appendChild(el);
    return el;
  };
  var draw = function () {
    if (!hoverBox) hoverBox = layer();
    if (on && hover && !marks.some(function (m) { return m.el === hover; })) place(hoverBox, hover, false);
    else hoverBox.style.display = "none";
    marks.forEach(function (m) {
      place(m.box, m.el, true);
      m.badge.textContent = m.n || "";
      m.badge.style.display = m.box.style.display === "none" ? "none" : "block";
      m.badge.style.left = m.box.style.left;
      m.badge.style.top = m.box.style.top;
    });
  };
  var badgeFor = function () {
    var b = layer();
    b.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;transform:translate(-40%,-40%);min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:10px;font:700 12px/20px system-ui,sans-serif;text-align:center;color:#fff;direction:ltr;background:" + color;
    return b;
  };
  var drop = function (m) { m.box.remove(); m.badge.remove(); };
  var pickable = function (el) {
    return el && el.nodeType === 1 && el !== root && el !== document.body && !el.hasAttribute("data-rafiq-pick") ? el : null;
  };
  var selector = function (el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== root) {
      if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) { parts.unshift("#" + CSS.escape(el.id)); break; }
      var part = el.tagName.toLowerCase();
      var cls = [].slice.call(el.classList, 0, 2).filter(function (c) { return /^[a-zA-Z_-][\\w-]*$/.test(c); });
      if (cls.length) part += "." + cls.join(".");
      var same = el.parentElement ? [].filter.call(el.parentElement.children, function (c) { return c.tagName === el.tagName; }) : [];
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(el) + 1) + ")";
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(" > ");
  };
  var describe = function (el) {
    var html = el.outerHTML.replace(/\\s+/g, " ");
    var section = el.closest("section[id], [data-page]");
    return {
      selector: selector(el),
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || "").replace(/\\s+/g, " ").trim().slice(0, 160),
      html: html.length > 1400 ? html.slice(0, 1400) + " …" : html,
      section: section ? section.id || section.getAttribute("data-page") : ""
    };
  };
  var setOn = function (value) {
    on = value;
    root.toggleAttribute("data-rafiq-picking", on);
    root.style.cursor = on ? "crosshair" : "";
    if (!on) hover = null;
    draw();
  };
  var block = function (e) { if (!on) return; e.preventDefault(); e.stopPropagation(); };
  ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "submit", "touchstart"].forEach(function (type) { addEventListener(type, block, true); });
  addEventListener("click", function (e) {
    if (!on) return;
    e.preventDefault(); e.stopPropagation();
    var el = pickable(e.target);
    if (!el) return;
    var known = marks.filter(function (m) { return m.el === el; })[0];
    if (known) {
      marks = marks.filter(function (m) { return m !== known; });
      drop(known);
      draw();
      return post({ type: "unpicked", uid: known.uid });
    }
    var mark = { uid: next++, el: el, n: 0, box: layer(), badge: badgeFor() };
    marks.push(mark);
    draw();
    post({ type: "picked", uid: mark.uid, info: describe(el) });
  }, true);
  addEventListener("mouseover", function (e) { if (!on) return; var el = pickable(e.target); if (el) { hover = el; draw(); } }, true);
  addEventListener("keydown", function (e) { if (on && e.key === "Escape") { setOn(false); post({ type: "pick-cancel" }); } }, true);
  addEventListener("scroll", function () { if (marks.length || hover) draw(); }, { capture: true, passive: true });
  addEventListener("resize", draw);
  addEventListener("message", function (e) {
    var d = e.data || {};
    if (e.source !== parent || d.source !== "rafiq-host") return;
    if (d.color) color = d.color;
    if (d.type === "pick") setOn(!!d.on);
    if (d.type === "marks") {
      var keep = {};
      (d.marks || []).forEach(function (m) { keep[m.uid] = m.n; });
      marks = marks.filter(function (m) { if (keep[m.uid] === undefined) { drop(m); return false; } m.n = keep[m.uid]; return true; });
      draw();
    }
    if (d.type === "clear") { marks.forEach(drop); marks = []; setOn(false); }
    if (d.type === "flash") {
      // The user is on this part's note: bring it into view and pulse its box and number.
      var m = marks.filter(function (x) { return x.uid === d.uid; })[0];
      if (!m || !m.el.isConnected) return;
      var r = m.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) m.el.scrollIntoView({ block: "center", behavior: "smooth" });
      if (m.box.animate) {
        m.box.animate([{ boxShadow: "0 0 0 0 " + color }, { boxShadow: "0 0 0 12px transparent" }], { duration: 700, easing: "cubic-bezier(.16,1,.3,1)" });
        m.badge.animate([{ transform: "translate(-40%,-40%) scale(1)" }, { transform: "translate(-40%,-40%) scale(1.45)" }, { transform: "translate(-40%,-40%) scale(1)" }], { duration: 450, easing: "cubic-bezier(.16,1,.3,1)" });
      }
    }
  });
})();`;

/**
 * Two versions side by side scroll together: each frame says how far down it is (as a share
 * of what it can scroll), and the app moves the other one there (`scroll-to`).
 */
const SYNC_RUNTIME = `(function () {
  var quiet = false;
  var doc = function () { return document.scrollingElement || document.documentElement; };
  addEventListener("scroll", function () {
    if (quiet) { quiet = false; return; }
    var max = doc().scrollHeight - innerHeight;
    parent.postMessage({ source: "rafiq-preview", type: "scrolled", r: max > 0 ? scrollY / max : 0 }, "*");
  }, { passive: true });
  addEventListener("message", function (e) {
    var d = e.data || {};
    if (e.source !== parent || d.source !== "rafiq-host" || d.type !== "scroll-to") return;
    quiet = true;
    scrollTo(0, d.r * (doc().scrollHeight - innerHeight));
  });
})();`;

export function guarded(html: string): string {
  const end = "</" + "script>";
  return `${html}
<script>${PREVIEW_RUNTIME}${end}
<script>${PICK_RUNTIME}${end}
<script>${SYNC_RUNTIME}${end}`;
}

/** What the frame says about a part the user picked. */
export interface PickedPart {
  selector: string;
  tag: string;
  text: string;
  html: string;
  section: string;
}

type HostMessage =
  | { type: "pick"; on: boolean }
  | { type: "marks"; marks: { uid: number; n: number }[] }
  | { type: "clear" }
  | { type: "flash"; uid: number }
  | { type: "scroll-to"; r: number };

/** Tell a design frame something: picking on or off, the marks it keeps, clear, scroll. */
export function tellFrame(frame: HTMLIFrameElement | null | undefined, message: HostMessage) {
  if (!frame?.contentWindow) return;
  const color = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  frame.contentWindow.postMessage({ source: "rafiq-host", ...message, color: color || undefined }, "*");
}
