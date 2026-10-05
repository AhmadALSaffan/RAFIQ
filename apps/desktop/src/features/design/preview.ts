/** Rendering a design's HTML safely inside the app (the preview, and history's compare). */

/**
 * The preview is a `srcdoc` document, so it inherits the app's URL as its base: the design's
 * own links (`#contact`, `about.html`) would load the app — or nothing — into the frame
 * instead of the design's page. This runtime keeps navigation inside the design: `#id` links
 * move within the document (hashchange included, for designs that route on it), links to
 * another page jump to the section with that name, web links open in the browser, and forms
 * don't navigate. It also keeps the webview's own menu (with Inspect) out of the frame.
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

export function guarded(html: string): string {
  return `${html}
<script>${PREVIEW_RUNTIME}<\/script>`; // eslint-disable-line no-useless-escape
}
