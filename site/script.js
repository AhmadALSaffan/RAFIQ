// Three small things: reveal-on-scroll, the walkthrough tabs, and the live release info.

(() => {
  // Reveal sections as they enter the viewport (once).
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const targets = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    targets.forEach((el) => io.observe(el));
  }

  // The nav on narrow screens.
  const menuBtn = document.querySelector(".menu-btn");
  const mobileNav = document.getElementById("mobile-nav");
  if (menuBtn && mobileNav) {
    menuBtn.addEventListener("click", () => {
      const open = mobileNav.hidden;
      mobileNav.hidden = !open;
      menuBtn.setAttribute("aria-expanded", String(open));
    });
  }

  // Walkthrough tabs.
  const tabs = [...document.querySelectorAll(".tab")];
  const panels = [...document.querySelectorAll(".tabpanel")];
  function select(i) {
    tabs.forEach((t, j) => {
      t.setAttribute("aria-selected", String(i === j));
      t.tabIndex = i === j ? 0 : -1;
    });
    panels.forEach((p, j) => {
      if (i === j) p.setAttribute("data-active", "");
      else p.removeAttribute("data-active");
    });
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(i));
    t.addEventListener("keydown", (e) => {
      const dir = document.documentElement.dir === "rtl" ? -1 : 1;
      if (e.key === "ArrowRight") select((i + dir + tabs.length) % tabs.length), tabs[(i + dir + tabs.length) % tabs.length].focus();
      if (e.key === "ArrowLeft") select((i - dir + tabs.length) % tabs.length), tabs[(i - dir + tabs.length) % tabs.length].focus();
    });
  });
  if (tabs.length) select(0);

  // The download button points at the latest installer on GitHub; the version label and
  // size come from the same release. Falls back to the releases page if the API is unavailable.
  const REPO = "AhmadALSaffan/RAFIQ";
  const links = document.querySelectorAll("[data-download]");
  const versionEls = document.querySelectorAll("[data-version]");
  const sizeEls = document.querySelectorAll("[data-size]");
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((release) => {
      const asset = (release.assets || []).find((a) => /x64-setup\.exe$/i.test(a.name));
      const version = String(release.tag_name || "").replace(/^v\.?/, "");
      if (asset) links.forEach((a) => (a.href = asset.browser_download_url));
      if (version) versionEls.forEach((el) => (el.textContent = version));
      if (asset && asset.size) sizeEls.forEach((el) => (el.textContent = `${(asset.size / 1048576).toFixed(0)} MB`));
    })
    .catch(() => {
      /* keep the static fallbacks */
    });
})();
