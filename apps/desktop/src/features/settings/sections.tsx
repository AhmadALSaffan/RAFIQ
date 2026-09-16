/**
 * Settings for the agent's reach: tasks and providers, the web and the browser, MCP
 * servers, and running in the background.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  deleteMcpServer,
  getWebSearchKeys,
  listMcpServers,
  listModels,
  saveMcpServer,
  saveWebSearchKey,
  testMcpServer,
} from "../../lib/api";
import { autostartEnabled, setAutostart, syncBackground } from "../../lib/background";
import { easeOutExpo, listContainer, listItem, snappy } from "../../lib/motion";
import type { AppSettings, LlmModel, McpServer, McpServerInput, WebSearchKeys, WebSearchProvider } from "../../lib/types";
import { Button, Reveal } from "../../components/ui";
import { AlertIcon, PlusIcon, TrashIcon } from "../../components/Icons";
import { Card, Hint, Section, SelectRow, SliderRow, Switch, ToggleRow } from "./controls";
import { t } from "../../i18n";

type Persist = (next: AppSettings) => void;

export function TasksSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const [models, setModels] = useState<LlmModel[]>([]);

  useEffect(() => {
    listModels()
      .then((all) => setModels(all.filter((m) => m.verify_ok !== false)))
      .catch(() => setModels([]));
  }, []);

  return (
    <Section title={t("المهام والمزوّدين")}>
      <SelectRow
        label={t("موديل تنفيذ المهام")}
        hint={t("لما الموديل يفتح مهام من المحادثة، بتنفّذها هالموديل. خلّيه موديل أرخص أو أسرع وخلّي المحادثة على الموديل القوي.")}
        value={settings.task_model_id ?? ""}
        options={[
          { value: "", label: t("نفس موديل المحادثة") },
          ...models.map((m) => ({ value: m.id, label: m.name })),
        ]}
        onChange={(id) => persist({ ...settings, task_model_id: id || null })}
      />
      <SliderRow
        label={t("المهام بالتوازي")}
        hint={t("كم مهمة بتشتغل بنفس الوقت. المهام اللي بتعدّل نفس الملفات أو المجلد بتضل تستنى دورها، واللي بتعتمد على غيرها بتبلش لما تخلص.")}
        value={settings.max_parallel_tasks ?? 100}
        min={1}
        max={100}
        lowLabel={t("وحدة ورا التانية")}
        onCommit={(n) => persist({ ...settings, max_parallel_tasks: n })}
      />
      <ToggleRow
        label={t("نسخة git خاصة لكل مهمة")}
        hint={t("لما المجلد مشروع git، كل مهمة بتشتغل بنسخة معزولة (worktree) فبيشتغلوا كلهم مع بعض، وبعدين تغييراتها بتنطبق على مجلدك وبتقدر تراجعها أو ترجّعها من صفحة المهمة.")}
        checked={settings.task_isolation ?? true}
        onChange={(task_isolation) => persist({ ...settings, task_isolation })}
      />
      <SliderRow
        label={t("طلبات متزامنة لكل مفتاح")}
        hint={t("قدّيش طلب بيروح لنفس المزوّد وبنفس المفتاح بنفس الوقت. الباقي بيستنى دوره بدل ما يرجع بخطأ «rate limit»، والطلب اللي بيوقع بسبب الضغط بيتعاد تلقائياً.")}
        value={settings.provider_concurrency ?? 6}
        min={1}
        max={50}
        onCommit={(n) => persist({ ...settings, provider_concurrency: n })}
      />
    </Section>
  );
}

const SEARCH: { id: WebSearchProvider; label: string; hint: string }[] = [
  { id: "none", label: t("مطفي"), hint: t("الوكيل بيقدر يقرأ صفحات بس ما بيدوّر.") },
  { id: "brave", label: "Brave", hint: t("مفتاح مجاني من api-dashboard.search.brave.com") },
  { id: "tavily", label: "Tavily", hint: t("مفتاح مجاني من tavily.com") },
  { id: "searxng", label: "SearXNG", hint: t("خادم SearXNG خاص فيك (لازم يكون مفعّل فيه JSON).") },
];

export function WebSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const [keys, setKeys] = useState<WebSearchKeys | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [url, setUrl] = useState(settings.searxng_url ?? "");
  const [saving, setSaving] = useState(false);
  const provider = settings.web_search_provider ?? "none";

  useEffect(() => {
    getWebSearchKeys()
      .then(setKeys)
      .catch(() => setKeys(null));
  }, []);

  async function saveKey() {
    if (provider !== "brave" && provider !== "tavily") return;
    setSaving(true);
    try {
      setKeys(await saveWebSearchKey(provider, draftKey));
      setDraftKey("");
    } finally {
      setSaving(false);
    }
  }

  const hasKey = provider === "brave" ? keys?.brave : provider === "tavily" ? keys?.tavily : false;

  return (
    <Section title={t("الويب والمتصفح")}>
      <Card>
        <p className="text-sm font-medium">{t("البحث على الويب")}</p>
        <Hint>{t("قراءة الصفحات (web_fetch) شغّالة دايماً. للبحث اختار خدمة رسمية وحط مفتاحها — المفتاح بينحفظ بـ Windows Credential Manager.")}</Hint>
        <div className="mt-3 flex flex-wrap gap-1 rounded-xl p-1" style={{ background: "var(--color-surface-2)" }} role="radiogroup">
          {SEARCH.map((option) => {
            const active = option.id === provider;
            return (
              <button
                key={option.id}
                role="radio"
                aria-checked={active}
                onClick={() => persist({ ...settings, web_search_provider: option.id })}
                className="relative flex-1 rounded-lg px-3 py-1.5 text-xs"
                style={{ color: active ? "var(--color-bg)" : "var(--color-ink-muted)" }}
              >
                {active && <motion.span layoutId="search-provider" className="absolute inset-0 rounded-lg" style={{ background: "var(--color-accent)" }} transition={snappy} />}
                <span className="relative">{option.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
          {SEARCH.find((s) => s.id === provider)?.hint}
        </p>
        {(provider === "brave" || provider === "tavily") && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.currentTarget.value)}
              placeholder={hasKey ? t("المفتاح محفوظ — اكتب واحد جديد لتبدّله") : t("الصق المفتاح هون")}
              className="input min-w-0 flex-1"
              dir="ltr"
            />
            <Button onClick={saveKey} disabled={saving || !draftKey.trim()}>
              {t("احفظ")}
            </Button>
            {hasKey && (
              <Button variant="ghost" onClick={() => void saveWebSearchKey(provider, "").then(setKeys)}>
                {t("احذف")}
              </Button>
            )}
          </div>
        )}
        {provider === "searxng" && (
          <input
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onBlur={() => url !== (settings.searxng_url ?? "") && persist({ ...settings, searxng_url: url.trim() || null })}
            placeholder="https://searx.example.org"
            className="input mt-2 w-full"
            dir="ltr"
          />
        )}
      </Card>
      <ToggleRow
        label={t("اعرض نافذة المتصفح")}
        hint={t("أدوات المتصفح بتشتغل على Microsoft Edge بملف تعريف خاص فيها (ما بتلمس حساباتك). طفّيها ليشتغل مخفي، أو شغّلها لتتفرج عليه وهو عم يشتغل.")}
        checked={settings.browser_visible ?? false}
        onChange={(browser_visible) => persist({ ...settings, browser_visible })}
      />
    </Section>
  );
}

export function BackgroundSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const [autostart, setAutostartState] = useState<boolean | null>(null);

  useEffect(() => {
    autostartEnabled().then(setAutostartState);
  }, []);

  return (
    <Section title={t("التشغيل بالخلفية")}>
      <ToggleRow
        label={t("خلّي رفيق شغّال لما تسكّر النافذة")}
        hint={t("بيضل بجنب الساعة (أيقونة رفيق)، والمهام والمهام المجدولة بتكمل، وبيطلعلك إشعار لما مهمة تخلص أو بدها إذنك. للإنهاء الكامل: كليك يمين على الأيقونة ← إنهاء.")}
        checked={settings.run_in_background ?? true}
        onChange={(run_in_background) => {
          persist({ ...settings, run_in_background });
          void syncBackground(run_in_background);
        }}
      />
      {autostart !== null && (
        <ToggleRow
          label={t("شغّل رفيق مع ويندوز")}
          hint={t("بيفتح مخفي بجنب الساعة، فالمهام المجدولة بتشتغل بوقتها بدون ما تفتحه.")}
          checked={autostart}
          onChange={(on) => void setAutostart(on).then(setAutostartState)}
        />
      )}
    </Section>
  );
}

// ── MCP servers ─────────────────────────────────────────────────────────────────────────

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
  };
}

export function McpSettings() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = () =>
    listMcpServers()
      .then(setServers)
      .catch(() => setServers([]));
  useEffect(() => {
    void load();
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
    const input = toInput({ ...toDraft(server), enabled });
    const updated = await saveMcpServer(input, server.id);
    setServers((list) => list.map((s) => (s.id === server.id ? updated : s)));
  }

  async function remove(id: string) {
    setServers((list) => list.filter((s) => s.id !== id));
    await deleteMcpServer(id).catch(() => load());
  }

  return (
    <Section
      title={t("خوادم MCP")}
      action={
        !draft && (
          <Button variant="ghost" onClick={() => setDraft({ ...EMPTY })}>
            <PlusIcon className="h-3.5 w-3.5" />
            {t("أضف خادم")}
          </Button>
        )
      }
    >
      <Hint>
        {t("اربط أي خادم MCP (قواعد بيانات، Slack، Notion، GitHub…) وأدواته بتصير متاحة للوكيل بالمحادثات والمهام، وكل استدعاء بيمرّ من صلاحية «أدوات MCP». القيم السرّية (توكنات، مفاتيح) بتنحفظ بـ Windows Credential Manager.")}
      </Hint>

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

      <motion.div variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-2">
        {servers.map((server) => {
          const error = errors[server.id] || server.status.error;
          return (
            <motion.div key={server.id} variants={listItem}>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: server.status.connected ? "var(--color-success)" : error ? "var(--color-danger)" : "var(--color-border)" }}
                      />
                      <span dir="auto">{server.name}</span>
                      <span className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
                        {server.transport}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px]" dir="ltr" style={{ color: "var(--color-ink-muted)" }}>
                      {server.transport === "stdio" ? `${server.command ?? ""} ${joinArgs(server.args)}` : server.url}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: error ? "var(--color-danger)" : "var(--color-ink-muted)" }}>
                      {busy === server.id
                        ? t("عم يتصل…")
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
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" onClick={() => void test(server.id)} disabled={busy === server.id}>
                      {t("اختبر")}
                    </Button>
                    <Button variant="ghost" onClick={() => setDraft(toDraft(server))}>
                      {t("عدّل")}
                    </Button>
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
