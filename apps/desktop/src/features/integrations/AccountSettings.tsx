/** One connected account's settings: how a task moves its issues, what the watcher tells
 *  you, which folder each project lives in, the rules that prepare tasks, saved views, and
 *  read-only mode. Every change saves the moment it's made. */

import { useEffect, useState } from "react";
import { saveIntegrationSettings, listIssueProjects } from "../../lib/api";
import type { IntegrationAccount, IntegrationSettings, IssueProject, IssueRule, NoticeKind, SavedView } from "../../lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/arc/tabs/tabs";
import { Card, Hint, Switch } from "../settings/controls";
import { Button, ErrorText } from "../../components/ui";
import { FolderIcon, PlusIcon, TrashIcon } from "../../components/Icons";
import { pickFolder } from "../../lib/folders";
import { notify } from "../../lib/toast";
import { t } from "../../i18n";

const uid = () => Math.random().toString(36).slice(2, 10);

export const NOTICE_LABEL: Record<NoticeKind, string> = {
  assigned: t("مهمة انسندتلك"),
  mention: t("حدا ذكرك"),
  review: t("طلب مراجعة"),
  comment: t("تعليق جديد"),
  status: t("تغيّرت الحالة"),
  update: t("تحديث"),
};

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {hint && <Hint>{hint}</Hint>}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </Card>
  );
}

