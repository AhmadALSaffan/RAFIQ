/**
 * Tasks that start themselves (schedules) and tasks you start often (templates).
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { deleteSchedule, deleteTemplate, listSchedules, listTemplates, runScheduleNow, saveSchedule, saveTemplate } from "../../lib/api";
import type { LlmModel, Schedule, ScheduleInput, ScheduleKind, TaskTemplate } from "../../lib/types";
import { listContainer, listItem, snappy } from "../../lib/motion";
import { upcomingLabel } from "../../lib/time";
import { fieldDir } from "../../lib/bidi";
import { Button, EmptyState, ErrorText, Field, Reveal } from "../../components/ui";
import { FolderPicker } from "../../components/FolderPicker";
import { ClockIcon, PlusIcon, TasksIcon, TrashIcon } from "../../components/Icons";
import { Switch } from "../settings/controls";
import { intlLocale, t } from "../../i18n";

export type TemplateSeed = { title: string; prompt: string; model_id?: string | null; working_dir?: string | null };

/** Ready-made jobs anyone can start from. */
export const BUILTIN_TEMPLATES: { name: string; prompt: string }[] = [
  {
    name: t("مراجعة الكود"),
    prompt: t("راجع الكود بهالمجلد: دوّر على الأخطاء، المشاكل الأمنية، والأشياء اللي ممكن تتبسّط. رتّبها حسب الأهمية، وما تعدّل ولا ملف — بس اكتب تقرير."),
  },
  {
    name: t("كتابة اختبارات"),
    prompt: t("اكتب اختبارات للأجزاء المهمة بالمشروع اللي ما عليها اختبارات، شغّلها، وتأكد إنها بتنجح. قلّي شو غطّيت وشو ضل."),
  },
  {
    name: t("تحديث README"),
    prompt: t("اقرأ المشروع وحدّث ملف README ليشرح شو بيعمل، كيف ينثبت ويشتغل، وكيف تنعمل المساهمة. لا تخترع ميزات مو موجودة."),
  },
  {
    name: t("ترتيب الملفات"),
    prompt: t("رتّب الملفات بهالمجلد بمجلدات منطقية حسب النوع أو الموضوع، وما تحذف شي. اكتبلي ملخص باللي نقلته ولوين."),
  },
];

function weekdayNames(): string[] {
  const monday = new Date(2024, 0, 1); // a Monday
  const format = new Intl.DateTimeFormat(intlLocale(), { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(monday.getTime() + i * 86_400_000)));
}

export function describeSchedule(s: Pick<Schedule, "kind" | "every_minutes" | "at_time" | "weekdays">): string {
  if (s.kind === "interval") {
    const minutes = s.every_minutes ?? 60;
    return minutes % 60 === 0 ? t("كل {0} ساعة", { 0: minutes / 60 }) : t("كل {0} دقيقة", { 0: minutes });
  }
  if (s.kind === "daily") return t("كل يوم الساعة {0}", { 0: s.at_time ?? "" });
  const names = weekdayNames();
  const days = (s.weekdays ?? []).map((d) => names[d]).join(t("، "));
  return t("{0} الساعة {1}", { 0: days, 1: s.at_time ?? "" });
}

// ── Schedules ───────────────────────────────────────────────────────────────────────────

const EMPTY_SCHEDULE: ScheduleInput = {
  title: "",
  prompt: "",
  model_id: "",
  working_dir: null,
  kind: "daily",
  every_minutes: 60,
  at_time: "09:00",
  weekdays: [0],
  enabled: true,
};

