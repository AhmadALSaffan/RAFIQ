/**
 * The visual identity a design is made with, built by the user before the model draws
 * anything — like a design system: colours by role, fonts, corner shape, depth, density,
 * motion and theme, seen live on a sample page. Saved identities start any number of
 * designs; the model gets the identity as tokens it must use (core/identity.py).
 */

import { useEffect, useMemo, useState } from "react";
import { deleteIdentity, identityOptions, listIdentities, saveIdentity } from "../../lib/api";
import type { DesignIdentity, IdentityData, IdentityOptions, IdentityProposal, IdentityRole, LlmModel } from "../../lib/types";
import { Button } from "../../components/ui";
import { PencilIcon, PlusIcon, SparkIcon, TrashIcon } from "../../components/Icons";
import { FontPicker } from "./FontPicker";
import { IdentityFromReferences } from "./IdentityFromReferences";
import { t } from "../../i18n";
import { notify } from "../../lib/toast";
import { ExpandableCard } from "../../components/arc/expandable-card/expandable-card";

const ROLE_LABELS: Record<IdentityRole, string> = {
  background: t("الخلفية"),
  surface: t("السطوح والبطاقات"),
  ink: t("النص"),
  muted: t("النص الخافت"),
  line: t("الخطوط الفاصلة"),
  primary: t("اللون الأساسي"),
  onPrimary: t("النص فوق الأساسي"),
  accent: t("اللون الثاني"),
};

const RADIUS: Record<IdentityData["radius"], [string, string, string]> = { sharp: ["0px", "2px", "4px"], soft: ["8px", "14px", "22px"], round: ["14px", "24px", "36px"] };
const SHADOW: Record<IdentityData["shadow"], string> = {
  none: "none",
  soft: "0 1px 2px color-mix(in srgb, var(--ink) 6%, transparent), 0 24px 60px -28px color-mix(in srgb, var(--ink) 28%, transparent)",
  hard: "6px 6px 0 var(--ink)",
};
const DENSITY: Record<IdentityData["density"], [string, string]> = { airy: ["72px", "18px"], balanced: ["52px", "17px"], compact: ["36px", "16px"] };
const MOTION: Record<IdentityData["motion"], [string, string]> = {
  calm: ["0.9s", "cubic-bezier(.22, 1, .36, 1)"],
  medium: ["0.7s", "cubic-bezier(.16, 1, .3, 1)"],
  cinematic: ["0.9s", "cubic-bezier(.34, 1.4, .64, 1)"],
};

// ── colour helpers (the same derivation as the agent's) ──────────────────────────────────

function mix(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((x, i) => Math.round(x + (pb[i] - x) * k).toString(16).padStart(2, "0")).join("");
}

export function deriveDark(c: Record<IdentityRole, string>): Record<IdentityRole, string> {
  const ink = c.ink.slice(0, 7);
  const bg = c.background.slice(0, 7);
  return { background: mix(ink, "#000000", 0.35), surface: mix(ink, bg, 0.08), ink: bg, muted: mix(bg, ink, 0.4), line: `${bg}1f`, primary: c.primary, onPrimary: c.onPrimary, accent: c.accent };
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a.slice(0, 7)), luminance(b.slice(0, 7))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ── the identity as CSS, and a page that shows it ────────────────────────────────────────

function fontsLink(d: IdentityData, weights: Record<string, string>): string {
  const names = [...new Set([d.fonts.display, d.fonts.body, d.fonts.latin])];
  return `https://fonts.googleapis.com/css2?${names.map((n) => `family=${n.replace(/ /g, "+")}:wght@${weights[n] ?? "400;700"}`).join("&")}&display=swap`;
}

function palette(c: Record<IdentityRole, string>): string {
  return Object.entries(c)
    .map(([k, v]) => `--${k === "onPrimary" ? "on-primary" : k}: ${v};`)
    .join(" ");
}