function Select<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.currentTarget.value as T)} className="input max-w-56 py-1.5 text-sm">
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function AccountSettings({ account, onSaved }: { account: IntegrationAccount; onSaved: (next: IntegrationAccount) => void }) {
  const [settings, setSettings] = useState<IntegrationSettings>(account.settings);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<IssueProject[]>([]);
  const can = (c: string) => account.capabilities.includes(c as never);

  useEffect(() => setSettings(account.settings), [account.settings]);
  useEffect(() => {
    if (can("projects")) listIssueProjects(account.id).then(setProjects).catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  async function save(next: IntegrationSettings) {
    setSettings(next);
    setError(null);
    try {
      onSaved(await saveIntegrationSettings(account.id, next));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما انحفظ"));
    }
  }
  const life = settings.lifecycle;
  const watch = settings.watch;
  const setLife = (patch: Partial<typeof life>) => void save({ ...settings, lifecycle: { ...life, ...patch } });
  const setWatch = (patch: Partial<typeof watch>) => void save({ ...settings, watch: { ...watch, ...patch } });

  return (
    <div className="mt-2 rounded-2xl p-3" style={{ background: "var(--color-surface-2)" }}>
      <Tabs defaultValue="flow">
        <TabsList>
          <TabsTrigger value="flow">{t("طريقة الشغل")}</TabsTrigger>
          <TabsTrigger value="watch">{t("التنبيهات")}</TabsTrigger>
          <TabsTrigger value="folders">{t("المجلدات")}</TabsTrigger>
          <TabsTrigger value="rules">{t("القواعد")}</TabsTrigger>
          {can("search") && <TabsTrigger value="views">{t("العروض")}</TabsTrigger>}
          <TabsTrigger value="safety">{t("الأمان")}</TabsTrigger>
        </TabsList>

        <TabsContent value="flow" className="mt-3 flex flex-col gap-2">
          <Hint>{t("لما تقول «نفّذها» على مهمة، أو الموديل يشتغل على مهمة من هالحساب، هيك بيمشيها رفيق:")}</Hint>
          <Row label={t("لما يبلّش")}>
            <Select label={t("لما يبلّش")} value={life.on_start} onChange={(v) => setLife({ on_start: v })} options={[
              { value: "in_progress", label: t("انقلها لقيد التنفيذ") },
              { value: "none", label: t("لا تغيّر شي") },
            ]} />
          </Row>
          <Row label={t("اكتب الخطة كتعليق")} hint={t("بمهام «خطة أولاً»: الخطة اللي وافقت عليها بتنكتب على المهمة قبل التنفيذ")}>
            <Switch label={t("اكتب الخطة كتعليق")} checked={life.comment_plan} onChange={(v) => setLife({ comment_plan: v })} />
          </Row>
          <Row label={t("الشغل على git")} hint={t("فرع باسم المهمة فوق آخر commit عندك — مجلدك وتغييراتك ما بتنلمس")}>
            <Select label={t("الشغل على git")} value={life.publish} onChange={(v) => setLife({ publish: v })} options={[
              { value: "none", label: t("ولا شي") },
              { value: "commit", label: t("فرع وcommit محلي") },
              { value: "push", label: t("فرع ورفعه") },
              { value: "pull_request", label: t("فرع ورفعه وطلب دمج (PR)") },
            ]} />
          </Row>
          <Row label={t("ملخص الشغل")} hint={t("تعليق على المهمة بشو انعمل، مع رابط الفرع أو الـ PR")}>
            <Switch label={t("ملخص الشغل")} checked={life.comment_summary} onChange={(v) => setLife({ comment_summary: v })} />
          </Row>
          {can("worklog") && (
            <Row label={t("سجّل الوقت")} hint={t("مدة التاسك بتنسجّل على المهمة")}>
              <Switch label={t("سجّل الوقت")} checked={life.log_work} onChange={(v) => setLife({ log_work: v })} />
            </Row>
          )}
          <Row label={t("لما يخلص")}>
            <Select label={t("لما يخلص")} value={life.on_finish} onChange={(v) => setLife({ on_finish: v })} options={[
              { value: "review", label: t("انقلها للمراجعة") },
              { value: "done", label: t("علّمها مكتملة") },
              { value: "none", label: t("لا تغيّر شي") },
            ]} />
          </Row>
          {life.on_finish === "review" && (
            <Row label={t("اسم حالة المراجعة")} hint={t("الكلمة اللي بيحتويها اسم الحالة عندكم (review، QA، testing…)")}>
              <input className="input w-36 py-1.5 text-sm" dir="ltr" value={life.review_status} onChange={(e) => setSettings({ ...settings, lifecycle: { ...life, review_status: e.target.value } })} onBlur={() => void save(settings)} />
            </Row>
          )}
        </TabsContent>

        <TabsContent value="watch" className="mt-3 flex flex-col gap-2">
          <Row label={t("راقب هالحساب")} hint={t("رفيق بيطّلع كل شوي على مهامك والإشارات وطلبات المراجعة، وبيعلمك بالجديد")}>
            <Switch label={t("راقب هالحساب")} checked={watch.enabled} onChange={(v) => setWatch({ enabled: v })} />
          </Row>
          {watch.enabled && (
            <>
              <Row label={t("كل قديش")} hint={t("أقل من هيك بيصرف من حد الطلبات عند المنصّة")}>
                <Select label={t("كل قديش")} value={String(watch.every_minutes)} onChange={(v) => setWatch({ every_minutes: Number(v) })} options={[2, 5, 10, 15, 30, 60].map((m) => ({ value: String(m), label: t("كل {0} دقيقة", { 0: m }) }))} />
              </Row>
              <Card>
                <p className="mb-2 text-sm font-medium">{t("علّمني عن")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["assigned", "mention", "review", "comment", "status"] as NoticeKind[]).map((kind) => {
                    const on = watch.kinds.includes(kind);
                    return (
                      <button
                        key={kind}
                        onClick={() => setWatch({ kinds: on ? watch.kinds.filter((k) => k !== kind) : [...watch.kinds, kind] })}
                        aria-pressed={on}
                        className="rounded-full px-3 py-1 text-xs transition-colors"
                        style={{ background: on ? "var(--color-inverse)" : "var(--color-surface-2)", color: on ? "var(--color-on-inverse)" : "var(--color-ink-muted)" }}
                      >
                        {NOTICE_LABEL[kind]}
                      </button>
                    );
                  })}
                </div>
              </Card>
              <Row label={t("إشعار ويندوز")} hint={t("غير الإشعار جوّا التطبيق")}>
                <Switch label={t("إشعار ويندوز")} checked={watch.desktop} onChange={(v) => setWatch({ desktop: v })} />
              </Row>
            </>
          )}
          {account.watch_error && <ErrorText message={account.watch_error} />}
        </TabsContent>

        <TabsContent value="folders" className="mt-3 flex flex-col gap-2">
          <Hint>{t("كل مشروع وين موجود على جهازك — «نفّذها» بتفتح التاسك بالمجلد الصح لحالها.")}</Hint>
          <ProjectMap settings={settings} projects={projects} onChange={(map) => void save({ ...settings, project_map: map })} />
        </TabsContent>

        <TabsContent value="rules" className="mt-3 flex flex-col gap-2">
          <Hint>{t("لما تنسندلك مهمة جديدة بتطابق قاعدة، رفيق بيحضّرلها تاسك. «خطة أولاً» بتستنى موافقتك قبل ما يعدّل شي.")}</Hint>
          <Rules rules={settings.rules} onChange={(rules) => void save({ ...settings, rules })} />
        </TabsContent>

        {can("search") && (
          <TabsContent value="views" className="mt-3 flex flex-col gap-2">
            <Hint>{t("بحث محفوظ بلغة المنصّة (JQL، بحث GitHub، WIQL…) — بيطلع كتبويب بصفحة «شغلي».")}</Hint>
            <Views views={settings.views} canSprint={can("sprint")} onChange={(views) => void save({ ...settings, views })} />
          </TabsContent>
        )}

        <TabsContent value="safety" className="mt-3 flex flex-col gap-2">
          <Row label={t("قراءة بس")} hint={t("رفيق بيقرأ من هالحساب بس — لا تعليق ولا تعديل ولا نقل حالة، لا منك ولا من الموديل")}>
            <Switch label={t("قراءة بس")} tone="danger" checked={settings.read_only} onChange={(v) => void save({ ...settings, read_only: v })} />
          </Row>
          <Hint>{t("كل تعديل بيعمله رفيق بينسجّل تحت بـ «شو عدّل رفيق»، وفيك تتراجع عنه وين ما المنصّة بتسمح.")}</Hint>
        </TabsContent>
      </Tabs>
      <ErrorText message={error} />
    </div>
  );
}

function ProjectMap({ settings, projects, onChange }: { settings: IntegrationSettings; projects: IssueProject[]; onChange: (map: Record<string, string>) => void }) {
  const [project, setProject] = useState("");
  const map = settings.project_map;
  const keys = Object.keys(map);

  async function choose(key: string) {
    const folder = await pickFolder(map[key]);
    if (folder) onChange({ ...map, [key]: folder });
    else if (!map[key]) notify({ type: "info", title: t("اكتب المسار يدوياً بالخانة") });
  }

  return (
    <>
      {keys.map((key) => (
        <Card key={key}>
          <div className="flex items-center gap-2">
            <span className="min-w-28 font-mono text-xs" dir="ltr">{key}</span>
            <input className="input flex-1 py-1.5 font-mono text-xs" dir="ltr" value={map[key]} onChange={(e) => onChange({ ...map, [key]: e.target.value })} />
            <button onClick={() => void choose(key)} className="rounded-full p-2 hover:bg-[var(--color-surface-2)]" aria-label={t("اختار مجلد")}>
              <FolderIcon className="h-4 w-4" />
            </button>
            <button onClick={() => onChange(Object.fromEntries(Object.entries(map).filter(([k]) => k !== key)))} className="rounded-full p-2 hover:bg-[var(--color-surface-2)]" aria-label={t("شيل")}>
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </Card>
      ))}
      <div className="flex items-center gap-2">
        {projects.length ? (
          <select className="input flex-1 py-1.5 text-sm" value={project} onChange={(e) => setProject(e.target.value)} aria-label={t("المشروع")}>
            <option value="">{t("اختار مشروع…")}</option>
            {projects.filter((p) => !(p.key in map)).map((p) => (
              <option key={p.id} value={p.key}>
                {p.key === p.name ? p.name : `${p.key} — ${p.name}`}
              </option>
            ))}
          </select>
        ) : (
          <input className="input flex-1 py-1.5 text-sm" dir="ltr" placeholder={t("مفتاح المشروع (مثل APP أو owner/repo)")} value={project} onChange={(e) => setProject(e.target.value)} />
        )}
        <Button variant="ghost" disabled={!project.trim()} onClick={() => { onChange({ ...map, [project.trim()]: "" }); void choose(project.trim()); setProject(""); }}>
          <PlusIcon className="h-4 w-4" />
          {t("أضف")}
        </Button>
      </div>
    </>
  );
}

function Rules({ rules, onChange }: { rules: IssueRule[]; onChange: (rules: IssueRule[]) => void }) {
  const update = (id: string, patch: Partial<IssueRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <>
      {rules.map((rule) => (
        <Card key={rule.id}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Switch label={t("فعّالة")} checked={rule.enabled} onChange={(v) => update(rule.id, { enabled: v })} />
            <span>{t("إذا فيها الوسم")}</span>
            <input className="input w-28 py-1 text-xs" dir="auto" value={rule.label ?? ""} placeholder="rafiq" onChange={(e) => update(rule.id, { label: e.target.value || null })} />
            <span>{t("بمشروع")}</span>
            <input className="input w-24 py-1 text-xs" dir="ltr" value={rule.project ?? ""} placeholder={t("أي مشروع")} onChange={(e) => update(rule.id, { project: e.target.value || null })} />
            <span>{t("وعنوانها فيه")}</span>
            <input className="input w-28 py-1 text-xs" dir="auto" value={rule.contains ?? ""} placeholder={t("أي عنوان")} onChange={(e) => update(rule.id, { contains: e.target.value || null })} />
            <span>←</span>
            <select className="input w-40 py-1 text-xs" value={rule.action} onChange={(e) => update(rule.id, { action: e.target.value as IssueRule["action"] })} aria-label={t("شو يعمل")}>
              <option value="plan">{t("تاسك «خطة أولاً»")}</option>
              <option value="task">{t("تاسك يشتغل فوراً")}</option>
              <option value="notify">{t("علّمني بس")}</option>
            </select>
            <button onClick={() => onChange(rules.filter((r) => r.id !== rule.id))} className="ms-auto rounded-full p-1.5 hover:bg-[var(--color-surface-2)]" aria-label={t("احذف القاعدة")}>
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
          <input className="input mt-2 w-full py-1 text-xs" dir="auto" value={rule.note ?? ""} placeholder={t("تعليمات إضافية للتاسك (اختياري)")} onChange={(e) => update(rule.id, { note: e.target.value || null })} />
        </Card>
      ))}
      <Button variant="ghost" className="self-start" onClick={() => onChange([...rules, { id: uid(), enabled: true, label: "rafiq", project: null, contains: null, action: "plan", note: null }])}>
        <PlusIcon className="h-4 w-4" />
        {t("قاعدة جديدة")}
      </Button>
    </>
  );
}

function Views({ views, canSprint, onChange }: { views: SavedView[]; canSprint: boolean; onChange: (views: SavedView[]) => void }) {
  const update = (id: string, patch: Partial<SavedView>) => onChange(views.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  return (
    <>
      {views.map((view) => (
        <Card key={view.id}>
          <div className="flex items-center gap-2">
            <input className="input w-36 py-1 text-sm" dir="auto" value={view.name} onChange={(e) => update(view.id, { name: e.target.value })} aria-label={t("الاسم")} />
            <select className="input w-28 py-1 text-xs" value={view.kind} onChange={(e) => update(view.id, { kind: e.target.value as SavedView["kind"] })} aria-label={t("النوع")}>
              <option value="search">{t("بحث")}</option>
              {canSprint && <option value="sprint">{t("السبرنت")}</option>}
            </select>
            <input className="input flex-1 py-1 font-mono text-xs" dir="ltr" value={view.query} placeholder={view.kind === "sprint" ? t("مفتاح المشروع (اختياري)") : 'project = APP AND status = "In Review"'} onChange={(e) => update(view.id, { query: e.target.value })} />
            <button onClick={() => onChange(views.filter((v) => v.id !== view.id))} className="rounded-full p-1.5 hover:bg-[var(--color-surface-2)]" aria-label={t("احذف العرض")}>
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </Card>
      ))}
      <Button variant="ghost" className="self-start" onClick={() => onChange([...views, { id: uid(), name: t("عرض جديد"), query: "", kind: "search" }])}>
        <PlusIcon className="h-4 w-4" />
        {t("عرض جديد")}
      </Button>
    </>
  );
}
