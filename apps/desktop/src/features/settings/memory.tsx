/**
 * What Rafiq remembers across chats. Every entry is visible here and can be switched off
 * or removed; the master switch stops both saving and recalling.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { addMemory, clearMemories, deleteMemory, listMemories, updateMemory } from "../../lib/api";
import type { AppSettings, Memory } from "../../lib/types";
import { listItem, listContainer } from "../../lib/motion";
import { fieldDir } from "../../lib/bidi";
import { Button } from "../../components/ui";
import { PlusIcon, TrashIcon } from "../../components/Icons";
import { Hint, Section, Switch, ToggleRow } from "./controls";
import { t } from "../../i18n";

type Persist = (next: AppSettings) => void;

export function MemorySettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const load = () =>
    listMemories()
      .then(setMemories)
      .catch(() => setMemories([]));
  useEffect(() => {
    void load();
  }, []);

  async function add() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const saved = await addMemory(text);
    setMemories((list) => [saved, ...(list ?? [])]);
  }

  async function toggle(m: Memory, enabled: boolean) {
    setMemories((list) => list?.map((x) => (x.id === m.id ? { ...x, enabled } : x)) ?? null);
    await updateMemory(m.id, { enabled }).catch(load);
  }

  async function remove(id: string) {
    setMemories((list) => list?.filter((x) => x.id !== id) ?? null);
    await deleteMemory(id).catch(load);
  }

  const enabled = settings.memory_enabled ?? true;

  return (
    <Section title={t("الذاكرة")}>
      <Hint>
        {t("لما تقول لرفيق «تذكّر إني…» بيحفظها هون، وبيشوفها بكل محادثة ومهمة جاية. كل حفظ بيمرّ من صلاحية «الذاكرة» فبتشوف شو رح ينحفظ قبل ما ينحفظ، وبتقدر تعدّل أو تحذف أي شي بأي وقت.")}
      </Hint>
      <ToggleRow
        label={t("رفيق بيتذكّر بين المحادثات")}
        hint={t("مطفية = ما بيحفظ شي جديد وما بيستخدم المحفوظ.")}
        checked={enabled}
        onChange={(memory_enabled) => persist({ ...settings, memory_enabled })}
      />

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          className="input flex-1"
          placeholder={t("أضف شي بإيدك: «أفضّل الردود بالعربي الفصيح»")}
          dir={fieldDir(draft)}
        />
        <Button variant="ghost" onClick={() => void add()} disabled={!draft.trim()}>
          <PlusIcon className="h-4 w-4" />
          {t("أضف")}
        </Button>
      </div>

      {memories === null ? (
        <div className="shimmer h-16 rounded-lg" />
      ) : memories.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("ما في شي محفوظ بعد.")}
        </p>
      ) : (
        <motion.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {memories.map((m) => (
              <motion.li
                key={m.id}
                variants={listItem}
                layout
                exit={{ opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.18 } }}
                className="flex items-center gap-3 rounded-lg border px-3 py-2"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", opacity: m.enabled ? 1 : 0.55 }}
              >
                <p className="min-w-0 flex-1 text-sm" dir="auto">
                  {m.text}
                </p>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
                  {m.kind === "preference" ? t("تفضيل") : m.kind === "project" ? t("مشروع") : t("معلومة")}
                </span>
                <Switch checked={m.enabled} onChange={(v) => void toggle(m, v)} label={t("مفعّلة")} />
                <button onClick={() => void remove(m.id)} aria-label={t("احذف")} className="rounded-md p-1.5 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      {memories && memories.length > 0 && (
        <div className="flex items-center gap-2">
          {confirmClear ? (
            <>
              <Button
                variant="danger"
                className="px-2.5 py-1 text-xs"
                onClick={async () => {
                  await clearMemories();
                  setMemories([]);
                  setConfirmClear(false);
                }}
              >
                {t("امسح كل الذاكرة")}
              </Button>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConfirmClear(false)}>
                {t("لا")}
              </Button>
            </>
          ) : (
            <button onClick={() => setConfirmClear(true)} className="text-xs underline underline-offset-2" style={{ color: "var(--color-ink-muted)" }}>
              {t("امسح الكل")}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}
