/**
 * MCP servers: a catalogue of ready-made ones the user just connects (a token, a folder,
 * or a sign-in page — never a command line), plus a custom form for anything else.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { connectMcpServer, deleteMcpServer, listMcpServers, logoutMcpServer, mcpRequirements, saveMcpServer, testMcpServer } from "../../lib/api";
import { MCP_CATEGORY_LABEL, MCP_PRESETS, presetById, REQUIREMENT_LABEL, REQUIREMENT_URL, type McpPreset } from "../../lib/mcpCatalog";
import type { McpRequirements, McpServer, McpServerInput } from "../../lib/types";
import { openExternal } from "../../lib/links";
import { easeOutExpo, listContainer, listItem, snappy } from "../../lib/motion";
import { Button, Reveal } from "../../components/ui";
import { AlertIcon, ExternalIcon, PlusIcon, SpinnerIcon, TrashIcon, XIcon } from "../../components/Icons";
import { McpLogo } from "../../components/McpLogo";
import { FolderPicker } from "../../components/FolderPicker";
import { Card, Hint, Section, Switch } from "./controls";
import { t } from "../../i18n";

// ── Custom-server draft ─────────────────────────────────────────────────────────────────

type Draft = {
  id?: string;
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  url: string;
  secrets: { key: string; value: string; saved: boolean }[];
  enabled: boolean;
};

const EMPTY: Draft = { name: "", transport: "stdio", command: "", args: "", url: "", secrets: [], enabled: true };

function splitArgs(raw: string): string[] {
  return [...raw.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

function joinArgs(args: string[]): string {
  return args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}

function toDraft(server: McpServer): Draft {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command ?? "",
    args: joinArgs(server.args),
    url: server.url ?? "",
    secrets: server.secret_keys.map((key) => ({ key, value: "", saved: true })),
    enabled: server.enabled,
  };
}

function toInput(draft: Draft): McpServerInput {
  const pairs = Object.fromEntries(draft.secrets.filter((s) => s.key.trim()).map((s) => [s.key.trim(), s.value]));
  return {
    name: draft.name.trim(),
    transport: draft.transport,
    command: draft.transport === "stdio" ? draft.command.trim() : null,
    args: draft.transport === "stdio" ? splitArgs(draft.args) : [],
    url: draft.transport === "http" ? draft.url.trim() : null,
    env: draft.transport === "stdio" ? pairs : {},
    headers: draft.transport === "http" ? pairs : {},
    enabled: draft.enabled,
    auth: "none",
    preset: null,
  };
}

/** What a preset becomes once the user filled its blanks. */
function presetInput(preset: McpPreset, values: Record<string, string>, param: string, enabled = true): McpServerInput {
  const args = preset.args ? splitArgs(preset.args).map((a) => (a === "{param}" ? param.trim() : a)) : [];
  const pairs = Object.fromEntries((preset.secrets ?? []).map((s) => [s.key, values[s.key] ?? ""]));
  return {
    name: preset.name,
    transport: preset.transport,
    command: preset.transport === "stdio" ? (preset.command ?? "") : null,
    args,
    url: preset.transport === "http" ? (preset.url ?? "") : null,
    env: preset.transport === "stdio" ? pairs : {},
    headers: preset.transport === "http" ? pairs : {},
    enabled,
    auth: preset.auth === "oauth" ? "oauth" : "none",
    preset: preset.id,
  };
}

/** The value a preset's `{param}` currently has on a saved server. */
function paramOf(preset: McpPreset, server: McpServer): string {
  if (!preset.args) return "";
  const index = splitArgs(preset.args).indexOf("{param}");
  return index >= 0 ? (server.args[index] ?? "") : "";
}

// ── Catalogue ───────────────────────────────────────────────────────────────────────────