function previewHtml(d: IdentityData, weights: Record<string, string>, dark: boolean): string {
  const [r1, r2, r3] = RADIUS[d.radius];
  const [section, text] = DENSITY[d.density];
  const [speed, ease] = MOTION[d.motion];
  const colors = dark && d.dark ? d.dark : d.colors;
  const name = d.logo || d.name || t("هويتك");
  const swatches = (Object.keys(ROLE_LABELS) as IdentityRole[])
    .map((role) => `<div class="sw"><i style="background:${colors[role]}"></i><b>${ROLE_LABELS[role]}</b><span class="latin">${colors[role]}</span></div>`)
    .join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><link href="${fontsLink(d, weights)}" rel="stylesheet"><style>
:root { ${palette(colors)} --display: "${d.fonts.display}", "${d.fonts.body}", sans-serif; --body: "${d.fonts.body}", sans-serif; --latin: "${d.fonts.latin}", sans-serif;
  --r-sm: ${r1}; --r-md: ${r2}; --r-lg: ${r3}; --pill: ${d.radius === "sharp" ? "4px" : "999px"}; --shadow: ${SHADOW[d.shadow]}; --section: ${section}; --text: ${text}; --speed: ${speed}; --ease: ${ease}; }
* { box-sizing: border-box; margin: 0 }
body { background: var(--background); color: var(--ink); font: 400 var(--text)/1.75 var(--body); padding: 28px 32px 48px; -webkit-font-smoothing: antialiased }
.latin { font-family: var(--latin); direction: ltr; unicode-bidi: isolate }
nav { display: flex; align-items: center; gap: 20px; padding: 10px 12px 10px 18px; border-radius: var(--pill); background: var(--surface); box-shadow: 0 0 0 1px var(--line) }
nav b { font: 700 20px var(--display) } nav span { color: var(--muted); font-size: 14px } nav .btn { margin-inline-start: auto; height: 38px; font-size: 14px }
.hero { padding-block: var(--section) calc(var(--section) * .6) }
h1 { font: 700 clamp(40px, 6vw, 76px)/1.08 var(--display); margin-block: 14px 16px; animation: rise var(--speed) var(--ease) both }
h1 em { font-style: normal; color: var(--primary) }
.hero p { color: var(--muted); max-width: 36ch; animation: rise var(--speed) var(--ease) .12s both }
.row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; animation: rise var(--speed) var(--ease) .24s both }
.btn { display: inline-flex; align-items: center; height: 50px; padding-inline: 24px; border-radius: var(--pill); font: 600 15px var(--body); border: 0; cursor: pointer; transition: transform var(--speed) var(--ease), box-shadow .3s }
.btn.main { background: var(--primary); color: var(--on-primary); box-shadow: var(--shadow) } .btn.ghost { background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink) }
.btn:hover { transform: translateY(-2px) }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px }
.card { background: var(--surface); border-radius: var(--r-lg); padding: 22px; box-shadow: 0 0 0 1px var(--line), var(--shadow); transition: transform var(--speed) var(--ease) }
.card:hover { transform: translateY(-5px) }
.card .ic { width: 40px; height: 40px; border-radius: var(--r-md); display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); margin-bottom: 14px }
.card h3 { font: 600 19px/1.35 var(--display) } .card p { color: var(--muted); font-size: 14px; margin-top: 6px }
.card .num { font: 700 38px/1 var(--latin); color: var(--primary) }
.form { display: flex; gap: 10px; margin-top: 14px; align-items: center }
.form input { flex: 1; height: 48px; border-radius: var(--r-md); border: 1px solid var(--line); background: var(--surface); padding-inline: 16px; font: inherit; color: var(--ink) }
.chip { padding: 5px 12px; border-radius: var(--pill); background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--ink); font-size: 13px }
h2 { font: 700 13px var(--latin); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin: 36px 0 14px }
.swatches { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px }
.sw { display: flex; flex-direction: column; gap: 4px; font-size: 12px } .sw i { height: 46px; border-radius: var(--r-md); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 12%, transparent) }
.sw span { color: var(--muted); font-size: 11px }
.type div { display: flex; align-items: baseline; gap: 16px; padding-block: 8px; border-bottom: 1px solid var(--line) } .type small { width: 70px; color: var(--muted); font: 12px var(--latin) }
@keyframes rise { from { opacity: 0; transform: translateY(16px) } }
@media (max-width: 640px) { .cards, .swatches { grid-template-columns: 1fr 1fr } }
</style></head><body>
<nav><b>${name}</b><span>${t("المزايا")}</span><span>${t("الأسعار")}</span><button class="btn main">${t("ابدأ الآن")}</button></nav>
<section class="hero"><h1>${t("هيك بتبين")} <em>${t("هويتك")}</em>.</h1>
<p>${t("هاد مثال بيوريك الألوان والخطوط والزوايا والظلال والحركة اللي اخترتها — التصميم الحقيقي رح يكون بتكوين خاص فيه.")}</p>
<div class="row"><button class="btn main">${t("الزر الأساسي")}</button><button class="btn ghost">${t("زر ثانوي")}</button></div></section>
<div class="cards"><div class="card"><div class="ic">◆</div><h3>${t("بطاقة ميزة")}</h3><p>${t("سطح، خط فاصل، ظل وزوايا من الهوية.")}</p></div>
<div class="card"><div class="num latin">2,480</div><h3 style="margin-top:8px">${t("رقم مهم")}</h3><p>${t("الأرقام بالخط اللاتيني.")}</p></div>
<div class="card"><span class="chip">${t("وسم")}</span><div class="form"><input placeholder="${t("حقل إدخال")}"></div></div></div>
<h2>Palette</h2><div class="swatches">${swatches}</div>
<h2>Type</h2><div class="type">
<div><small>Display</small><span style="font:700 44px/1.1 var(--display)">${t("عنوان كبير")}</span></div>
<div><small>Body</small><span>${t("نص عادي مريح للقراءة، بسطرين أو تلاتة.")}</span></div>
<div><small>Latin</small><span class="latin" style="font-size:22px">Aa 0123456789</span></div></div>
</body></html>`;
}

// ── the builder ──────────────────────────────────────────────────────────────────────────

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className="rounded-full border px-3 py-1 text-xs transition-colors"
          style={{
            borderColor: value === v ? "var(--color-inverse)" : "var(--color-border)",
            background: value === v ? "var(--color-inverse)" : "transparent",
            color: value === v ? "var(--color-on-inverse)" : "var(--color-ink-muted)",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium" style={{ color: "var(--color-ink-muted)" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function ColorRow({ role, value, onChange }: { role: IdentityRole; value: string; onChange: (v: string) => void }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="color" value={value.slice(0, 7)} onChange={(e) => onChange(e.currentTarget.value + value.slice(7))} className="h-7 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
      <span className="min-w-0 flex-1 truncate">{ROLE_LABELS[role]}</span>
      <input
        value={hex}
        onChange={(e) => {
          const v = e.currentTarget.value.trim();
          setHex(v);
          if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) onChange(v.toLowerCase());
        }}
        className="input h-7 w-[6.75rem] font-mono text-[11px]"
        dir="ltr"
      />
    </label>
  );
}

export function IdentityBuilder({
  options,
  initial,
  onSave,
  onCancel,
  saving,
  proposal,
}: {
  options: IdentityOptions;
  initial: IdentityData;
  onSave: (data: IdentityData) => void;
  onCancel?: () => void;
  saving?: boolean;
  /** When the model proposed this identity from references: its reasons, and what it read. */
  proposal?: Pick<IdentityProposal, "why" | "references">;
}) {
  const [d, setD] = useState<IdentityData>(initial);
  const [darkTab, setDarkTab] = useState(false);
  const [previewDark, setPreviewDark] = useState(initial.theme === "dark");
  const html = useMemo(() => previewHtml(d, options.weights, previewDark && d.theme === "both"), [d, options.weights, previewDark]);
  const set = <K extends keyof IdentityData>(key: K, value: IdentityData[K]) => setD((prev) => ({ ...prev, [key]: value }));
  const editing = darkTab && d.theme === "both" && d.dark ? d.dark : d.colors;
  const setColor = (role: IdentityRole, v: string) =>
    setD((prev) => (darkTab && prev.theme === "both" && prev.dark ? { ...prev, dark: { ...prev.dark, [role]: v } } : { ...prev, colors: { ...prev.colors, [role]: v } }));

  function applyStyle(key: string) {
    const style = options.styles.find((s) => s.key === key);
    if (!style) return;
    setD((prev) => ({ ...style.preset, name: prev.name, logo: prev.logo, voice: prev.voice, dark: style.preset.theme === "both" ? deriveDark(style.preset.colors) : undefined }));
  }

  const warnings: string[] = [];
  if (contrast(editing.ink, editing.background) < 4.5) warnings.push(t("النص على الخلفية ضعيف التباين"));
  if (contrast(editing.onPrimary, editing.primary) < 4.5) warnings.push(t("النص فوق اللون الأساسي ضعيف التباين"));

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="flex min-h-0 w-full flex-col border-b md:w-[340px] md:border-b-0 md:border-e" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {proposal && (
          <ExpandableCard
            title={t("اقتراح النموذج — عدّل اللي بدك")}
            description={proposal.references.some((r) => !r.ok) ? t("في مراجع ما انقرأت") : t("ليش اختار هيك؟")}
            defaultExpanded
          >
          <div className="flex flex-col gap-1.5 text-xs leading-relaxed">
            {proposal.why && (
              <p className="whitespace-pre-line" style={{ color: "var(--color-ink-muted)" }} dir="auto">
                {proposal.why}
              </p>
            )}
            {proposal.references
              .filter((r) => !r.ok)
              .map((r) => (
                <p key={r.label} style={{ color: "var(--color-danger)" }} dir="auto">
                  {t("ما انقرأ: {0} — {1}", { 0: r.label, 1: r.error })}
                </p>
              ))}
          </div>
          </ExpandableCard>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Row label={t("اسم الهوية")}>
            <input value={d.name} onChange={(e) => set("name", e.currentTarget.value)} className="input w-full" dir="auto" />
          </Row>
          <Row label={t("اسم المنتج / الشعار")}>
            <input value={d.logo} onChange={(e) => set("logo", e.currentTarget.value)} className="input w-full" dir="auto" placeholder={t("اختياري")} />
          </Row>
        </div>

        <Row label={t("ابدأ من أسلوب (وعدّل كل شي بعدين)")}>
          <div className="flex flex-wrap gap-1.5">
            {options.styles.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => applyStyle(s.key)}
                className="flex items-center gap-1.5 rounded-full border py-1 pe-3 ps-1 text-xs transition-colors"
                style={{ borderColor: d.style === s.key ? "var(--color-inverse)" : "var(--color-border)", background: d.style === s.key ? "var(--color-surface-2)" : "transparent" }}
              >
                <span className="flex overflow-hidden rounded-full">
                  {[s.preset.colors.background, s.preset.colors.primary, s.preset.colors.accent].map((c) => (
                    <i key={c} className="block h-4 w-2.5" style={{ background: c }} />
                  ))}
                </span>
                {s.label}
              </button>
            ))}
          </div>
        </Row>

        <Row label={t("السمة")}>
          <Segmented
            value={d.theme}
            options={[["light", t("فاتحة")], ["dark", t("داكنة")], ["both", t("الاثنين مع زر تبديل")]]}
            onChange={(v) => {
              setD((prev) => ({ ...prev, theme: v, dark: v === "both" ? prev.dark ?? deriveDark(prev.colors) : undefined }));
              setPreviewDark(v === "dark");
              if (v !== "both") setDarkTab(false);
            }}
          />
        </Row>

        <Row label={t("الألوان")}>
          {d.theme === "both" && (
            <Segmented
              value={darkTab ? "dark" : "light"}
              options={[["light", t("ألوان الفاتح")], ["dark", t("ألوان الداكن")]]}
              onChange={(v) => {
                setDarkTab(v === "dark");
                setPreviewDark(v === "dark");
              }}
            />
          )}
          <div className="flex flex-col gap-1.5">
            {(Object.keys(ROLE_LABELS) as IdentityRole[]).map((role) => (
              <ColorRow key={role} role={role} value={editing[role]} onChange={(v) => setColor(role, v)} />
            ))}
          </div>
          {warnings.map((w) => (
            <p key={w} className="text-xs" style={{ color: "var(--color-danger)" }}>
              {w}
            </p>
          ))}
        </Row>

        <Row label={t("الخطوط")}>
          {(
            [
              ["display", t("العناوين")],
              ["body", t("النص")],
              ["latin", t("اللاتيني والأرقام")],
            ] as const
          ).map(([slot, label]) => (
            <FontPicker
              key={slot}
              label={label}
              value={d.fonts[slot]}
              fonts={options.fonts}
              arabicFirst={slot !== "latin"}
              onChange={(name) => set("fonts", { ...d.fonts, [slot]: name })}
            />
          ))}
          <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {t("{0} خط من Google Fonts. خط العناوين إذا ما فيه عربي، الحروف العربية بتطلع بخط النص.", { 0: options.fonts.length })}
          </p>
        </Row>

        <Row label={t("الزوايا")}>
          <Segmented value={d.radius} options={[["sharp", t("حادة")], ["soft", t("ناعمة")], ["round", t("دائرية")]]} onChange={(v) => set("radius", v)} />
        </Row>
        <Row label={t("الظلال")}>
          <Segmented value={d.shadow} options={[["none", t("بدون")], ["soft", t("ناعمة")], ["hard", t("صلبة")]]} onChange={(v) => set("shadow", v)} />
        </Row>
        <Row label={t("المسافات")}>
          <Segmented value={d.density} options={[["airy", t("واسعة")], ["balanced", t("متوازنة")], ["compact", t("مضغوطة")]]} onChange={(v) => set("density", v)} />
        </Row>
        <Row label={t("الحركة")}>
          <Segmented value={d.motion} options={[["calm", t("هادية")], ["medium", t("متوسطة")], ["cinematic", t("سينمائية")]]} onChange={(v) => set("motion", v)} />
        </Row>
        <Row label={t("صوت الهوية وملاحظاتك (اختياري)")}>
          <textarea
            value={d.voice}
            onChange={(e) => set("voice", e.currentTarget.value)}
            rows={3}
            className="input w-full resize-none py-2"
            dir="auto"
            placeholder={t("مثلاً: نبرة ودودة وواثقة، بدون صور أشخاص، ركّز على الأرقام")}
          />
        </Row>

      </div>
        <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              {t("رجوع")}
            </Button>
          )}
          <Button variant="accent" disabled={saving || !d.name.trim()} onClick={() => onSave(d)}>
            {saving ? t("عم يحفظ…") : t("احفظ وكمّل")}
          </Button>
        </div>
      </div>

      <div className="relative min-h-[320px] min-w-0 flex-1" style={{ background: "var(--color-surface-2)" }}>
        {d.theme === "both" && (
          <button
            type="button"
            onClick={() => setPreviewDark((v) => !v)}
            className="absolute end-3 top-3 z-10 rounded-full border px-3 py-1 text-xs"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            {previewDark ? t("شوف الفاتح") : t("شوف الداكن")}
          </button>
        )}
        <iframe title={t("معاينة الهوية")} srcDoc={html} sandbox="" className="h-full w-full border-0" />
      </div>
    </div>
  );
}

/** A saved identity as a card: its colours and its name. */
function IdentityCard({ identity, selected, onPick, onEdit, onDelete }: { identity: DesignIdentity; selected: boolean; onPick: () => void; onEdit: () => void; onDelete: () => void }) {
  const c = identity.data.colors;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick()}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border transition-shadow"
      style={{ borderColor: selected ? "var(--color-inverse)" : "var(--color-border)", boxShadow: selected ? "0 0 0 1px var(--color-inverse)" : undefined }}
    >
      <div className="flex h-20 items-end gap-1.5 p-3" style={{ background: c.background }}>
        <span className="rounded-md px-2 py-1 text-xs font-bold" style={{ background: c.primary, color: c.onPrimary }}>
          Aa
        </span>
        {[c.ink, c.accent, c.surface].map((color, i) => (
          <i key={i} className="block h-5 w-5 rounded-full" style={{ background: color, boxShadow: "0 0 0 1px rgba(127,127,127,.25)" }} />
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" dir="auto">
            {identity.name}
          </p>
          <p className="truncate text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
            {identity.data.fonts.display} · {identity.data.fonts.body}
          </p>
        </div>
        <button type="button" onClick={(e) => (e.stopPropagation(), onEdit())} aria-label={t("عدّل")} title={t("عدّل")} className="rounded-full p-1.5 opacity-60 hover:bg-[var(--color-surface-2)] hover:opacity-100">
          <PencilIcon className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={(e) => (e.stopPropagation(), onDelete())} aria-label={t("احذف")} title={t("احذف")} className="rounded-full p-1.5 opacity-60 hover:bg-[var(--color-surface-2)] hover:opacity-100">
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Step one of a new design: pick a saved identity or build one. `onPick` hands the chosen
 * identity up; the design is made with a copy of it.
 */
export function IdentityStep({
  workspaceId,
  models,
  modelId,
  selected,
  onPick,
  onNext,
}: {
  workspaceId: string | null;
  /** The models that can propose an identity from references, and the one picked so far. */
  models: LlmModel[];
  modelId: string;
  selected: DesignIdentity | null;
  onPick: (identity: DesignIdentity | null) => void;
  /** On to the product questions (after a pick, or right after saving a new one). */
  onNext: () => void;
}) {
  const [options, setOptions] = useState<IdentityOptions | null>(null);
  const [saved, setSaved] = useState<DesignIdentity[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; data: IdentityData; proposal?: Pick<IdentityProposal, "why" | "references"> } | null>(null);
  const [fromRefs, setFromRefs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([identityOptions(), listIdentities(workspaceId)])
      .then(([opts, list]) => {
        setOptions(opts);
        setSaved(list);
      })
      .catch(() => setError(t("ما قدرت أجيب الهويات")));
  }, [workspaceId]);

  function fresh(opts: IdentityOptions): IdentityData {
    const first = opts.styles[0];
    return { ...first.preset, name: t("هوية جديدة"), logo: "", voice: "" };
  }

  async function save(data: IdentityData) {
    setSaving(true);
    setError(null);
    try {
      const row = await saveIdentity(data, editing?.id, workspaceId);
      notify({ type: "success", title: t("انحفظت الهوية"), description: row.name });
      setSaved((prev) => [row, ...(prev ?? []).filter((x) => x.id !== row.id)]);
      setEditing(null);
      onPick(row);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما قدرت أحفظ الهوية"));
    } finally {
      setSaving(false);
    }
  }

  if (error && !options) return <p className="p-6 text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>;
  if (!options || !saved) return <p className="p-6 text-sm" style={{ color: "var(--color-ink-muted)" }}>{t("عم يحمّل…")}</p>;
  if (editing)
    return (
      <>
        {error && <p className="px-5 pt-3 text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <IdentityBuilder
          key={editing.id ?? (editing.proposal ? "proposed" : "new")}
          options={options}
          initial={editing.data}
          proposal={editing.proposal}
          saving={saving}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      </>
    );
  if (fromRefs)
    return (
      <IdentityFromReferences
        models={models}
        modelId={modelId}
        onCancel={() => setFromRefs(false)}
        onProposal={(p) => {
          setFromRefs(false);
          setEditing({ id: null, data: { ...p.data, voice: p.data.voice ?? "", logo: p.data.logo ?? "" }, proposal: { why: p.why, references: p.references } });
        }}
      />
    );
  return (
    <>
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <p className="mb-4 text-sm" style={{ color: "var(--color-ink-muted)" }}>
        {t("التصميم رح يستعمل هالهوية بالضبط: ألوانها وخطوطها وأشكالها. اختار وحدة أو ابنِ وحدة جديدة.")}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => setEditing({ id: null, data: fresh(options) })}
          className="flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-sm transition-colors hover:bg-[var(--color-surface-2)]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
        >
          <PlusIcon className="h-5 w-5" />
          {t("هوية جديدة")}
        </button>
        <button
          type="button"
          onClick={() => setFromRefs(true)}
          disabled={models.length === 0}
          className="flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-3 text-center text-sm transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
        >
          <SparkIcon className="h-5 w-5" />
          {t("من تصاميم عجبتك")}
          <span className="text-[11px]">{t("روابط أو لقطات شاشة، والنموذج بيقرر")}</span>
        </button>
        {saved.map((identity) => (
          <IdentityCard
            key={identity.id}
            identity={identity}
            selected={selected?.id === identity.id}
            onPick={() => onPick(identity)}
            onEdit={() => setEditing({ id: identity.id, data: identity.data })}
            onDelete={() => {
              void deleteIdentity(identity.id);
              setSaved((prev) => (prev ?? []).filter((x) => x.id !== identity.id));
              if (selected?.id === identity.id) onPick(null);
            }}
          />
        ))}
      </div>
    </div>
    <footer className="flex items-center justify-between gap-3 border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
      <span className="truncate text-xs" style={{ color: "var(--color-ink-muted)" }} dir="auto">
        {selected ? t("الهوية: {0}", { 0: selected.name }) : t("اختار هوية أو احفظ وحدة جديدة")}
      </span>
      <Button variant="accent" disabled={!selected} onClick={onNext}>
        {t("التالي")}
      </Button>
    </footer>
    </>
  );
}