function ScheduleForm({
  models,
  initial,
  onSaved,
  onCancel,
}: {
  models: LlmModel[];
  initial: ScheduleInput & { id?: string };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = weekdayNames();
  const set = (patch: Partial<ScheduleInput>) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveSchedule({ ...draft, title: draft.title.trim() || draft.prompt.trim().slice(0, 48) }, initial.id);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-4 rounded-xl border p-5" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <Field label={t("شو بدك رفيق يعمل؟")}>
        <textarea value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} rows={3} className="input resize-none" dir={fieldDir(draft.prompt)} placeholder={t("مثلاً: لخّصلي مهامي الجديدة بـ Jira وشو المستعجل منها.")} />
      </Field>
      <Field label={t("العنوان (اختياري)")}>
        <input value={draft.title} onChange={(e) => set({ title: e.target.value })} className="input" dir={fieldDir(draft.title)} />
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          {t("متى؟")}
        </span>
        <div className="flex gap-1 rounded-xl p-1" style={{ background: "var(--color-surface-2)" }}>
          {(["interval", "daily", "weekly"] as ScheduleKind[]).map((kind) => (
            <button key={kind} type="button" onClick={() => set({ kind })} className="relative flex-1 rounded-lg px-3 py-1.5 text-xs" style={{ color: draft.kind === kind ? "var(--color-bg)" : "var(--color-ink-muted)" }}>
              {draft.kind === kind && <motion.span layoutId="schedule-kind" className="absolute inset-0 rounded-lg" style={{ background: "var(--color-accent)" }} transition={snappy} />}
              <span className="relative">{kind === "interval" ? t("كل فترة") : kind === "daily" ? t("يومياً") : t("أيام محددة")}</span>
            </button>
          ))}
        </div>
        {draft.kind === "interval" ? (
          <label className="flex items-center gap-2 text-sm">
            {t("كل")}
            <input type="number" min={5} value={draft.every_minutes ?? 60} onChange={(e) => set({ every_minutes: Number(e.target.value) })} className="input w-24" dir="ltr" />
            {t("دقيقة")}
          </label>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {draft.kind === "weekly" &&
              days.map((name, i) => {
                const on = (draft.weekdays ?? []).includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => set({ weekdays: on ? (draft.weekdays ?? []).filter((d) => d !== i) : [...(draft.weekdays ?? []), i] })}
                    className="rounded-full border px-3 py-1 text-xs transition-colors"
                    style={{
                      borderColor: on ? "var(--color-accent)" : "var(--color-border)",
                      background: on ? "color-mix(in oklch, var(--color-accent) 14%, transparent)" : "transparent",
                      color: on ? "var(--color-ink)" : "var(--color-ink-muted)",
                    }}
                  >
                    {name}
                  </button>
                );
              })}
            <label className="flex items-center gap-2 text-sm">
              {t("الساعة")}
              <input type="time" value={draft.at_time ?? "09:00"} onChange={(e) => set({ at_time: e.target.value })} className="input w-32" dir="ltr" />
            </label>
          </div>
        )}
      </div>

      <FolderPicker value={draft.working_dir ?? ""} onChange={(v) => set({ working_dir: v || null })} />

      <Field label={t("النموذج")}>
        <select value={draft.model_id} onChange={(e) => set({ model_id: e.target.value })} className="input">
          <option value="" disabled>
            {t("اختار نموذج")}
          </option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>

      <ErrorText message={error} />
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving || !draft.prompt.trim() || !draft.model_id}>
          {saving ? t("عم يحفظ…") : t("احفظ الجدولة")}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("إلغاء")}
        </Button>
      </div>
    </div>
  );
}