function PresetPicker({ requirements, installed, onPick, onClose }: { requirements: McpRequirements | null; installed: Set<string>; onPick: (preset: McpPreset | null) => void; onClose: () => void }) {
  const groups = (Object.keys(MCP_CATEGORY_LABEL) as McpPreset["category"][]).map((c) => ({ c, items: MCP_PRESETS.filter((p) => p.category === c) })).filter((g) => g.items.length);
  const missing = requirements ? (Object.keys(REQUIREMENT_LABEL) as (keyof McpRequirements)[]).filter((k) => k !== "python" && k !== "node" && !requirements[k]) : [];
  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("اختار خادم")}</p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("بتشبّكه بضغطة: يا بتسجّل دخول بالمتصفح، يا بتلصق توكن، يا ولا شي. الأمر والرابط رفيق بيهتم فيهم.")}
          </p>
        </div>
        <button onClick={onClose} aria-label={t("إغلاق")} className="rounded-lg p-1 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
          <XIcon className="h-4 w-4" />
        </button>
      </div>
      {missing.length > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}>
          <AlertIcon className="h-3.5 w-3.5 shrink-0" />
          {t("مش منزّل على جهازك:")}
          {missing.map((k) => (
            <a key={k} href={REQUIREMENT_URL[k]} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 underline underline-offset-2">
              {REQUIREMENT_LABEL[k]}
              <ExternalIcon className="h-3 w-3" />
            </a>
          ))}
          {t("— الخوادم اللي بتحتاجه معلّمة تحت.")}
        </p>
      )}
      <div className="flex flex-col gap-4">
        {groups.map(({ c, items }) => (
          <div key={c}>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--color-ink-muted)" }}>
              {MCP_CATEGORY_LABEL[c]}
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => {
                const lacks = p.needs && requirements ? !requirements[p.needs] : false;
                const have = installed.has(p.id);
                return (
                  <motion.button
                    key={p.id}
                    type="button"
                    whileHover={{ y: -1 }}
                    onClick={() => onPick(p)}
                    className="flex items-start gap-3 rounded-xl border px-3 py-2.5 text-start transition-colors hover:border-[var(--color-accent)]"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", opacity: have ? 0.6 : 1 }}
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--color-surface-2)" }}>
                      <McpLogo preset={p.id} className="h-4.5 w-4.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium">{p.name}</span>
                        <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
                          {p.auth === "oauth" ? t("تسجيل دخول") : p.auth === "token" ? t("توكن") : t("بدون مفتاح")}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                        {p.blurb}
                      </span>
                      {have && (
                        <span className="mt-0.5 block text-[11px]" style={{ color: "var(--color-success)" }}>
                          {t("مضاف")}
                        </span>
                      )}
                      {lacks && p.needs && (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: "var(--color-danger)" }}>
                          <AlertIcon className="h-3 w-3" />
                          {t("بدو {0}", { 0: REQUIREMENT_LABEL[p.needs] })}
                        </span>
                      )}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
        <motion.button
          type="button"
          whileHover={{ y: -1 }}
          onClick={() => onPick(null)}
          className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-start text-sm"
          style={{ borderColor: "var(--color-border)" }}
        >
          <PlusIcon className="h-4 w-4" style={{ color: "var(--color-accent)" }} />
          <span>
            <span className="block font-medium">{t("مخصص")}</span>
            <span className="block text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {t("أي خادم تاني — اكتب الأمر أو الرابط بإيدك.")}
            </span>
          </span>
        </motion.button>
      </div>
    </Card>
  );
}

// ── Connecting a preset ─────────────────────────────────────────────────────────────────

type Stage = "form" | "saving" | "browser" | "testing" | "done" | "failed";

