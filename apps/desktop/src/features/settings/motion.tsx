/**
 * Settings for motion projects: the brand kit (the app's and each workspace's), who reads
 * the voice-overs, the keys for media services, the model that looks at frames for models
 * that can't, and FFmpeg for the extra video formats.
 *
 * Keys go straight to Windows Credential Manager through the agent; this page only ever
 * learns whether one is set.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ffmpegStatus,
  getMotionKit,
  installFfmpeg,
  installLocalModel,
  listModels,
  localModels,
  listWorkspaces,
  motionKitTemplates,
  motionMediaKeys,
  removeFfmpeg,
  removeLocalModel,
  saveMotionKit,
  saveMotionMediaKey,
  type FfmpegStatus,
  type LocalPack,
  type LocalPackName,
} from "../../lib/api";
import type { AppSettings, LlmModel, Workspace } from "../../lib/types";
import type { BrandKit, Scene } from "../motion/engine/types";
import { contrastRatio, hexToRgb, relLuminance } from "../motion/engine/brand";
import { ScenePlayer } from "../motion/ScenePlayer";
import { Button } from "../../components/ui";
import { Card, Hint, Section, SelectRow } from "./controls";
import { t } from "../../i18n";

type Persist = (next: AppSettings) => void;

const COLOR_ROLES: { role: string; label: string }[] = [
  { role: "surface", label: t("الخلفية") },
  { role: "surface2", label: t("خلفية البطاقات") },
  { role: "onSurface", label: t("النص") },
  { role: "muted", label: t("النص الثانوي") },
  { role: "primary", label: t("اللون الأساسي") },
  { role: "onPrimary", label: t("النص فوق الأساسي") },
  { role: "accent", label: t("لون التمييز") },
];

/** The pairs that carry text, and the contrast each needs — the same rule the agent checks. */
const TEXT_PAIRS: [string, string, number][] = [
  ["onSurface", "surface", 4.5],
  ["onSurface", "surface2", 4.5],
  ["onPrimary", "primary", 4.5],
  ["muted", "surface", 3],
];

const PERSONALITIES: { id: string; label: string; motion: BrandKit["motion"] }[] = [
  { id: "calm", label: t("هادية"), motion: { personality: "calm", enter: 0.5, exit: 0.35, ease: "outExpo" } },
  { id: "energetic", label: t("نشيطة"), motion: { personality: "energetic", enter: 0.4, exit: 0.25, ease: "outBack" } },
];

const TEMPLATE_LABELS: Record<string, string> = { dark: t("داكن"), light: t("فاتح"), neon: t("نيون"), warm: t("دافئ") };

const HEX = /^#[0-9a-f]{6}$/i;

function contrastProblems(kit: BrandKit): string[] {
  const label = (role: string) => COLOR_ROLES.find((c) => c.role === role)?.label ?? role;
  const out: string[] = [];
  for (const [fg, bg, need] of TEXT_PAIRS) {
    const a = kit.colors[fg];
    const b = kit.colors[bg];
    if (!HEX.test(a ?? "") || !HEX.test(b ?? "")) continue;
    const ratio = contrastRatio(relLuminance(hexToRgb(a)), relLuminance(hexToRgb(b)));
    if (ratio < need) out.push(t("«{fg}» على «{bg}» تباينه {ratio}:1 — بده {need}:1 على الأقل", { fg: label(fg), bg: label(bg), ratio: ratio.toFixed(1), need: String(need) }));
  }
  return out;
}

