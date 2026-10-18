/**
 * An identity from designs the user likes: links to sites, screenshots (dropped, picked or
 * pasted) and saved pages. Rafiq measures each one and the model proposes an identity,
 * which opens in the builder to edit before anything is saved (core/identity_refs.py).
 */

import { useState } from "react";
import { identityFromReferences, uploadAttachment } from "../../lib/api";
import type { IdentityProposal, LlmModel } from "../../lib/types";
import { Button } from "../../components/ui";
import { SparkIcon } from "../../components/Icons";
import { FileDropzone, type FileDropzoneUpload } from "../../components/arc/file-dropzone/file-dropzone";
import { t } from "../../i18n";

const ACCEPT = "image/*,.html,.htm,.css";

export function IdentityFromReferences({
  models,
  modelId: initialModel,
  onProposal,
  onCancel,
}: {
  models: LlmModel[];
  modelId: string;
  onProposal: (proposal: IdentityProposal) => void;
  onCancel: () => void;
}) {
  const [links, setLinks] = useState("");
  const [notes, setNotes] = useState("");
  // The files in the dropzone, and the attachment each became once uploaded.
  const [files, setFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState<Map<File, string>>(new Map());
  const [modelId, setModelId] = useState(initialModel || models[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urls = links
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+/.test(u));
  const ready = files.map((f) => uploaded.get(f)).filter((id): id is string => Boolean(id));
  const uploading = files.some((f) => !uploaded.has(f));

  const upload: FileDropzoneUpload = async (item, { onProgress, signal }) => {
    if (!item.file) return;
    const file = item.file;
    const attachment = await uploadAttachment(file, (fraction) => onProgress(fraction * 100), signal);
    setUploaded((prev) => new Map(prev).set(file, attachment.id));
  };

  async function run() {
    setBusy(true);
    setError(null);
    try {
      onProposal(await identityFromReferences(modelId, urls, ready, notes));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما قدرت أبني الهوية"));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <div>
            <h3 className="text-base font-bold">{t("هوية من تصاميم عجبتك")}</h3>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
              {t("حط روابط مواقع أو لقطات شاشة أو صفحات محفوظة عجبك شكلها. رفيق بيقيس ألوانها وخطوطها وزواياها وحركتها، والنموذج بيقرر هوية بتجمع ذوقها — وبعدها بتعدّل عليها متل ما بدك.")}
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--color-ink-muted)" }}>
              {t("روابط (كل رابط بسطر)")}
            </span>
            <textarea
              value={links}
              onChange={(e) => setLinks(e.currentTarget.value)}
              rows={3}
              className="input w-full resize-none py-2 font-mono text-xs"
              dir="ltr"
              placeholder={"https://linear.app\nhttps://stripe.com"}
            />
          </label>

          <FileDropzone
            accept={ACCEPT}
            maxFiles={8}
            maxSize={20 * 1024 * 1024}
            label={t("لقطات شاشة أو ملفات HTML و CSS")}
            description={t("اسحب الصور لهون، أو اضغط لتختار، أو الصق لقطة شاشة (Ctrl+V)")}
            onUpload={upload}
            onFilesChange={setFiles}
            acceptPaste
          />

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--color-ink-muted)" }}>
              {t("شو عجبك فيها؟ (اختياري)")}
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.currentTarget.value)}
              rows={2}
              className="input w-full resize-none py-2"
              dir="auto"
              placeholder={t("مثلاً: الألوان الداكنة من الأول، والخط العريض من التاني، بس أهدى بالحركة")}
            />
          </label>

          <p className="text-[11px] leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
            {t("في مواقع بتبني ألوانها بالجافاسكربت فما بتبين كاملة من الرابط — ضيف معها لقطة شاشة. النماذج اللي ما بتشوف صور بتاخد ألوان اللقطات مقاسة، ووصفها من نموذج الرؤية إذا مختاره بالإعدادات.")}
          </p>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
        <select value={modelId} onChange={(e) => setModelId(e.currentTarget.value)} className="input w-48" aria-label={t("النموذج")}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          {error && (
            <span className="max-w-xs text-xs" style={{ color: "var(--color-danger)" }}>
              {error}
            </span>
          )}
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t("رجوع")}
          </Button>
          <Button variant="accent" onClick={run} disabled={busy || uploading || !modelId || (urls.length === 0 && ready.length === 0)}>
            <SparkIcon className="h-4 w-4" />
            {busy ? t("عم يقرأ المراجع ويقرر…") : t("خلّي النموذج يبني الهوية")}
          </Button>
        </div>
      </footer>
    </div>
  );
}