function PresetConnect({
  preset,
  existing,
  onClose,
  onDone,
}: {
  preset: McpPreset;
  /** Re-connecting an already saved server (new token, new folder…). */
  existing?: McpServer;
  onClose: () => void;
  onDone: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [param, setParam] = useState(existing ? paramOf(preset, existing) : "");
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<number | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const secretsFilled = (preset.secrets ?? []).every((s) => (values[s.key] ?? "").trim() || existing?.secret_keys.includes(s.key));
  const paramFilled = !preset.param || param.trim();

  async function watch(id: string) {
    // The browser step finishes on its own; watch the server until it connects or fails.
    for (let i = 0; i < 200 && alive.current; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const server = (await listMcpServers().catch(() => [])).find((s) => s.id === id);
      if (!server) return;
      if (server.status.connected) {
        setTools(server.status.tools.length);
        setStage("done");
        return;
      }
      if (server.status.error) {
        setError(server.status.error);
        setStage("failed");
        return;
      }
    }
  }

  async function connect() {
    setStage("saving");
    setError(null);
    try {
      const saved = await saveMcpServer(presetInput(preset, values, param, existing?.enabled ?? true), existing?.id);
      if (preset.auth === "oauth") {
        const res = await connectMcpServer(saved.id);
        if (res.authorize_url) {
          setStage("browser");
          void openExternal(res.authorize_url);
          await watch(saved.id);
          return;
        }
        if (res.connected) {
          setStage("done");
          return;
        }
        throw new Error(res.error ?? t("ما قدرت أتصل بالخادم"));
      }
      setStage("testing");
      const tested = await testMcpServer(saved.id);
      setTools(tested.status.tools.length);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("failed");
    }
  }

  const busy = stage === "saving" || stage === "browser" || stage === "testing";

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--color-surface-2)" }}>
          <McpLogo preset={preset.id} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            {preset.name}
            <a href={preset.docs} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-[11px] font-normal underline-offset-2 hover:underline" style={{ color: "var(--color-ink-muted)" }}>
              {t("التوثيق")}
              <ExternalIcon className="h-3 w-3" />
            </a>
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {preset.blurb}
          </p>
        </div>
        <button onClick={onClose} aria-label={t("إغلاق")} className="rounded-lg p-1 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {stage === "form" || stage === "failed" || stage === "saving" ? (
        <div className="mt-3 flex flex-col gap-3">
          {preset.note && <Hint>{preset.note}</Hint>}
          {preset.auth === "oauth" && (
            <Hint>{t("بيفتح صفحة تسجيل دخول {0} بمتصفحك. لما توافق، بيرجع لرفيق لحاله — ما في توكن تنسخه.", { 0: preset.name })}</Hint>
          )}
          {(preset.secrets ?? []).map((field) => (
            <label key={field.key} className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-xs font-medium">
                {field.label}
                {field.url && (
                  <a href={field.url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 font-normal underline-offset-2 hover:underline" style={{ color: "var(--color-accent)" }}>
                    {t("أنشئ واحد")}
                    <ExternalIcon className="h-3 w-3" />
                  </a>
                )}
              </span>
              <input
                type="password"
                value={values[field.key] ?? ""}
                onChange={(e) => setValues({ ...values, [field.key]: e.currentTarget.value })}
                placeholder={existing?.secret_keys.includes(field.key) ? t("محفوظ — اتركه فاضي ليضل") : ""}
                className="input font-mono text-xs"
                dir="ltr"
                autoComplete="off"
              />
              {field.help && (
                <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                  {field.help}
                </span>
              )}
            </label>
          ))}
          {preset.param && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">{preset.param.label}</span>
              {preset.param.kind === "folder" ? (
                <FolderPicker value={param} onChange={setParam} />
              ) : (
                <input value={param} onChange={(e) => setParam(e.currentTarget.value)} placeholder={preset.param.placeholder} className="input font-mono text-xs" dir="ltr" />
              )}
              {preset.param.help && (
                <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                  {preset.param.help}
                </span>
              )}
            </div>
          )}
          {error && (
            <p className="flex items-start gap-1.5 text-xs" style={{ color: "var(--color-danger)" }}>
              <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("إلغاء")}
            </Button>
            <Button onClick={() => void connect()} disabled={busy || !secretsFilled || !paramFilled}>
              {stage === "saving" ? <SpinnerIcon className="h-4 w-4" /> : null}
              {preset.auth === "oauth" ? t("سجّل دخول وشبّك") : t("شبّك")}
            </Button>
          </div>
        </div>
      ) : stage === "browser" ? (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-dashed px-3 py-3 text-sm" style={{ borderColor: "var(--color-border)" }}>
          <SpinnerIcon className="h-4 w-4 shrink-0" style={{ color: "var(--color-accent)" }} />
          <span>
            {t("كمّل تسجيل الدخول بالمتصفح…")}
            <span className="block text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {t("ما انفتح شي؟")}{" "}
              <button onClick={() => void connect()} className="underline underline-offset-2">
                {t("جرّب من جديد")}
              </button>
            </span>
          </span>
        </div>
      ) : stage === "testing" ? (
        <p className="mt-3 flex items-center gap-2 text-sm">
          <SpinnerIcon className="h-4 w-4" style={{ color: "var(--color-accent)" }} />
          {t("عم يتصل…")}
        </p>
      ) : (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm font-medium" style={{ color: "var(--color-success)" }}>
            {tools !== null ? t("اتصل ✓ — {0} أداة صارت جاهزة", { 0: tools }) : t("اتصل ✓")}
          </p>
          <Button onClick={onDone}>{t("تمام")}</Button>
        </motion.div>
      )}
    </Card>
  );
}