export function SchedulesPanel({ models }: { models: LlmModel[] }) {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [editing, setEditing] = useState<(ScheduleInput & { id?: string }) | null>(null);
  const usable = models.filter((m) => m.verify_ok !== false);

  const load = () =>
    listSchedules()
      .then(setSchedules)
      .catch(() => setSchedules([]));
  useEffect(() => {
    void load();
  }, []);

  async function toggle(schedule: Schedule, enabled: boolean) {
    const saved = await saveSchedule({ ...schedule, enabled }, schedule.id);
    setSchedules((list) => list?.map((s) => (s.id === saved.id ? saved : s)) ?? null);
  }

  async function runNow(schedule: Schedule) {
    const taskId = await runScheduleNow(schedule.id);
    navigate(`/tasks/${taskId}`);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
          {t("مهام بتبلش لحالها بوقتها. رفيق لازم يكون شغّال (ولو بالخلفية بجنب الساعة)؛ الموعد اللي بيفوت وهو مسكّر بيشتغل مرة وحدة أول ما يفتح.")}
        </p>
        {!editing && (
          <Button onClick={() => setEditing({ ...EMPTY_SCHEDULE, model_id: usable[0]?.id ?? "" })} disabled={usable.length === 0}>
            <PlusIcon className="h-4 w-4" />
            {t("جدولة جديدة")}
          </Button>
        )}
      </div>

      <Reveal open={editing !== null}>
        {editing && (
          <ScheduleForm
            models={usable}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void load();
            }}
          />
        )}
      </Reveal>

      {schedules === null ? (
        <div className="shimmer h-20 rounded-xl" />
      ) : schedules.length === 0 ? (
        !editing && <EmptyState icon={<ClockIcon className="h-8 w-8" />} text={t("ما في مهام مجدولة. مثلاً: «كل يوم الساعة 9 لخّصلي مهامي الجديدة»، أو «كل جمعة راجع التبعيات».")} />
      ) : (
        <motion.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {schedules.map((schedule) => (
              <motion.li
                key={schedule.id}
                variants={listItem}
                exit="exit"
                layout="position"
                className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", opacity: schedule.enabled ? 1 : 0.6 }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {schedule.title}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                    <span className="flex items-center gap-1" style={{ color: "var(--color-accent)" }}>
                      <ClockIcon className="h-3 w-3" />
                      {describeSchedule(schedule)}
                    </span>
                    {schedule.enabled && schedule.next_run_at && (
                      <span>{t("الجاية: {0}", { 0: upcomingLabel(schedule.next_run_at) })}</span>
                    )}
                    {schedule.last_task_id && (
                      <button onClick={() => navigate(`/tasks/${schedule.last_task_id}`)} className="underline underline-offset-2">
                        {t("آخر تشغيل")}
                      </button>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" onClick={() => void runNow(schedule)}>
                    {t("شغّل هلأ")}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing({ ...schedule })}>
                    {t("عدّل")}
                  </Button>
                  <button
                    onClick={() => {
                      setSchedules((list) => list?.filter((s) => s.id !== schedule.id) ?? null);
                      void deleteSchedule(schedule.id);
                    }}
                    aria-label={t("احذف")}
                    className="rounded-md p-1.5 hover:bg-[var(--color-surface-2)]"
                    style={{ color: "var(--color-ink-muted)" }}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                  <Switch checked={schedule.enabled} onChange={(on) => void toggle(schedule, on)} label={t("مفعّلة")} />
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </div>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────────────────

export function TemplatesPanel({ models, onUse }: { models: LlmModel[]; onUse: (seed: TemplateSeed) => void }) {
  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null);
  const [editing, setEditing] = useState<{ id?: string; name: string; prompt: string; model_id: string; working_dir: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    listTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!editing) return;
    setError(null);
    try {
      await saveTemplate(
        { name: editing.name.trim(), prompt: editing.prompt, model_id: editing.model_id || null, working_dir: editing.working_dir || null },
        editing.id,
      );
      setEditing(null);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const all: (TaskTemplate | (typeof BUILTIN_TEMPLATES)[number])[] = [...(templates ?? []), ...BUILTIN_TEMPLATES];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
          {t("مهام بتتكرر معك، محفوظة لتبلّشها بضغطة — مع النموذج والمجلد إذا بدك.")}
        </p>
        {!editing && (
          <Button onClick={() => setEditing({ name: "", prompt: "", model_id: "", working_dir: "" })}>
            <PlusIcon className="h-4 w-4" />
            {t("قالب جديد")}
          </Button>
        )}
      </div>

      <Reveal open={editing !== null}>
        {editing && (
          <div className="mb-4 flex flex-col gap-4 rounded-xl border p-5" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <Field label={t("اسم القالب")}>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="input" dir={fieldDir(editing.name)} />
            </Field>
            <Field label={t("شو بدك رفيق يعمل؟")}>
              <textarea value={editing.prompt} onChange={(e) => setEditing({ ...editing, prompt: e.target.value })} rows={4} className="input resize-none" dir={fieldDir(editing.prompt)} />
            </Field>
            <FolderPicker value={editing.working_dir} onChange={(v) => setEditing({ ...editing, working_dir: v })} />
            <Field label={t("النموذج (اختياري)")}>
              <select value={editing.model_id} onChange={(e) => setEditing({ ...editing, model_id: e.target.value })} className="input">
                <option value="">{t("اللي بتختاره وقتها")}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <ErrorText message={error} />
            <div className="flex gap-2">
              <Button onClick={save} disabled={!editing.name.trim() || !editing.prompt.trim()}>
                {t("احفظ القالب")}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t("إلغاء")}
              </Button>
            </div>
          </div>
        )}
      </Reveal>

      {templates === null ? (
        <div className="shimmer h-20 rounded-xl" />
      ) : (
        <motion.ul variants={listContainer} initial="hidden" animate="show" className="grid gap-2 sm:grid-cols-2">
          {all.map((template) => {
            const own = "id" in template;
            return (
              <motion.li
                key={own ? template.id : template.name}
                variants={listItem}
                whileHover={{ y: -2 }}
                transition={snappy}
                className="flex flex-col gap-2 rounded-xl border p-4"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <TasksIcon className="h-4 w-4 shrink-0" style={{ color: "var(--color-accent)" }} />
                    <span className="truncate" dir="auto">
                      {template.name}
                    </span>
                  </p>
                  {!own && (
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
                      {t("جاهز")}
                    </span>
                  )}
                </div>
                <p className="line-clamp-2 text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }} dir="auto">
                  {template.prompt}
                </p>
                <div className="mt-auto flex items-center gap-1">
                  <Button
                    className="px-2.5 py-1 text-xs"
                    onClick={() =>
                      onUse({
                        title: template.name,
                        prompt: template.prompt,
                        model_id: own ? template.model_id : null,
                        working_dir: own ? template.working_dir : null,
                      })
                    }
                  >
                    {t("استخدمه")}
                  </Button>
                  {own && (
                    <>
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => setEditing({ id: template.id, name: template.name, prompt: template.prompt, model_id: template.model_id ?? "", working_dir: template.working_dir ?? "" })}
                      >
                        {t("عدّل")}
                      </Button>
                      <button
                        onClick={() => {
                          setTemplates((list) => list?.filter((x) => x.id !== template.id) ?? null);
                          void deleteTemplate(template.id);
                        }}
                        aria-label={t("احذف")}
                        className="rounded-md p-1.5 hover:bg-[var(--color-surface-2)]"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </div>
  );
}