/** A few seconds that show the kit doing its job: a title, a line, a button, a mark. */
function previewScene(): Scene {
  return {
    version: 1,
    title: "kit",
    brand: "workspace",
    assets: {},
    audio: [],
    composition: { width: 1920, height: 1080, fps: 30, duration: 3, background: "brand.surface", safeArea: "none", direction: "rtl" },
    layers: [
      { id: "card", type: "shape", shape: "rect", fill: "brand.surface2", radius: 2, start: 0, end: 3, layout: { anchor: "center", width: 200, height: 100 } },
      { id: "title", type: "text", text: t("هوية رفيق"), style: "display", start: 0, end: 3, layout: { anchor: "center", y: -18 }, animate: [{ preset: "fadeUp", at: 0.1 }] },
      { id: "line", type: "text", text: t("كل فيديو بنفس الألوان والخطوط"), style: "title", color: "brand.muted", start: 0, end: 3, layout: { below: "title", gap: 3 }, animate: [{ preset: "fadeUp", at: 0.3 }] },
      {
        id: "button",
        type: "text",
        text: t("ابدأ"),
        style: "title",
        color: "brand.onPrimary",
        background: { color: "brand.primary", padding: 3, radius: 3 },
        start: 0,
        end: 3,
        layout: { below: "line", gap: 5 },
        animate: [{ preset: "pop", at: 0.6 }],
      },
      { id: "mark", type: "shape", shape: "star", fill: "brand.accent", points: 5, start: 0, end: 3, layout: { anchor: "center", width: 14, height: 14, x: 80, y: -34 }, animate: [{ preset: "scaleIn", at: 0.8 }] },
    ],
  } as unknown as Scene;
}

