/**
 * Rafiq Lite: one Markdown file in a window of its own — the editor and nothing else, for
 * a `.md` opened from Windows. The first time (or every time, if the user wants), it asks
 * whether to open the file here or in the full app; the answer can be remembered (and
 * changed in Settings → General).
 */

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { IconAppWindow, IconLayoutSidebarRight, IconPencil } from "@tabler/icons-react";
import { baseName, NoteWorkspace, HeaderButton } from "./NoteWorkspace";
import { wordsDir } from "../../lib/noteBidi";
import { Logo } from "../../components/Logo";
import { easeOutExpo } from "../../lib/motion";
import { t } from "../../i18n";

async function tauri() {
  const core = await import("@tauri-apps/api/core");
  return core.isTauri() ? core : null;
}

/** Carries on with the file in the full app and closes this window. */
async function openInFullApp(path: string): Promise<void> {
  const core = await tauri();
  if (!core) return;
  await core.invoke("open_note_in_main", { path });
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

export async function rememberOpenMode(mode: "ask" | "lite" | "full"): Promise<void> {
  const core = await tauri();
  if (core) await core.invoke("set_md_open_mode", { mode });
}

export default function LiteNote() {
  const [params, setParams] = useSearchParams();
  const path = params.get("path") ?? "";
  const asking = params.get("ask") === "1";

  if (!path) return null;
  if (asking) return <Choose path={path} onLite={() => setParams({ path }, { replace: true })} />;

  return (
    <div className="flex h-screen min-h-0 flex-col" style={{ background: "var(--color-bg)" }}>
      <NoteWorkspace
        path={path}
        focusOnLoad
        actions={({ save }) => (
          <HeaderButton
            label={t("افتح برفيق كامل")}
            onClick={() => {
              void save().then(() => openInFullApp(path));
            }}
          >
            <IconLayoutSidebarRight size={17} />
          </HeaderButton>
        )}
      />
    </div>
  );
}

function Choose({ path, onLite }: { path: string; onLite: () => void }) {
  const [remember, setRemember] = useState(false);
  const name = baseName(path);

  const pick = async (mode: "lite" | "full") => {
    if (remember) await rememberOpenMode(mode);
    if (mode === "lite") onLite();
    else await openInFullApp(path);
  };

  const options = [
    {
      mode: "lite" as const,
      Icon: IconPencil,
      title: t("نافذة خفيفة"),
      text: t("بس المحرر والملف — للتعديل السريع"),
    },
    {
      mode: "full" as const,
      Icon: IconAppWindow,
      title: t("رفيق كامل"),
      text: t("مع ملاحظاتك ومجلداتك والمحادثة"),
    },
  ];

  return (
    <div className="grid h-screen place-items-center p-8" style={{ background: "var(--color-bg)" }}>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOutExpo }} className="w-full max-w-lg text-center">
        <Logo className="mx-auto h-12 w-12" />
        <h1 className="mt-4 text-2xl font-extrabold" style={{ fontFamily: "var(--font-display)" }}>
          {t("كيف بدك تفتح الملف؟")}
        </h1>
        <p className="mt-1 truncate text-sm" style={{ color: "var(--color-ink-muted)" }} dir={wordsDir(name) ?? "ltr"}>
          {name}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          {options.map(({ mode, Icon, title, text }, i) => (
            <motion.button
              key={mode}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.06, duration: 0.3, ease: easeOutExpo }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => void pick(mode)}
              className="flex flex-col items-center gap-2 rounded-2xl border px-4 py-6 text-center transition-colors hover:border-[var(--color-accent)]"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: "color-mix(in oklch, var(--color-accent) 16%, transparent)", color: "var(--color-accent)" }}>
                <Icon size={24} stroke={1.7} />
              </span>
              <span className="text-base font-bold">{title}</span>
              <span className="text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                {text}
              </span>
            </motion.button>
          ))}
        </div>
        <label className="mt-5 inline-flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--color-ink-muted)" }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" style={{ accentColor: "var(--color-accent)" }} />
          {t("تذكّر اختياري (بتغيّره من الإعدادات)")}
        </label>
      </motion.div>
    </div>
  );
}
