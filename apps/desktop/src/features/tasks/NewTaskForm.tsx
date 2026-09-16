/** The "new task" composer: what to do, where to do it, with which model. */

import { useRef, useState } from "react";
import { motion } from "motion/react";
import { createTask, providerLabel, saveTemplate } from "../../lib/api";
import type { LlmModel } from "../../lib/types";
import { recentFolders, rememberFolder } from "../../lib/folders";
import { snappy } from "../../lib/motion";
import { fieldDir } from "../../lib/bidi";
import { PaperclipIcon, SpinnerIcon } from "../../components/Icons";
import { BrandMark } from "../../components/BrandMark";
import { Button, ErrorText, Field } from "../../components/ui";
import { FolderPicker } from "../../components/FolderPicker";
import { DropZone, UploadChips, useUploads } from "../../components/Attachments";
import type { TemplateSeed } from "./automation";

import { t } from "../../i18n";
export function NewTaskForm({
  models,
  initial,
  onCancel,
  onCreated,
}: {
  models: LlmModel[];
  /** Filled in from a template. */
  initial?: TemplateSeed | null;
  onCancel: () => void;
  onCreated: (task: { id: string }) => void;
}) {
  const firstUsable = models.find((m) => m.verify_ok !== false);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [modelId, setModelId] = useState(initial?.model_id || firstUsable?.id || "");
  const [folder, setFolder] = useState(initial?.working_dir ?? recentFolders()[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function keepAsTemplate() {
    setError(null);
    try {
      await saveTemplate({
        name: title.trim() || prompt.trim().slice(0, 48),
        prompt,
        model_id: modelId || null,
        working_dir: folder.trim() || null,
      });
      setSavedTemplate(true);
      setTimeout(() => setSavedTemplate(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("صار خطأ غير متوقع"));
    }
  }
  const uploads = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const task = await createTask({
        title: title.trim() || prompt.trim().slice(0, 48),
        prompt,
        modelId,
        workingDir: folder.trim() || undefined,
        attachmentIds: uploads.ready.map((a) => a.id),
      });
      if (folder.trim()) rememberFolder(folder.trim());
      uploads.clear();
      onCreated(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("صار خطأ غير متوقع"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DropZone onFiles={uploads.add} className="mb-6">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 rounded-xl border p-5"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <Field label={t("شو بدك رفيق يعمل؟")}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                uploads.add(e.clipboardData.files);
              }
            }}
            rows={4}
            required
            autoFocus
            className="input resize-none"
            placeholder={t("مثلاً: رتّب الصور بهالمجلد بمجلدات حسب السنة، واعطيني ملخص باللي عملته.")}
            dir={fieldDir(prompt)}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
              {t("مرفقات (اختياري)")}
            </span>
            <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => fileInput.current?.click()}>
              <PaperclipIcon className="h-3.5 w-3.5" />
              {t("أرفق صور أو ملفات")}
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) uploads.add(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {uploads.items.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {t("اسحب ملفات لهون، أو الصق صورة بخانة المهمة.")}
            </p>
          ) : (
            <UploadChips items={uploads.items} onRemove={uploads.remove} />
          )}
        </div>

        <FolderPicker value={folder} onChange={setFolder} />

        <div className="flex flex-col gap-2">
          <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {t("النموذج")}
          </span>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {models.map((m) => {
              const broken = m.verify_ok === false;
              const active = m.id === modelId;
              return (
                <motion.button
                  type="button"
                  key={m.id}
                  disabled={broken}
                  onClick={() => setModelId(m.id)}
                  whileTap={broken ? undefined : { scale: 0.98 }}
                  className="relative rounded-lg border px-3 py-2.5 text-start disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                  title={broken ? (m.verify_error ?? t("ما اشتغل بآخر فحص")) : undefined}
                >
                  {active && (
                    <motion.span
                      layoutId="task-model"
                      className="absolute inset-0 rounded-lg"
                      style={{
                        border: "1.5px solid var(--color-accent)",
                        background: "color-mix(in oklch, var(--color-accent) 10%, transparent)",
                      }}
                      transition={snappy}
                    />
                  )}
                  <span className="relative flex items-center gap-2">
                    <BrandMark provider={m.provider} className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 truncate text-sm font-medium">{m.name}</span>
                  </span>
                  <span
                    className="relative mt-0.5 block text-xs"
                    style={{ color: broken ? "var(--color-danger)" : "var(--color-ink-muted)" }}
                  >
                    {broken ? t("ما اشتغل بآخر فحص") : providerLabel(m.provider)}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>

        <Field label={t("العنوان (اختياري)")}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
            placeholder={t("بينحط تلقائياً من وصف المهمة")}
            dir={fieldDir(title)}
          />
        </Field>

        <ErrorText message={error} />

        <div className="flex justify-start gap-2">
          <Button type="submit" disabled={saving || uploads.busy || !prompt.trim() || !modelId}>
            {saving ? (
              <>
                <SpinnerIcon className="h-4 w-4" />
                {t("جارِ الإضافة…")}
              </>
            ) : uploads.busy ? (
              <>
                <SpinnerIcon className="h-4 w-4" />
                {t("عم يرفع المرفقات…")}
              </>
            ) : (
              t("ابدأ المهمة")
            )}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("إلغاء")}
          </Button>
          <Button type="button" variant="ghost" className="ms-auto" onClick={keepAsTemplate} disabled={!prompt.trim()}>
            {savedTemplate ? t("انحفظ كقالب ✓") : t("احفظ كقالب")}
          </Button>
        </div>
      </form>
    </DropZone>
  );
}