function BrandKitEditor() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [scope, setScope] = useState("");
  const [templates, setTemplates] = useState<Record<string, BrandKit>>({});
  const [fonts, setFonts] = useState<string[]>([]);
  const [own, setOwn] = useState(false);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(1.5);
  const [playing, setPlaying] = useState(false);
  const scene = useMemo(previewScene, []);

  useEffect(() => {
    motionKitTemplates()
      .then((r) => {
        setTemplates(r.templates);
        setFonts(r.fonts);
      })
      .catch(() => undefined);
    listWorkspaces()
      .then(setWorkspaces)
      .catch(() => setWorkspaces([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setKit(null);
    setError(null);
    getMotionKit(scope || null)
      .then((r) => {
        if (!alive) return;
        setKit(r.kit);
        setOwn(r.own);
        setSaved(JSON.stringify(r.kit));
      })
      .catch((e: unknown) => alive && setError(String(e instanceof Error ? e.message : e)));
    return () => {
      alive = false;
    };
  }, [scope]);

  const problems = kit ? contrastProblems(kit) : [];
  const badHex = kit ? COLOR_ROLES.some(({ role }) => !HEX.test(kit.colors[role] ?? "")) : false;
  const dirty = kit ? JSON.stringify(kit) !== saved : false;

  function setColor(role: string, value: string) {
    if (kit) setKit({ ...kit, colors: { ...kit.colors, [role]: value } });
  }

  async function save(next: BrandKit | null) {
    setBusy(true);
    setError(null);
    try {
      const r = await saveMotionKit(next, scope || null);
      setKit(r.kit);
      setOwn(r.own);
      setSaved(JSON.stringify(r.kit));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t("هوية الفيديوهات")}>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("لمين الهوية")}</p>
            <Hint>{t("الألوان والخطوط الوحيدة اللي بيستعملها رفيق بالفيديوهات. كل مساحة عمل بتقدر يكون إلها هوية خاصة، وإلا بتاخد هوية التطبيق.")}</Hint>
          </div>
          <select value={scope} onChange={(e) => setScope(e.currentTarget.value)} className="input max-w-52 shrink-0 py-1.5 text-sm" aria-label={t("لمين الهوية")}>
            <option value="">{t("التطبيق كله")}</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        {scope && kit && !own && (
          <p className="mt-2 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {t("هالمساحة عم تاخد هوية التطبيق. أي تعديل هون بيعطيها هوية خاصة فيها.")}
          </p>
        )}
      </Card>

      {!kit && !error && <div className="shimmer h-64 rounded-2xl" />}

      {kit && (
        <Card>
          <div
            className="relative aspect-video w-full overflow-hidden rounded-xl"
            style={{ background: "var(--color-surface-2)" }}
            onMouseEnter={() => setPlaying(true)}
            onMouseLeave={() => setPlaying(false)}
          >
            <ScenePlayer scene={scene} kit={kit} time={time} playing={playing} loop maxSide={640} onTime={setTime} className="h-full w-full" />
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {t("مرّر الماوس فوق المعاينة لتشوف الحركة.")}
          </p>

          <p className="mb-1.5 mt-4 text-sm font-medium">{t("ابدأ من قالب")}</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(templates).map(([name, tpl]) => (
              <button
                key={name}
                onClick={() => setKit({ ...tpl, name: kit.name && kit.name !== tpl.name ? kit.name : tpl.name })}
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
                style={{ borderColor: "var(--color-border)" }}
              >
                <span className="flex">
                  {["surface", "primary", "accent"].map((role) => (
                    <span key={role} className="-ms-1 h-3.5 w-3.5 rounded-full border first:ms-0" style={{ background: tpl.colors[role], borderColor: "var(--color-border)" }} />
                  ))}
                </span>
                {TEMPLATE_LABELS[name] ?? name}
              </button>
            ))}
          </div>

          <p className="mb-1.5 mt-4 text-sm font-medium">{t("الألوان")}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {COLOR_ROLES.map(({ role, label }) => {
              const value = kit.colors[role] ?? "";
              return (
                <label key={role} className="flex items-center gap-2 rounded-xl px-2 py-1.5" style={{ background: "var(--color-surface-2)" }}>
                  <input
                    type="color"
                    value={HEX.test(value) ? value : "#000000"}
                    onChange={(e) => setColor(role, e.currentTarget.value)}
                    className="h-7 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                    aria-label={label}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
                  <input
                    value={value}
                    onChange={(e) => setColor(role, e.currentTarget.value.trim())}
                    className="input w-24 py-1 font-mono text-xs"
                    dir="ltr"
                    spellCheck={false}
                    aria-invalid={!HEX.test(value)}
                    style={!HEX.test(value) ? { borderColor: "var(--color-danger)" } : undefined}
                  />
                </label>
              );
            })}
          </div>

          <p className="mb-1.5 mt-4 text-sm font-medium">{t("الخطوط")}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(
              [
                ["display", t("العناوين")],
                ["body", t("النص")],
                ["latin", t("الإنجليزي")],
              ] as const
            ).map(([role, label]) => (
              <label key={role} className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {label}
                <select
                  value={kit.fonts[role]}
                  onChange={(e) => setKit({ ...kit, fonts: { ...kit.fonts, [role]: e.currentTarget.value } })}
                  className="input py-1.5 text-sm"
                  style={{ fontFamily: `"${kit.fonts[role]}"` }}
                >
                  {fonts.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <p className="mb-1.5 mt-4 text-sm font-medium">{t("طبع الحركة")}</p>
          <div className="flex gap-1 rounded-full p-1" style={{ background: "var(--color-surface-2)" }} role="radiogroup" aria-label={t("طبع الحركة")}>
            {PERSONALITIES.map((p) => {
              const active = kit.motion.personality === p.id;
              return (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setKit({ ...kit, motion: { ...kit.motion, ...p.motion } })}
                  className="flex-1 rounded-full px-3 py-1.5 text-xs"
                  style={{ background: active ? "var(--color-inverse)" : undefined, color: active ? "var(--color-on-inverse)" : "var(--color-ink-muted)" }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {problems.length > 0 && (
            <ul className="mt-3 list-disc ps-5 text-xs leading-relaxed" style={{ color: "var(--color-danger)" }}>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {error && (
            <p className="mt-3 text-xs" style={{ color: "var(--color-danger)" }} dir="auto">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="accent" onClick={() => void save(kit)} disabled={busy || !dirty || problems.length > 0 || badHex}>
              {t("احفظ الهوية")}
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setKit(JSON.parse(saved) as BrandKit)} disabled={busy}>
                {t("تراجع")}
              </Button>
            )}
            {own && (
              <Button variant="ghost" onClick={() => void save(null)} disabled={busy}>
                {scope ? t("رجّعها لهوية التطبيق") : t("رجّع الافتراضي")}
              </Button>
            )}
          </div>
        </Card>
      )}
      {!kit && error && (
        <Card danger>
          <p className="text-xs" dir="auto">
            {error}
          </p>
        </Card>
      )}
    </Section>
  );
}

const TTS: { id: AppSettings["tts_provider"]; label: string; hint: string }[] = [
  { id: "none", label: t("بلا صوت"), hint: t("رفيق ما بيقرأ تعليق صوتي — بتقدر ترفع ملف صوت جاهز.") },
  { id: "openai", label: "OpenAI", hint: t("بيستعمل مفتاح موديل OpenAI اللي ضايفه.") },
  { id: "elevenlabs", label: "ElevenLabs", hint: t("أصوات طبيعية بالعربي — بده مفتاح ElevenLabs.") },
  { id: "azure", label: "Azure", hint: t("Azure Speech — بده مفتاح ومنطقة.") },
  { id: "local", label: t("محلي"), hint: t("صوت عربي على جهازك، بيشتغل بدون نت — نزّله من «مودلات على جهازك» تحت.") },
];

const KEY_ROWS: { name: string; label: string; hint: string; secret: boolean; when?: AppSettings["tts_provider"] }[] = [
  { name: "elevenlabs", label: t("مفتاح ElevenLabs"), hint: "elevenlabs.io → Profile → API keys", secret: true, when: "elevenlabs" },
  { name: "azure_speech", label: t("مفتاح Azure Speech"), hint: "portal.azure.com → Speech service → Keys", secret: true, when: "azure" },
  { name: "azure_speech_region", label: t("منطقة Azure Speech"), hint: "westeurope, eastus, …", secret: false, when: "azure" },
  { name: "unsplash", label: t("مفتاح Unsplash"), hint: t("صور مجانية للفيديوهات — unsplash.com/developers"), secret: true },
  { name: "pexels", label: t("مفتاح Pexels"), hint: t("صور وفيديوهات مجانية — pexels.com/api"), secret: true },
];

function KeyRow({ name, label, hint, secret, isSet, onSaved }: { name: string; label: string; hint: string; secret: boolean; isSet: boolean; onSaved: (keys: Record<string, boolean>) => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(value: string | null) {
    setBusy(true);
    try {
      onSaved(await saveMotionMediaKey(name, value));
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {isSet && (
          <span className="text-[11px] font-medium" style={{ color: "var(--color-success)" }}>
            {t("محفوظ")}
          </span>
        )}
      </div>
      <Hint>
        <span dir="auto">{hint}</span>
      </Hint>
      <div className="mt-2 flex items-center gap-2">
        <input
          type={secret ? "password" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder={isSet ? t("محفوظ — اكتب واحد جديد لتبدّله") : t("الصق هون")}
          className="input min-w-0 flex-1"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
        />
        <Button onClick={() => void save(draft)} disabled={busy || !draft.trim()}>
          {t("احفظ")}
        </Button>
        {isSet && (
          <Button variant="ghost" onClick={() => void save(null)} disabled={busy}>
            {t("احذف")}
          </Button>
        )}
      </div>
    </Card>
  );
}

function VoiceAndMedia({ settings, persist, models, localVoice }: { settings: AppSettings; persist: Persist; models: LlmModel[]; localVoice: boolean }) {
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [voice, setVoice] = useState(settings.tts_voice ?? "");
  const provider = settings.tts_provider ?? "none";

  useEffect(() => {
    motionMediaKeys()
      .then(setKeys)
      .catch(() => setKeys({}));
  }, []);

  const hasOpenAi = models.some((m) => m.provider === "openai" && m.has_key);

  return (
    <Section title={t("الصوت والصور")}>
      <Card>
        <p className="text-sm font-medium">{t("مين بيقرأ التعليق الصوتي")}</p>
        <Hint>{t("لما تطلب من رفيق تعليق صوتي لفيديو. كل طلب بيستأذنك قبل ما يروح للخدمة (صلاحية «الصوت والصور»).")}</Hint>
        <div className="mt-3 flex flex-wrap gap-1 rounded-full p-1" style={{ background: "var(--color-surface-2)" }} role="radiogroup" aria-label={t("مين بيقرأ التعليق الصوتي")}>
          {TTS.map((option) => {
            const active = option.id === provider;
            const unavailable = option.id === "local" && !localVoice && !active;
            return (
              <button
                key={option.id}
                role="radio"
                aria-checked={active}
                disabled={unavailable}
                title={unavailable ? t("نزّل الصوت المحلي أول") : undefined}
                onClick={() => persist({ ...settings, tts_provider: option.id })}
                className="flex-1 rounded-full px-3 py-1.5 text-xs disabled:opacity-40"
                style={{ background: active ? "var(--color-inverse)" : undefined, color: active ? "var(--color-on-inverse)" : "var(--color-ink-muted)" }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
          {TTS.find((x) => x.id === provider)?.hint}
          {provider === "openai" && !hasOpenAi && <span style={{ color: "var(--color-danger)" }}> {t("ما في موديل OpenAI بمفتاح لسا.")}</span>}
          {provider === "local" && !localVoice && <span style={{ color: "var(--color-danger)" }}> {t("الصوت المحلي مش منزّل.")}</span>}
        </p>
        {provider !== "none" && provider !== "local" && (
          <label className="mt-3 flex items-center gap-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            <span className="shrink-0">{t("الصوت")}</span>
            <input
              value={voice}
              onChange={(e) => setVoice(e.currentTarget.value)}
              onBlur={() => voice.trim() !== (settings.tts_voice ?? "") && persist({ ...settings, tts_voice: voice.trim() || null })}
              placeholder={provider === "openai" ? "alloy, nova, onyx…" : provider === "azure" ? "ar-SA-HamedNeural" : "Voice ID"}
              className="input min-w-0 flex-1 py-1 text-sm"
              dir="ltr"
            />
          </label>
        )}
      </Card>
      {KEY_ROWS.filter((row) => !row.when || row.when === provider).map((row) => (
        <KeyRow key={row.name} {...row} isSet={!!keys[row.name]} onSaved={setKeys} />
      ))}
    </Section>
  );
}

const sizeMb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

type Progress = { state: string; done?: number; total?: number };

function DownloadProgress({ progress }: { progress: Progress }) {
  return (
    <div className="w-full">
      <div className="flex justify-between text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
        <span>{progress.state === "downloading" ? t("عم ينحمّل…") : progress.state === "unpacking" ? t("عم ينفك…") : t("عم نجرّبه…")}</span>
        {progress.total ? (
          <span dir="ltr">
            {sizeMb(progress.done ?? 0)} / {sizeMb(progress.total)}
          </span>
        ) : null}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--color-surface-2)" }}>
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${progress.total && progress.state === "downloading" ? Math.round(((progress.done ?? 0) / progress.total) * 100) : 100}%`, background: "var(--color-ink)" }}
        />
      </div>
    </div>
  );
}

const RUNNING = ["downloading", "unpacking", "testing"];

const PACK_TEXT: Record<LocalPackName, { title: string; hint: string }> = {
  whisper: {
    title: t("كابشن بدون نت (whisper)"),
    hint: t("بيكتب كلام الفيديو كلمة كلمة على جهازك — الصوت ما بيطلع لأي مكان. لما يكون منزّل، رفيق بيستعمله بدل الخدمات."),
  },
  voice: {
    title: t("صوت عربي بدون نت (Piper)"),
    hint: t("بيقرأ التعليق الصوتي بالعربي على جهازك. اختاره من «مين بيقرأ التعليق الصوتي» فوق."),
  },
};

function LocalModelsSection({ onChange }: { onChange: (packs: Record<LocalPackName, LocalPack>) => void }) {
  const [packs, setPacks] = useState<Record<LocalPackName, LocalPack> | null>(null);

  useEffect(() => {
    if (packs) onChange(packs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packs]);
  const [busy, setBusy] = useState(false);
  const running = !!packs && Object.values(packs).some((p) => RUNNING.includes(p.progress.state));

  useEffect(() => {
    localModels()
      .then(setPacks)
      .catch(() => setPacks(null));
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      localModels()
        .then(setPacks)
        .catch(() => undefined);
    }, 700);
    return () => clearInterval(timer);
  }, [running]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setPacks(await localModels());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t("مودلات على جهازك")}>
      {!packs && <div className="shimmer h-24 rounded-2xl" />}
      {packs &&
        (Object.keys(PACK_TEXT) as LocalPackName[]).map((name) => {
          const pack = packs[name];
          const p = pack.progress;
          const busyHere = RUNNING.includes(p.state);
          return (
            <Card key={name}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{PACK_TEXT[name].title}</p>
                {pack.installed && (
                  <span className="text-[11px] font-medium" style={{ color: "var(--color-success)" }}>
                    {t("منزّل")}
                  </span>
                )}
              </div>
              <Hint>{PACK_TEXT[name].hint}</Hint>
              {/* what gets downloaded, and under which licences — shown before the button */}
              <div className="mt-2 rounded-xl px-3 py-2 text-[11px] leading-relaxed" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
                <p dir="ltr" className="font-mono">
                  {pack.version}
                </p>
                <p className="mt-1">{t("التراخيص:")}</p>
                <ul className="list-disc ps-4" dir="ltr">
                  {pack.licenses.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {busyHere ? (
                  <DownloadProgress progress={p} />
                ) : pack.installed ? (
                  <Button variant="ghost" onClick={() => void act(() => removeLocalModel(name))} disabled={busy}>
                    {t("احذفه")}
                  </Button>
                ) : (
                  <>
                    <Button onClick={() => void act(() => installLocalModel(name))} disabled={busy}>
                      {t("نزّله")}
                    </Button>
                    <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                      {sizeMb(pack.download_size)}
                    </span>
                  </>
                )}
              </div>
              {p.state === "failed" && p.error && (
                <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }} dir="auto">
                  {p.error}
                </p>
              )}
            </Card>
          );
        })}
    </Section>
  );
}

function FfmpegCard() {
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const running = !!status && RUNNING.includes(status.progress.state);

  useEffect(() => {
    ffmpegStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      ffmpegStatus()
        .then(setStatus)
        .catch(() => undefined);
    }, 700);
    return () => clearInterval(timer);
  }, [running]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setStatus(await ffmpegStatus());
    } finally {
      setBusy(false);
    }
  }

  const p = status?.progress;
  const encoders = status ? Object.entries(status.encoders).filter(([, ok]) => ok).map(([name]) => name) : [];

  return (
    <Section title="FFmpeg">
      <Card>
        <p className="text-sm font-medium">{t("صيغ فيديو إضافية")}</p>
        <Hint>{t("التصدير العادي (MP4) ما بده شي. FFmpeg بيضيف H.265 لما الجهاز ما بيدعمه لحاله، وبيفتح فيديوهات بصيغ صعبة (ProRes وMKV و10-bit) بنسخة عمل — نسخة LGPL رسمية، بتنحمّل لما تطلبها ومنتأكد من بصمتها قبل ما تنستعمل.")}</Hint>
        {!status && <div className="shimmer mt-3 h-8 rounded-lg" />}
        {status && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {status.installed ? (
              <>
                <span className="text-xs font-medium" style={{ color: "var(--color-success)" }}>
                  {t("مثبّت")}
                </span>
                <code className="md-inline text-[11px]" dir="ltr">
                  {status.version}
                </code>
                <span className="flex-1" />
                <Button variant="ghost" onClick={() => void act(removeFfmpeg)} disabled={busy}>
                  {t("احذفه")}
                </Button>
              </>
            ) : running ? (
              <DownloadProgress progress={status.progress} />
            ) : (
              <>
                <Button onClick={() => void act(installFfmpeg)} disabled={busy}>
                  {t("نزّل FFmpeg")}
                </Button>
                <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                  {sizeMb(status.download_size)}
                </span>
              </>
            )}
          </div>
        )}
        {p?.state === "failed" && p.error && (
          <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }} dir="auto">
            {p.error}
          </p>
        )}
        {status?.installed && encoders.length > 0 && (
          <p className="mt-2 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {t("المشفّرات اللي اشتغلت على جهازك:")}{" "}
            <span className="font-mono" dir="ltr">
              {encoders.join(", ")}
            </span>
          </p>
        )}
      </Card>
    </Section>
  );
}

export function MotionSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const [models, setModels] = useState<LlmModel[]>([]);
  const [localVoice, setLocalVoice] = useState(false);

  useEffect(() => {
    listModels()
      .then((all) => setModels(all.filter((m) => m.verify_ok !== false)))
      .catch(() => setModels([]));
  }, []);

  return (
    <>
      <BrandKitEditor />
      <VoiceAndMedia settings={settings} persist={persist} models={models} localVoice={localVoice} />
      <Section title={t("النظر بالصور")}>
        <SelectRow
          label={t("موديل بيشوف الإطارات")}
          hint={t("لما موديل المحادثة ما بيقدر يشوف صور، رفيق بيبعت إطارات الفيديو لهالموديل ليوصفها، وبيرجّع الوصف للمحادثة.")}
          value={settings.vision_model_id ?? ""}
          options={[{ value: "", label: t("ولا واحد") }, ...models.map((m) => ({ value: m.id, label: m.name }))]}
          onChange={(id) => persist({ ...settings, vision_model_id: id || null })}
        />
      </Section>
      <LocalModelsSection onChange={(packs) => setLocalVoice(packs.voice.installed)} />
      <FfmpegCard />
    </>
  );
}
