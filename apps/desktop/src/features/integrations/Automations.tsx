/** Ready-made schedules built on the tracker tools: a morning brief, a stand-up, weekly
 *  release notes, an overdue nudge. One press makes the schedule; it shows up with the
 *  others under Tasks → Schedules, where it can be edited or stopped. */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { listModels, saveSchedule } from "../../lib/api";
import type { ScheduleInput } from "../../lib/types";
import { Button } from "../../components/ui";
import { ClockIcon, SpinnerIcon } from "../../components/Icons";
import { notify } from "../../lib/toast";
import { t } from "../../i18n";

type Ready = { id: string; title: string; when: string; schedule: Omit<ScheduleInput, "model_id" | "working_dir" | "enabled"> };

const READY: Ready[] = [
  {
    id: "brief",
    title: t("ملخص الصبح"),
    when: t("كل يوم 8:30"),
    schedule: {
      title: t("ملخص الصبح من المهام"),
      kind: "daily",
      at_time: "08:30",
      every_minutes: null,
      weekdays: null,
      prompt: t("اعملي ملخص الصبح من كل الحسابات المربوطة: استعمل issue_list و issue_reviews و issue_notices. رتّبه: المتأخر، المستحق اليوم، الجديد من مبارح، وطلبات المراجعة. اقترح شو أبلّش فيه أولاً. إذا في قناة فريق مربوطة اسمها فيها «صبح» أو «daily»، ابعته عليها بـ notify_post."),
    },
  },
  {
    id: "standup",
    title: t("Stand-up"),
    when: t("أيام الشغل 9:00"),
    schedule: {
      title: t("Stand-up اليومي"),
      kind: "weekly",
      at_time: "09:00",
      every_minutes: null,
      weekdays: [0, 1, 2, 3, 4],
      prompt: t("اكتبلي stand-up: شو خلص مبارح (task_list للمهام اللي خلصت آخر 24 ساعة، و issue_search للمهام المسندة إلي اللي تحدّثت)، شو رح أشتغل اليوم (المفتوح عندي حسب الأولوية)، وشو معيقني (المهام المعاقة أو اللي ما تحرّكت). خليه 6 أسطر بالكتير. إذا في قناة فريق مربوطة ابعته عليها بـ notify_post."),
    },
  },
  {
    id: "release",
    title: t("ملاحظات الإصدار"),
    when: t("كل جمعة 16:00"),
    schedule: {
      title: t("ملاحظات الإصدار الأسبوعية"),
      kind: "weekly",
      at_time: "16:00",
      every_minutes: null,
      weekdays: [4],
      prompt: t("اجمع المهام اللي تسكّرت هالأسبوع من كل الحسابات (issue_search: بـ Jira «resolved >= -7d»، بـ GitHub «is:closed closed:>=تاريخ-قبل-أسبوع»، وبالباقي حسب لغته) واكتب ملاحظات إصدار مرتبة حسب: ميزات، إصلاحات، تحسينات — جملة لكل وحدة مع مفتاحها. ابعتها لقناة الفريق إذا في وحدة مربوطة."),
    },
  },
  {
    id: "overdue",
    title: t("نكزة المتأخر"),
    when: t("كل يوم 14:00"),
    schedule: {
      title: t("تذكير بالمهام المتأخرة"),
      kind: "daily",
      at_time: "14:00",
      every_minutes: null,
      weekdays: null,
      prompt: t("شوف المهام المسندة إلي اللي استحقاقها فات أو بكرا (issue_list). إذا في، اعرضها مع اقتراح: أخلصها، أأجلها، أو أقسمها (issue_split). لا تعدّل شي بدون ما أطلب."),
    },
  },
];

export function Automations() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  async function make(ready: Ready) {
    setBusy(ready.id);
    try {
      const model = (await listModels()).find((m) => m.verify_ok !== false);
      if (!model) throw new Error(t("أضف نموذج شغّال أولاً من صفحة النماذج."));
      await saveSchedule({ ...ready.schedule, model_id: model.id, working_dir: null, enabled: true });
      notify({
        type: "success",
        title: t("انعملت «{0}»", { 0: ready.schedule.title }),
        description: ready.when,
        action: { label: t("المجدولة"), onClick: () => navigate("/tasks?view=schedules") },
      });
    } catch (err) {
      notify({ type: "error", title: err instanceof Error ? err.message : t("ما زبط") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="mb-1 text-sm font-medium">{t("جاهزات")}</h2>
      <p className="mb-3 text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {t("مهام مجدولة بتستعمل حساباتك المربوطة — اضغط وحدة وبتنعمل، وبتعدّلها أو توقفها من المهام ← المجدولة.")}
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {READY.map((ready) => (
          <div key={ready.id} className="flex flex-col gap-2 rounded-2xl p-4" style={{ background: "var(--color-surface)" }}>
            <span className="text-sm font-bold">{ready.title}</span>
            <span className="flex items-center gap-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>
              <ClockIcon className="h-3.5 w-3.5" />
              {ready.when}
            </span>
            <Button variant="ghost" className="mt-auto self-start px-2.5 py-1 text-xs" disabled={busy !== null} onClick={() => void make(ready)}>
              {busy === ready.id && <SpinnerIcon className="h-3.5 w-3.5" />}
              {t("فعّلها")}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
