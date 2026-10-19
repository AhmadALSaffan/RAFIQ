/** A new issue on any connected tracker — Ctrl+N from «شغلي». The form asks the tracker
 *  what it offers for the chosen project (types, people, labels, priorities). */

import { useEffect, useMemo, useState } from "react";
import { createIssue, issueMeta, listIssueProjects } from "../../lib/api";
import type { IntegrationAccount, IssueMeta, IssueProject, TrackerIssue } from "../../lib/types";
import { Drawer, DrawerContent } from "../../components/arc/drawer/drawer";
import { Button, ErrorText, Field } from "../../components/ui";
import { SpinnerIcon } from "../../components/Icons";
import { BrandMark } from "../../components/BrandMark";
import { direction, t } from "../../i18n";

export function CreateIssue({
  accounts,
  parent,
  onClose,
  onCreated,
}: {
  accounts: IntegrationAccount[];
  /** Create a subtask under this issue. */
  parent?: TrackerIssue | null;
  onClose: () => void;
  onCreated: (issue: TrackerIssue) => void;
}) {
  const usable = useMemo(
    () => accounts.filter((a) => a.verify_ok !== false && a.capabilities.includes("create") && !a.settings.read_only),
    [accounts],
  );
  const [accountId, setAccountId] = useState(parent?.integration_id ?? usable[0]?.id ?? "");
  const [projects, setProjects] = useState<IssueProject[]>([]);
  const [project, setProject] = useState(parent?.project_key ?? "");
  const [meta, setMeta] = useState<IssueMeta | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState("");
  const [assignee, setAssignee] = useState("me");
  const [priority, setPriority] = useState("");
  const [labels, setLabels] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = usable.find((a) => a.id === accountId);

  useEffect(() => {
    if (!account || parent) return;
    setProjects([]);
    if (account.capabilities.includes("projects")) {
      listIssueProjects(account.id)
        .then((list) => {
          setProjects(list);
          setProject((current) => current || list[0]?.key || "");
        })
        .catch(() => setProjects([]));
    }
  }, [account, parent]);

  useEffect(() => {
    if (!account || !project) return;
    issueMeta(account.id, project).then(setMeta).catch(() => setMeta(null));
  }, [account, project]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    setSaving(true);
    setError(null);
    try {
      const issue = await createIssue(account.id, {
        project,
        title: title.trim(),
        description,
        issue_type: issueType || null,
        labels: labels.split(",").map((l) => l.trim()).filter(Boolean),
        assignee: assignee || null,
        priority: priority || null,
        due_date: due || null,
        parent: parent?.key ?? null,
      });
      onCreated(issue);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما انعملت"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent
        side={direction() === "rtl" ? "left" : "right"}
        title={parent ? t("مهمة فرعية تحت {0}", { 0: parent.key }) : t("مهمة جديدة")}
        description={t("بتنعمل مباشرة على المنصّة اللي بتختارها.")}
      >
        {usable.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {t("ما في حساب مربوط بيدعم إنشاء المهام (أو كلها «قراءة بس»).")}
          </p>
        ) : (
          <form onSubmit={save} className="flex flex-col gap-3">
            {!parent && (
              <Field label={t("الحساب")}>
                <div className="flex flex-wrap gap-1.5">
                  {usable.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => { setAccountId(a.id); setProject(""); setMeta(null); }}
                      aria-pressed={a.id === accountId}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
                      style={{ background: a.id === accountId ? "var(--color-inverse)" : "var(--color-surface-2)", color: a.id === accountId ? "var(--color-on-inverse)" : "var(--color-ink)" }}
                    >
                      <BrandMark provider={a.provider} className="h-3.5 w-3.5" />
                      {a.name}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            {!parent && (
              <Field label={t("المشروع")}>
                {projects.length ? (
                  <select className="input" value={project} onChange={(e) => setProject(e.target.value)}>
                    {projects.map((p) => (
                      <option key={p.id} value={p.key}>
                        {p.key === p.name ? p.name : `${p.key} — ${p.name}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="input font-mono" dir="ltr" value={project} onChange={(e) => setProject(e.target.value)} placeholder="APP / owner/repo" />
                )}
              </Field>
            )}
            <Field label={t("العنوان")}>
              <input className="input" dir="auto" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={t("الوصف")} hint={t("Markdown")}>
              <textarea className="input min-h-28" dir="auto" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              {meta && meta.issue_types.length > 0 && (
                <Field label={t("النوع")}>
                  <select className="input" value={issueType} onChange={(e) => setIssueType(e.target.value)}>
                    <option value="">{t("تلقائي")}</option>
                    {meta.issue_types.filter((it) => it.subtask === Boolean(parent)).map((it) => (
                      <option key={it.id} value={it.name}>{it.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label={t("مسندة لـ")}>
                <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="me">{t("إلي")}</option>
                  <option value="">{t("لحدا")}</option>
                  {meta?.people.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
              {meta && meta.priorities.length > 0 && (
                <Field label={t("الأولوية")}>
                  <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="">{t("الافتراضية")}</option>
                    {meta.priorities.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label={t("الاستحقاق")}>
                <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} dir="ltr" />
              </Field>
            </div>
            <Field label={t("الوسوم")} hint={meta?.labels.length ? meta.labels.slice(0, 12).join(t("، ")) : t("مفصولة بفاصلة")}>
              <input className="input" dir="auto" value={labels} onChange={(e) => setLabels(e.target.value)} list="issue-labels" />
              <datalist id="issue-labels">
                {meta?.labels.map((l) => <option key={l} value={l} />)}
              </datalist>
            </Field>
            <ErrorText message={error} />
            <div className="flex gap-2">
              <Button type="submit" disabled={saving || !title.trim() || (!project && !parent)}>
                {saving && <SpinnerIcon className="h-4 w-4" />}
                {t("أنشئها")}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("إلغاء")}
              </Button>
            </div>
          </form>
        )}
      </DrawerContent>
    </Drawer>
  );
}
