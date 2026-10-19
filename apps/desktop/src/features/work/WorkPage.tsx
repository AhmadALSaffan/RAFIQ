/**
 * "شغلي" — every issue assigned to the user across every connected tracker, plus the pull
 * requests waiting for their review, what the watcher noticed, each tracker's current
 * sprint, and the user's saved views.
 *
 * The list is the index and the panel is the detail; the page owns fetching, filtering,
 * sorting, selection and the board. It's a triage screen, so the keyboard is first-class:
 * ↑/↓ or j/k to move, Enter to open, x to tick, Esc to close, / to search, Ctrl+N for a
 * new issue.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Illustration } from "../../components/Illustration";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  bulkIssues,
  createTask,
  listIntegrations,
  listIssues,
  listModels,
  listNotices,
  listReviewRequests,
  markNoticesRead,
  quietly,
  runSavedView,
  sprintIssues,
} from "../../lib/api";
import type { IntegrationAccount, IssueNotice, LlmModel, TaskMode, TrackerIssue } from "../../lib/types";
import { listContainer } from "../../lib/motion";
import { parseUtc, timeAgo } from "../../lib/time";
import { recentFolders } from "../../lib/folders";
import { queueChatMessage } from "../../lib/handoff";
import { fieldDir } from "../../lib/bidi";
import { notify } from "../../lib/toast";
import { BrandMark } from "../../components/BrandMark";
import { usePageMenu } from "../../components/ContextMenu";
import { AlertIcon, BoardIcon, ListIcon, PlusIcon, RefreshIcon, SearchIcon, XIcon } from "../../components/Icons";
import { Button, EmptyState } from "../../components/ui";
import { IssuePanel } from "./IssuePanel";
import { TOPBAR } from "../../components/Shell";
import { Board } from "./Board";
import { CreateIssue } from "./CreateIssue";
import { Notices } from "./Notices";
import { CATEGORY_LABEL, FilterChip, IssueRow, isOverdue, issueId } from "./pieces";

import { t } from "../../i18n";
type GroupBy = "none" | "provider" | "project" | "status";
type SortBy = "updated" | "priority" | "due";
type Tab = "mine" | "reviews" | "notices" | `sprint:${string}` | `view:${string}:${string}`;

const GROUPS: { id: GroupBy; label: string }[] = [
  { id: "none", label: t("بدون تجميع") },
  { id: "provider", label: t("حسب المنصّة") },
  { id: "project", label: t("حسب المشروع") },
  { id: "status", label: t("حسب الحالة") },
];

const SORTS: { id: SortBy; label: string }[] = [
  { id: "updated", label: t("الأحدث تحديثاً") },
  { id: "priority", label: t("الأهم أولاً") },
  { id: "due", label: t("الأقرب استحقاقاً") },
];

/** Trackers name priorities differently; this is the order a person actually means. */
const PRIORITY_RANK: [RegExp, number][] = [
  [/(highest|urgent|blocker|critical|عاجل)/i, 0],
  [/(high|عالي)/i, 1],
  [/(medium|normal|متوسط)/i, 2],
  [/(low|منخفض)/i, 3],
  [/(lowest|أدنى)/i, 4],
];

function priorityRank(issue: TrackerIssue): number {
  const value = issue.priority ?? "";
  return PRIORITY_RANK.find(([pattern]) => pattern.test(value))?.[1] ?? 2.5;
}

const PAGE = 60;

