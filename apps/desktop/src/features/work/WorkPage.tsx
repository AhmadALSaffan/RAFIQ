/**
 * "شغلي" — every issue assigned to the user, across every connected tracker.
 *
 * The list is the index and the panel is the detail; the page itself only owns fetching,
 * filtering, sorting and which issue is selected. Keyboard navigation is first-class here
 * because this is a triage screen: ↑/↓ to move, Enter to open, Esc to close.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { createTask, listIntegrations, listIssues, listModels } from "../../lib/api";
import type { IntegrationAccount, LlmModel, TrackerIssue } from "../../lib/types";
import { listContainer } from "../../lib/motion";
import { parseUtc, timeAgo } from "../../lib/time";
import { recentFolders } from "../../lib/folders";
import { queueChatMessage } from "../../lib/handoff";
import { fieldDir } from "../../lib/bidi";
import { BrandMark } from "../../components/BrandMark";
import { usePageMenu } from "../../components/ContextMenu";
import { AlertIcon, RefreshIcon, SearchIcon, TasksIcon, XIcon } from "../../components/Icons";
import { Button, EmptyState } from "../../components/ui";
import { IssuePanel } from "./IssuePanel";
import { CATEGORY_LABEL, FilterChip, IssueRow, isOverdue, issueId } from "./pieces";

import { t } from "../../i18n";
type GroupBy = "none" | "provider" | "project" | "status";
type SortBy = "updated" | "priority" | "due";

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

export function WorkPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [includeDone, setIncludeDone] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("provider");
  const [sortBy, setSortBy] = useState<SortBy>("updated");
  const [selected, setSelected] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setRefreshing(true);
      try {
        const list = await listIssues("", 100, includeDone);
        setIssues(list);
        setFetchedAt(new Date());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("ما قدرت أجيب المهام"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [includeDone],
  );

  usePageMenu(() => [
    { id: "refresh", label: t("حدّث المهام"), onSelect: () => void load(true) },
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

  useEffect(() => {
    listIntegrations().then(setAccounts).catch(() => setAccounts([]));
    listModels().then(setModels).catch(() => setModels([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();
    const id = setInterval(() => void load(), 60_000);
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

  // Triage without the mouse: ↑/↓ moves through the list, Enter opens, Esc closes, / searches.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = (event.target as HTMLElement | null)?.closest("input, textarea");
      if (event.key === "Escape" && selected) return setSelected(null);
      if (typing) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (filtered.length === 0) return;
      event.preventDefault();
      const index = filtered.findIndex((i) => issueId(i) === selected);
      const next = event.key === "ArrowDown" ? index + 1 : index - 1;
      const target = filtered[(next + filtered.length) % filtered.length];
      setSelected(issueId(target));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selected]);

  if (!loading && connected.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <h1 className="mb-8 text-xl font-semibold">{t("شغلي")}</h1>
        <EmptyState
          icon={<TasksIcon className="h-8 w-8" />}
          text={t("اربط حساب Jira أو Linear أو GitHub أو GitLab، وهون بتشوف كل المهام المسندة إلك بتفاصيلها.")}
          action={<Button onClick={() => navigate("/integrations")}>{t("روح لصفحة الربط")}</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-3 border-b px-6 py-4" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">{t("شغلي")}</h1>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                <span>{t("{0} مهمة", { 0: filtered.length })}</span>
                {overdueCount > 0 && (
                  <span style={{ color: "var(--color-danger)" }}>· {t("{0} متأخرة", { 0: overdueCount })}</span>
                )}
                {fetchedAt && <span>{t("· آخر تحديث")} {timeAgo(fetchedAt.toISOString())}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                <input
                  type="checkbox"
                  checked={includeDone}
                  onChange={(e) => setIncludeDone(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                {t("اعرض المكتملة")}
              </label>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => void load(true)}
                aria-label={t("تحديث")}
                title={t("تحديث")}
                className="rounded-md p-2 transition-colors hover:bg-[var(--color-surface-2)]"
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

          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border px-3"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
            >
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

            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="input py-1.5 text-xs">
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>

            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="input py-1.5 text-xs">
              {GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <p
              className="mb-3 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm"
              style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
            >
              <AlertIcon className="h-4 w-4" />
              {error}
            </p>
          )}

          {loading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="shimmer h-16 rounded-lg border" style={{ borderColor: "var(--color-border)" }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm" style={{ color: "var(--color-ink-muted)" }}>
              {t("ما في مهام مطابقة.")}
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((group) => (
                <section key={group.label}>
                  {groupBy !== "none" && (
                    <h2 className="mb-2 text-xs font-medium" style={{ color: "var(--color-ink-muted)" }}>
                      {group.label}
                    </h2>
                  )}
                  <motion.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-2">
                    <AnimatePresence initial={false}>
                      {group.items.map((issue) => (
                        <IssueRow
                          key={issueId(issue)}
                          issue={issue}
                          active={selected === issueId(issue)}
                          onOpen={() => setSelected(issueId(issue))}
                        />
                      ))}
                    </AnimatePresence>
                  </motion.ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {current && (
          <IssuePanel
            key={issueId(current)}
            summary={current}
            onClose={() => setSelected(null)}
            onChanged={(updated) =>
              // Update in place so the row reflects the new status without a full refetch…
              setIssues((prev) => prev.map((i) => (issueId(i) === issueId(updated) ? { ...i, ...updated } : i)))
            }
            onDiscuss={(issue) => {
              queueChatMessage(`#${issue.key} `);
              navigate("/chat");
            }}
            onRunTask={async (issue) => {
              const model = models.find((m) => m.verify_ok !== false);
              if (!model) throw new Error(t("أضف نموذج شغّال أولاً من صفحة النماذج."));
              const task = await createTask({
                title: `${issue.key}: ${issue.title}`.slice(0, 100),
                prompt: t("اشتغل على هالمهمة من {0}:\n\n{1} — {2}\nالحالة: {3}\nالرابط: {4}\n\n{5}\n\nلما تخلص، اكتب تعليق على المهمة بأداة issue_comment يشرح شو عملت.", { 0: issue.integration_name, 1: issue.key, 2: issue.title, 3: issue.status, 4: issue.url, 5: issue.description ?? "" }),
                modelId: model.id,
                workingDir: recentFolders()[0],
              });
              navigate(`/tasks/${task.id}`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