// ── The section ─────────────────────────────────────────────────────────────────────────

export function McpSettings() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [connecting, setConnecting] = useState<{ preset: McpPreset; existing?: McpServer } | null>(null);
  const [requirements, setRequirements] = useState<McpRequirements | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = () =>
    listMcpServers()
      .then(setServers)
      .catch(() => setServers([]));
  useEffect(() => {
    void load();
    mcpRequirements()
      .then(setRequirements)
      .catch(() => setRequirements(null));
  }, []);

  async function test(id: string) {
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const updated = await testMcpServer(id);
      setServers((list) => list.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy("form");
    try {
      const saved = await saveMcpServer(toInput(draft), draft.id);
      setDraft(null);
      await load();
      void test(saved.id);
    } catch (err) {
      setErrors((e) => ({ ...e, form: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(server: McpServer, enabled: boolean) {
    const preset = presetById(server.preset);
    const input: McpServerInput = preset
      ? { ...presetInput(preset, {}, paramOf(preset, server), enabled), env: Object.fromEntries(server.secret_keys.map((k) => [k, ""])), headers: {} }
      : toInput({ ...toDraft(server), enabled });
    if (preset && preset.transport === "http") {
      input.headers = Object.fromEntries(server.secret_keys.map((k) => [k, ""]));
      input.env = {};
    }
    const updated = await saveMcpServer(input, server.id);
    setServers((list) => list.map((s) => (s.id === server.id ? updated : s)));
  }

  async function remove(id: string) {
    setServers((list) => list.filter((s) => s.id !== id));
    await deleteMcpServer(id).catch(() => load());
  }

  async function logout(server: McpServer) {
    const updated = await logoutMcpServer(server.id).catch(() => server);
    setServers((list) => list.map((s) => (s.id === server.id ? updated : s)));
  }

  const installed = new Set(servers.map((s) => s.preset).filter((p): p is string => Boolean(p)));
  const editing = draft !== null || picking || connecting !== null;

  return (
    <Section
      title={t("خوادم MCP")}
      action={
        !editing && (
          <Button onClick={() => setPicking(true)}>
            <PlusIcon className="h-3.5 w-3.5" />
            {t("أضف خادم")}
          </Button>
        )
      }
    >
      <Hint>
        {t("اربط خدماتك (GitHub، Notion، Linear، قواعد بيانات…) وأدواتها بتصير متاحة للوكيل بالمحادثات والمهام، وكل استدعاء بيمرّ من صلاحية «أدوات MCP». التوكنات وتسجيلات الدخول بتنحفظ بـ Windows Credential Manager.")}
      </Hint>

      <Reveal open={picking}>
        {picking && (
          <PresetPicker
            requirements={requirements}
            installed={installed}
            onClose={() => setPicking(false)}
            onPick={(preset) => {
              setPicking(false);
              if (preset) setConnecting({ preset, existing: servers.find((s) => s.preset === preset.id) });
              else setDraft({ ...EMPTY });
            }}
          />
        )}
      </Reveal>

      <Reveal open={connecting !== null}>
        {connecting && (
          <PresetConnect
            key={connecting.preset.id + (connecting.existing?.id ?? "")}
            preset={connecting.preset}
            existing={connecting.existing}
            onClose={() => {
              setConnecting(null);
              void load();
            }}
            onDone={() => {
              setConnecting(null);
              void load();
            }}
          />
        )}
      </Reveal>

      <Reveal open={draft !== null}>
        {draft && (
          <Card>
            <div className="flex flex-col gap-2.5">
              <div className="flex gap-2">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
                  placeholder={t("اسم الخادم (مثلاً: github)")}
                  className="input min-w-0 flex-1"
                  dir="auto"
                />
                <div className="flex rounded-lg p-0.5" style={{ background: "var(--color-surface-2)" }}>
                  {(["stdio", "http"] as const).map((kind) => (
                    <button
                      key={kind}
                      onClick={() => setDraft({ ...draft, transport: kind })}
                      className="relative rounded-md px-3 py-1 text-xs"
                      style={{ color: draft.transport === kind ? "var(--color-bg)" : "var(--color-ink-muted)" }}
                    >
                      {draft.transport === kind && <motion.span layoutId="mcp-transport" className="absolute inset-0 rounded-md" style={{ background: "var(--color-accent)" }} transition={snappy} />}
                      <span className="relative">{kind === "stdio" ? t("أمر محلي") : "HTTP"}</span>
                    </button>
                  ))}
                </div>
              </div>
              {draft.transport === "stdio" ? (
                <>
                  <div className="flex gap-2" dir="ltr">
                    <input value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.currentTarget.value })} placeholder="npx" className="input w-32 font-mono text-xs" />
                    <input
                      value={draft.args}
                      onChange={(e) => setDraft({ ...draft, args: e.currentTarget.value })}
                      placeholder="-y @modelcontextprotocol/server-filesystem C:\Projects"
                      className="input min-w-0 flex-1 font-mono text-xs"
                    />
                  </div>
                  <Hint>{t("الأمر والمعاملات متل ما بتكتبهم بالطرفية. المسافات جوّا معامل حطها بين \" \".")}</Hint>
                </>
              ) : (
                <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.currentTarget.value })} placeholder="https://example.com/mcp" className="input w-full font-mono text-xs" dir="ltr" />
              )}

              <div>
                <p className="text-xs font-medium">{draft.transport === "stdio" ? t("متغيّرات البيئة (سرّية)") : t("ترويسات HTTP (سرّية)")}</p>
                <AnimatePresence initial={false}>
                  {draft.secrets.map((row, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: easeOutExpo }}
                      className="mt-1.5 flex gap-2 overflow-hidden"
                      dir="ltr"
                    >
                      <input
                        value={row.key}
                        onChange={(e) => setDraft({ ...draft, secrets: draft.secrets.map((s, j) => (j === i ? { ...s, key: e.currentTarget.value } : s)) })}
                        placeholder={draft.transport === "stdio" ? "GITHUB_TOKEN" : "Authorization"}
                        className="input w-44 font-mono text-xs"
                      />
                      <input
                        type="password"
                        value={row.value}
                        onChange={(e) => setDraft({ ...draft, secrets: draft.secrets.map((s, j) => (j === i ? { ...s, value: e.currentTarget.value } : s)) })}
                        placeholder={row.saved ? t("محفوظ — اتركه فاضي ليضل") : t("القيمة")}
                        className="input min-w-0 flex-1 font-mono text-xs"
                      />
                      <button
                        onClick={() => setDraft({ ...draft, secrets: draft.secrets.filter((_, j) => j !== i) })}
                        aria-label={t("احذف")}
                        className="rounded-md p-1.5 hover:bg-[var(--color-surface-2)]"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
                <button onClick={() => setDraft({ ...draft, secrets: [...draft.secrets, { key: "", value: "", saved: false }] })} className="mt-1.5 text-xs underline underline-offset-2" style={{ color: "var(--color-accent)" }}>
                  {t("+ أضف قيمة")}
                </button>
              </div>

              {errors.form && (
                <p className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-danger)" }}>
                  <AlertIcon className="h-3.5 w-3.5 shrink-0" />
                  {errors.form}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  {t("إلغاء")}
                </Button>
                <Button onClick={save} disabled={busy === "form" || !draft.name.trim() || (draft.transport === "stdio" ? !draft.command.trim() : !draft.url.trim())}>
                  {busy === "form" ? t("عم يحفظ…") : t("احفظ واختبر")}
                </Button>
              </div>
            </div>
          </Card>
        )}
      </Reveal>

      {servers.length === 0 && !editing && (
        <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("ما في خوادم بعد — اضغط «أضف خادم» واختار من القائمة.")}
        </p>
      )}

      <motion.div variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-2">
        {servers.map((server) => {
          const preset = presetById(server.preset);
          const error = errors[server.id] || server.status.error;
          const needsLogin = server.auth === "oauth" && !server.authorized;
          return (
            <motion.div key={server.id} variants={listItem}>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--color-surface-2)" }}>
                      <McpLogo preset={server.preset} className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: server.status.connected ? "var(--color-success)" : error || needsLogin ? "var(--color-danger)" : "var(--color-border)" }}
                        />
                        <span dir="auto">{server.name}</span>
                        {!preset && (
                          <span className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
                            {server.transport}
                          </span>
                        )}
                      </p>
                      {preset ? (
                        <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                          {preset.blurb}
                        </p>
                      ) : (
                        <p className="mt-0.5 truncate font-mono text-[11px]" dir="ltr" style={{ color: "var(--color-ink-muted)" }}>
                          {server.transport === "stdio" ? `${server.command ?? ""} ${joinArgs(server.args)}` : server.url}
                        </p>
                      )}
                      <p className="mt-1 text-xs" style={{ color: error || needsLogin ? "var(--color-danger)" : "var(--color-ink-muted)" }}>
                        {busy === server.id
                          ? t("عم يتصل…")
                          : needsLogin
                            ? t("لازم تسجّل دخول — اضغط «شبّك».")
                            : error
                              ? error
                              : server.status.connected
                                ? server.status.tools.length >= 2 && server.status.tools.length <= 10
                                  ? t("متصل · {0} أدوات", { 0: server.status.tools.length })
                                  : t("متصل · {0} أداة", { 0: server.status.tools.length })
                                : t("ما اتصل لسا — بيتصل أول ما الوكيل يحتاجه.")}
                      </p>
                      {server.status.connected && server.status.tools.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {server.status.tools.slice(0, 12).map((tool) => (
                            <span key={tool} className="rounded-full border px-2 py-0.5 font-mono text-[10px]" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }} dir="ltr">
                              {tool}
                            </span>
                          ))}
                          {server.status.tools.length > 12 && <span className="text-[10px]" style={{ color: "var(--color-ink-muted)" }}>+{server.status.tools.length - 12}</span>}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {preset ? (
                      <>
                        {needsLogin || preset.auth !== "none" || preset.param ? (
                          <Button variant={needsLogin ? "primary" : "ghost"} onClick={() => setConnecting({ preset, existing: server })}>
                            {needsLogin ? t("شبّك") : preset.auth === "oauth" ? t("أعد الربط") : preset.auth === "token" ? t("غيّر التوكن") : t("عدّل")}
                          </Button>
                        ) : null}
                        {server.auth === "oauth" && server.authorized && (
                          <Button variant="ghost" onClick={() => void logout(server)}>
                            {t("فكّ الربط")}
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button variant="ghost" onClick={() => setDraft(toDraft(server))}>
                        {t("عدّل")}
                      </Button>
                    )}
                    {!needsLogin && (
                      <Button variant="ghost" onClick={() => void test(server.id)} disabled={busy === server.id}>
                        {t("اختبر")}
                      </Button>
                    )}
                    <button onClick={() => void remove(server.id)} aria-label={t("احذف")} className="rounded-md p-1.5 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                    <Switch checked={server.enabled} onChange={(on) => void toggle(server, on)} label={t("مفعّل")} />
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    </Section>
  );
}