export function WorkPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [notices, setNotices] = useState<IssueNotice[]>([]);
  const [tab, setTab] = useState<Tab>("mine");
  const [sprintName, setSprintName] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [includeDone, setIncludeDone] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("provider");
  const [sortBy, setSortBy] = useState<SortBy>("updated");
  const [layout, setLayout] = useState<"list" | "board">(() => (localStorage.getItem("rafiq.work.layout") === "board" ? "board" : "list"));
  const [selected, setSelected] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<{ parent: TrackerIssue | null } | null>(null);
  const [asking, setAsking] = useState<{ action: "add_label" | "comment"; value: string } | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();

  // Arriving from the search box (?open=) or its "new issue" command (?new=1).
  useEffect(() => {
    const open = params.get("open");
    const fresh = params.get("new");
    if (!open && !fresh) return;
    if (open) setSelected(open);
    if (fresh) setCreating({ parent: null });
    setParams({}, { replace: true });
  }, [params, setParams]);

  const load = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setRefreshing(true);
      try {
        if (tab === "notices") {
          setNotices(await listNotices({ limit: 100 }));
        } else if (tab === "reviews") {
          setIssues(await listReviewRequests());
        } else if (tab.startsWith("sprint:")) {
          const result = await sprintIssues(tab.slice(7));
          setSprintName(result.name);
          setIssues(result.issues);
        } else if (tab.startsWith("view:")) {
          const [, accountId, viewId] = tab.split(":");
          setIssues(await runSavedView(accountId, viewId));
        } else {
          setIssues(await listIssues("", limit, includeDone));
        }
        setFetchedAt(new Date());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("ما قدرت أجيب المهام"));
        if (tab !== "mine") setIssues([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [includeDone, tab, limit],
  );

  usePageMenu(() => [
    { id: "refresh", label: t("حدّث المهام"), onSelect: () => void load(true) },
    { id: "new", label: t("مهمة جديدة (Ctrl+N)"), onSelect: () => setCreating({ parent: null }) },
    { id: "layout", label: layout === "list" ? t("اعرضها كلوح") : t("اعرضها كقائمة"), onSelect: () => switchLayout(layout === "list" ? "board" : "list") },
    { id: "done", label: includeDone ? t("أخفِ المكتملة") : t("اعرض المكتملة"), onSelect: () => setIncludeDone((v) => !v) },
    { id: "overdue", label: overdueOnly ? t("اعرض الكل") : t("المتأخرة بس"), onSelect: () => setOverdueOnly((v) => !v) },
    {
      id: "clear",
      label: t("امسح البحث والفلاتر"),
      onSelect: () => {
        setSearch("");
        setProviderFilter(null);
        setOverdueOnly(false);
      },
    },
    { id: "accounts", label: t("حسابات الربط"), onSelect: () => navigate("/integrations") },
  ]);

  function switchLayout(next: "list" | "board") {
    setLayout(next);
    try {
      localStorage.setItem("rafiq.work.layout", next);
    } catch {
      // storage unavailable — the choice lasts for this visit
    }
  }

  useEffect(() => {
    listIntegrations().then(setAccounts).catch(() => setAccounts([]));
    listModels().then(setModels).catch(() => setModels([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    setTicked(new Set());
    void load();
    const id = setInterval(() => void quietly(() => load()), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = issues.filter((i) => {
      if (providerFilter && i.provider !== providerFilter) return false;
      if (overdueOnly && !isOverdue(i)) return false;
      if (!q) return true;
      return [i.title, i.key, i.project, i.status, i.assignee, ...(i.labels ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });

    const time = (value: string | null) => (value ? parseUtc(value).getTime() : 0);
    return [...list].sort((a, b) => {
      if (sortBy === "priority") return priorityRank(a) - priorityRank(b) || time(b.updated_at) - time(a.updated_at);
      if (sortBy === "due") {
        const [da, db] = [time(a.due_date) || Infinity, time(b.due_date) || Infinity];
        return da - db || time(b.updated_at) - time(a.updated_at);
      }
      return time(b.updated_at) - time(a.updated_at);
    });
  }, [issues, search, providerFilter, overdueOnly, sortBy]);

  const groups = useMemo(() => {
    if (groupBy === "none") return [{ label: t("الكل ({0})", { 0: filtered.length }), items: filtered }];
    const map = new Map<string, TrackerIssue[]>();
    for (const issue of filtered) {
      const key =
        groupBy === "provider"
          ? issue.integration_name
          : groupBy === "project"
            ? issue.project || t("بدون مشروع")
            : (CATEGORY_LABEL[issue.status_category ?? ""] ?? (issue.status || t("غير محدد")));
      map.set(key, [...(map.get(key) ?? []), issue]);
    }
    return [...map.entries()].map(([label, items]) => ({ label: `${label} (${items.length})`, items }));
  }, [filtered, groupBy]);

  const providers = useMemo(() => [...new Set(issues.map((i) => i.provider))], [issues]);
  const overdueCount = useMemo(() => issues.filter(isOverdue).length, [issues]);
  const connected = accounts.filter((a) => a.verify_ok !== false);
  const current = filtered.find((i) => issueId(i) === selected) ?? null;
  const unread = notices.filter((n) => !n.read_at).length;
  const tickedIssues = filtered.filter((i) => ticked.has(issueId(i)));
  const listTab = tab !== "notices";

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Triage without the mouse.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = (event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setCreating({ parent: null });
        return;
      }
      if (event.key === "Escape") {
        if (selected) return setSelected(null);
        if (ticked.size) return setTicked(new Set());
      }
      if (typing) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "x" && selected) {
        toggle(selected);
        return;
      }
      const down = event.key === "ArrowDown" || event.key === "j";
      const up = event.key === "ArrowUp" || event.key === "k";
      if (!down && !up) return;
      if (filtered.length === 0) return;
      event.preventDefault();
      const index = filtered.findIndex((i) => issueId(i) === selected);
      const next = down ? index + 1 : index - 1;
      const target = filtered[(next + filtered.length) % filtered.length];
      setSelected(issueId(target));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selected, ticked]);

  async function bulk(action: Parameters<typeof bulkIssues>[1], value?: string) {
    const items = tickedIssues.map((i) => ({ integration_id: i.integration_id, key: i.key }));
    try {
      const results = await bulkIssues(items, action, value);
      const failed = results.filter((r) => !r.ok);
      notify({
        type: failed.length ? "warning" : "success",
        title: t("{0} من {1} زبطت", { 0: results.length - failed.length, 1: results.length }),
        description: failed.slice(0, 3).map((f) => `${f.key}: ${f.message}`).join("\n") || undefined,
      });
      setTicked(new Set());
      void load();
    } catch (err) {
      notify({ type: "error", title: err instanceof Error ? err.message : t("ما زبط") });
    }
  }

  async function runTask(issue: TrackerIssue, mode: TaskMode) {
    const model = models.find((m) => m.verify_ok !== false);
    if (!model) throw new Error(t("أضف نموذج شغّال أولاً من صفحة النماذج."));
    const account = accounts.find((a) => a.id === issue.integration_id);
    const mapped = account && issue.project_key ? account.settings.project_map[issue.project_key] : undefined;
    const task = await createTask({
      title: `${issue.key}: ${issue.title}`.slice(0, 100),
      prompt: t("اشتغل على هالمهمة من {0}:\n\n{1} — {2}\nالحالة: {3}\nالرابط: {4}\n\n{5}", { 0: issue.integration_name, 1: issue.key, 2: issue.title, 3: issue.status, 4: issue.url, 5: issue.description ?? "" }),
      modelId: model.id,
      // The account's folder for this project wins; the agent picks it when none is sent.
      workingDir: mapped ? undefined : recentFolders()[0],
      mode,
      issue: { integration_id: issue.integration_id, key: issue.key },
    });
    navigate(`/tasks/${task.id}`);
  }

  if (!loading && connected.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <h1 className="mb-8 text-[28px] font-extrabold">{t("شغلي")}</h1>
        <EmptyState
          scene="work"
          text={t("اربط حساب Jira أو GitHub أو GitLab أو Linear أو غيرها، وهون بتشوف كل المهام المسندة إلك بتفاصيلها.")}
          action={<Button onClick={() => navigate("/integrations")}>{t("روح لصفحة الربط")}</Button>}
        />
      </div>
    );
  }

  const sprintAccounts = connected.filter((a) => a.capabilities.includes("sprint"));
  const views = connected.flatMap((a) => a.settings.views.filter((v) => v.query || v.kind === "sprint").map((v) => ({ account: a, view: v })));

  return (
    // The page wrapper has no height of its own: bound it to the window so the list and the
    // panel scroll inside, and the panel's actions stay on screen.
    <div className="flex min-h-0" style={{ height: `calc(100vh - ${TOPBAR}px)` }}>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-3 px-6 pb-3 pt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-end gap-3">
              <Illustration scene="work" size={84} className="-mb-2 hidden shrink-0 sm:block" />
              <div>
                <h1 className="text-[28px] font-extrabold leading-tight">{t("شغلي")}</h1>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {listTab && <span>{t("{0} مهمة", { 0: filtered.length })}</span>}
                  {tab.startsWith("sprint:") && sprintName && <span>· {sprintName}</span>}
                  {listTab && overdueCount > 0 && <span style={{ color: "var(--color-danger)" }}>· {t("{0} متأخرة", { 0: overdueCount })}</span>}
                  {fetchedAt && <span>{t("· آخر تحديث")} {timeAgo(fetchedAt.toISOString())}</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setCreating({ parent: null })} title="Ctrl+N">
                <PlusIcon className="h-4 w-4" />
                {t("مهمة")}
              </Button>
              {listTab && (
                <div className="flex rounded-full p-0.5" style={{ background: "var(--color-surface-2)" }}>
                  {(["list", "board"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => switchLayout(l)}
                      aria-pressed={layout === l}
                      title={l === "list" ? t("قائمة") : t("لوح")}
                      className="rounded-full p-1.5"
                      style={{ background: layout === l ? "var(--color-surface)" : "transparent", color: layout === l ? "var(--color-ink)" : "var(--color-ink-muted)" }}
                    >
                      {l === "list" ? <ListIcon className="h-4 w-4" /> : <BoardIcon className="h-4 w-4" />}
                    </button>
                  ))}
                </div>
              )}
              {tab === "mine" && (
                <label className="flex cursor-pointer items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-ink)]" />
                  {t("اعرض المكتملة")}
                </label>
              )}
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => void load(true)}
                aria-label={t("تحديث")}
                title={t("تحديث")}
                className="rounded-full p-2 transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ color: "var(--color-ink-muted)" }}
              >
                <motion.span
                  className="block"
                  animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
                  transition={refreshing ? { duration: 0.9, repeat: Infinity, ease: "linear" } : { duration: 0 }}
                >
                  <RefreshIcon className="h-4 w-4" />
                </motion.span>
              </motion.button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1" role="tablist">
            <FilterChip active={tab === "mine"} onClick={() => setTab("mine")}>{t("مسندة إلي")}</FilterChip>
            {connected.some((a) => a.capabilities.includes("reviews")) && (
              <FilterChip active={tab === "reviews"} onClick={() => setTab("reviews")}>{t("بانتظار مراجعتي")}</FilterChip>
            )}
            <FilterChip active={tab === "notices"} onClick={() => setTab("notices")}>
              {t("التنبيهات")}
              {unread > 0 && tab !== "notices" && (
                <span className="rounded-full px-1.5 text-[10px]" style={{ background: "var(--color-accent)", color: "var(--color-on-accent, #fff)" }}>{unread}</span>
              )}
            </FilterChip>
            {sprintAccounts.map((a) => (
              <FilterChip key={a.id} active={tab === `sprint:${a.id}`} onClick={() => setTab(`sprint:${a.id}`)}>
                <BrandMark provider={a.provider} className="h-3 w-3" />
                {t("السبرنت")}
              </FilterChip>
            ))}
            {views.map(({ account, view }) => (
              <FilterChip key={`${account.id}:${view.id}`} active={tab === `view:${account.id}:${view.id}`} onClick={() => setTab(`view:${account.id}:${view.id}`)}>
                <BrandMark provider={account.provider} className="h-3 w-3" />
                {view.name}
              </FilterChip>
            ))}
          </div>

          {listTab && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-48 flex-1 items-center gap-2 rounded-[10px] px-3" style={{ background: "var(--color-surface-2)" }}>
                <SearchIcon className="h-4 w-4 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("دوّر بالعنوان، المفتاح، المشروع، الوسم…  (/)")}
                  className="w-full bg-transparent py-2 text-sm outline-none"
                  style={{ color: "var(--color-ink)" }}
                  dir={fieldDir(search)}
                />
                {search && (
                  <button onClick={() => setSearch("")} aria-label={t("مسح")} style={{ color: "var(--color-ink-muted)" }}>
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {providers.length > 1 && (
                <div className="flex gap-1">
                  <FilterChip active={providerFilter === null} onClick={() => setProviderFilter(null)}>
                    {t("الكل")}
                  </FilterChip>
                  {providers.map((p) => (
                    <FilterChip key={p} active={providerFilter === p} onClick={() => setProviderFilter(p)}>
                      <BrandMark provider={p} className="h-3.5 w-3.5" />
                    </FilterChip>
                  ))}
                </div>
              )}

              {overdueCount > 0 && (
                <FilterChip active={overdueOnly} onClick={() => setOverdueOnly((v) => !v)}>
                  {t("متأخرة")} {overdueCount}
                </FilterChip>
              )}

              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="input py-1.5 text-xs" aria-label={t("الترتيب")}>
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>

              {layout === "list" && (
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="input py-1.5 text-xs" aria-label={t("التجميع")}>
                  {GROUPS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </header>

        <AnimatePresence>
          {ticked.size > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="mx-6 mb-2 flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2 text-xs"
              style={{ background: "var(--color-inverse)", color: "var(--color-on-inverse)" }}
            >
              <span className="font-medium">{t("{0} محدّدة", { 0: ticked.size })}</span>
              <BulkButton onClick={() => void bulk("complete")}>{t("علّمها مكتملة")}</BulkButton>
              <BulkButton onClick={() => void bulk("assign_me")}>{t("أسندها إلي")}</BulkButton>
              <BulkButton onClick={() => setAsking({ action: "add_label", value: "" })}>{t("أضف وسم")}</BulkButton>
              <BulkButton onClick={() => setAsking({ action: "comment", value: "" })}>{t("علّق عليها")}</BulkButton>
              {asking && (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (asking.value.trim()) void bulk(asking.action, asking.value.trim());
                    setAsking(null);
                  }}
                >
                  <input
                    autoFocus
                    value={asking.value}
                    onChange={(e) => setAsking({ ...asking, value: e.target.value })}
                    onKeyDown={(e) => e.key === "Escape" && setAsking(null)}
                    placeholder={asking.action === "add_label" ? t("الوسم") : t("التعليق")}
                    className="w-48 rounded-full bg-white/15 px-3 py-1 text-xs outline-none placeholder:text-white/60"
                    dir="auto"
                  />
                  <BulkButton onClick={() => undefined}>{t("طبّق")}</BulkButton>
                </form>
              )}
              <button onClick={() => setTicked(new Set())} className="ms-auto rounded-full p-1" aria-label={t("إلغاء التحديد")}>
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <p className="mb-3 flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
              <AlertIcon className="h-4 w-4" />
              {error}
            </p>
          )}

          {loading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="shimmer h-16 rounded-2xl" />
              ))}
            </div>
          ) : tab === "notices" ? (
            <Notices
              notices={notices}
              onOpen={(notice) => {
                if (!notice.read_at) {
                  setNotices((prev) => prev.map((n) => (n.id === notice.id ? { ...n, read_at: new Date().toISOString() } : n)));
                  void markNoticesRead([notice.id]);
                }
              }}
              onReadAll={() => {
                setNotices((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
                void markNoticesRead("all");
              }}
            />
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm" style={{ color: "var(--color-ink-muted)" }}>
              {tab === "reviews" ? t("ما في طلبات مراجعة بانتظارك.") : t("ما في مهام مطابقة.")}
            </p>
          ) : layout === "board" ? (
            <Board
              issues={filtered}
              selected={selected}
              onOpen={(issue) => setSelected(issueId(issue))}
              onMoved={(issue, status, category) =>
                setIssues((prev) => prev.map((i) => (issueId(i) === issueId(issue) ? { ...i, status, status_category: category } : i)))
              }
            />
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((group) => (
                <section key={group.label}>
                  {groupBy !== "none" && (
                    <h2 className="mb-2 px-1 text-[11px] font-normal" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-sans)" }}>
                      {group.label}
                    </h2>
                  )}
                  <motion.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col divide-y overflow-hidden rounded-2xl" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                    <AnimatePresence initial={false}>
                      {group.items.map((issue) => (
                        <IssueRow
                          key={issueId(issue)}
                          issue={issue}
                          active={selected === issueId(issue)}
                          onOpen={() => setSelected(issueId(issue))}
                          checked={ticked.has(issueId(issue))}
                          selecting={ticked.size > 0}
                          onToggle={() => toggle(issueId(issue))}
                        />
                      ))}
                    </AnimatePresence>
                  </motion.ul>
                </section>
              ))}
              {tab === "mine" && issues.length >= limit && (
                <Button variant="ghost" className="self-center" onClick={() => setLimit((l) => l + PAGE)}>
                  {t("حمّل أكتر")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {current && (
          <IssuePanel
            key={issueId(current)}
            summary={current}
            account={accounts.find((a) => a.id === current.integration_id)}
            onClose={() => setSelected(null)}
            onChanged={(updated) =>
              // Update in place so the row reflects the new status without a full refetch…
              setIssues((prev) => prev.map((i) => (issueId(i) === issueId(updated) ? { ...i, ...updated } : i)))
            }
            onDiscuss={(issue) => {
              queueChatMessage(`#${issue.key} `);
              navigate("/chat");
            }}
            onRunTask={runTask}
            onAddSubtask={(issue) => setCreating({ parent: issue })}
          />
        )}
      </AnimatePresence>

      {creating && (
        <CreateIssue
          accounts={accounts}
          parent={creating.parent}
          onClose={() => setCreating(null)}
          onCreated={(issue) => {
            setCreating(null);
            notify({ type: "success", title: t("انعملت {0}", { 0: issue.key }), description: issue.title });
            if (tab === "mine") setIssues((prev) => [issue, ...prev]);
            setSelected(issueId(issue));
          }}
        />
      )}
    </div>
  );
}

function BulkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="submit" onClick={onClick} className="rounded-full px-2.5 py-1 transition-colors hover:bg-white/15">
      {children}
    </button>
  );
}
