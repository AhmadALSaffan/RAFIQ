/**
 * The skills the model reads: bundled ones, the user's own, and a way to install more —
 * from a URL (a GitHub repo, a folder in one, a raw SKILL.md or a zip) or from a short
 * list of well-known design skills. A skill that brings slash commands announces them
 * right after it lands, so the user knows what to type.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { deleteSkill, installSkillFromUrl, mcpRequirements } from "../../lib/api";
import type { AgentSkill, SkillInstallResult } from "../../lib/types";
import { easeOutExpo, listContainer, listItem } from "../../lib/motion";
import { Button, ErrorText } from "../../components/ui";
import { DownloadIcon, ExternalIcon, SpinnerIcon, TrashIcon, WandIcon, XIcon } from "../../components/Icons";
import { t } from "../../i18n";

/** Public design skills worth having. Each installs straight from its repository. */
const CATALOG: { name: string; url: string; blurb: string; by: string }[] = [
  {
    name: "impeccable",
    url: "https://github.com/pbakaus/impeccable/tree/main/.claude/skills/impeccable",
    blurb: t("النسخة الكاملة من impeccable.style — مسارات audit وpolish وcritique وغيرها لمراجعة التصميم وتحسينه."),
    by: "Paul Bakaus",
  },
  {
    name: "web-design-guidelines",
    url: "https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines",
    blurb: t("مراجعة الواجهة على قواعد Vercel: وصولية، أداء، نماذج، وحركة."),
    by: "Vercel",
  },
  {
    name: "frontend-design",
    url: "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
    blurb: t("مهارة Anthropic لواجهات مميّزة بعيدة عن الشكل «الجاهز» — اتجاه بصري واضح وتفاصيل مدروسة."),
    by: "Anthropic",
  },
  {
    name: "ui-ux-pro-max",
    url: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    blurb: t("قاعدة كبيرة من أنماط الواجهات، لوحات ألوان، وأزواج خطوط حسب نوع المنتج."),
    by: "nextlevelbuilder",
  },
];

export function SkillsSection({ skills, onChange }: { skills: AgentSkill[]; onChange: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<SkillInstallResult | null>(null);
  const [hasNode, setHasNode] = useState<boolean | null>(null);

  useEffect(() => {
    // Only for the hint under the catalog — nothing here runs a command.
    mcpRequirements()
      .then((r) => setHasNode(r.node))
      .catch(() => setHasNode(null));
  }, []);

  const bundled = skills.filter((s) => s.source === "bundled");
  const own = skills.filter((s) => s.source === "user");
  const commands = skills.flatMap((s) => s.commands.map((c) => ({ ...c, skill: s.name })));

  async function install(target: string, key: string) {
    const clean = target.trim();
    if (!clean) return;
    setBusy(key);
    setError(null);
    try {
      const result = await installSkillFromUrl(clean);
      setInstalled(result);
      setUrl("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(name: string) {
    await deleteSkill(name).catch(() => undefined);
    onChange();
  }

  return (
    <section className="mt-10 flex flex-col gap-6">
      <div>
        <h2 className="mb-2 text-sm font-medium">{t("المهارات اللي بيشتغل فيها")}</h2>
        <p className="mb-3 text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
          {t("مدمجة بالتطبيق — ما بدها تنزيل ولا إعداد، وبتشتغل مع أي نموذج (رفيق بيمرّرها كأدوات عادية، مو كميزة خاصة بمزوّد).")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {bundled.map((skill) => (
            <Chip key={skill.name} skill={skill} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">{t("مهاراتك")}</h3>
        {own.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("لسا ما نزّلت مهارات. حط رابط تحت أو اختار من القائمة.")}
          </p>
        ) : (
          <motion.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {own.map((skill) => (
                <motion.li
                  key={skill.name}
                  variants={listItem}
                  layout
                  exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                >
                  <WandIcon className="h-4 w-4 shrink-0" style={{ color: "var(--color-accent)" }} />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs" dir="ltr">
                      {skill.name}
                    </p>
                    {skill.description && (
                      <p className="truncate text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="auto">
                        {skill.description}
                      </p>
                    )}
                  </div>
                  {skill.commands.length > 0 && (
                    <span className="hidden gap-1 sm:flex" dir="ltr">
                      {skill.commands.slice(0, 4).map((c) => (
                        <code key={c.name} className="rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: "var(--color-surface-2)", color: "var(--color-accent)" }}>
                          /{c.name}
                        </code>
                      ))}
                      {skill.commands.length > 4 && (
                        <span className="text-[10px]" style={{ color: "var(--color-ink-muted)" }}>
                          +{skill.commands.length - 4}
                        </span>
                      )}
                    </span>
                  )}
                  <button onClick={() => void remove(skill.name)} aria-label={t("احذف")} title={t("احذف المهارة")} className="rounded-md p-1.5 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}

        <div className="mt-3 flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void install(url, "url")}
            className="input flex-1 font-mono text-xs"
            placeholder="https://github.com/user/repo  ·  …/tree/main/skills/x  ·  …/SKILL.md  ·  …/skill.zip"
            dir="ltr"
          />
          <Button onClick={() => void install(url, "url")} disabled={!url.trim() || busy !== null}>
            {busy === "url" ? <SpinnerIcon className="h-4 w-4" /> : <DownloadIcon className="h-4 w-4" />}
            {t("نزّل من رابط")}
          </Button>
        </div>
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
          {t("مستودع GitHub كامل، مجلد جوّاه، ملف SKILL.md مباشر، أو zip. المستودع اللي فيه أكتر من مهارة بينزّلوا كلهم. بس ملفات نصية بتتنزّل — ما في شي بيتنفّذ.")}
        </p>
        <ErrorText message={error} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">{t("مهارات تصميم مقترحة")}</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {CATALOG.map((item) => {
            const have = skills.some((s) => s.name === item.name && s.source === "user");
            return (
              <div key={item.url} className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-xs font-medium" dir="ltr">
                    {item.name}
                  </p>
                  <span className="text-[10px]" style={{ color: "var(--color-ink-muted)" }}>
                    {item.by}
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                  {item.blurb}
                </p>
                <div className="mt-auto flex items-center gap-1.5">
                  <Button className="px-2.5 py-1 text-xs" onClick={() => void install(item.url, item.url)} disabled={busy !== null || have}>
                    {busy === item.url ? <SpinnerIcon className="h-3.5 w-3.5" /> : <DownloadIcon className="h-3.5 w-3.5" />}
                    {have ? t("منزّلة") : t("نزّلها")}
                  </Button>
                  <a href={item.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] underline-offset-2 hover:underline" style={{ color: "var(--color-ink-muted)" }}>
                    <ExternalIcon className="h-3 w-3" />
                    GitHub
                  </a>
                </div>
              </div>
            );
          })}
        </div>
        {hasNode === false && (
          <p className="mt-2 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {t("ملاحظة: المهارات نصوص بس وما بدها Node.js — بس بعض مهارات التصميم بتشغّل أوامر npx بمشروعك، وهاي بتحتاجه.")}
          </p>
        )}
      </div>

      {commands.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">{t("أوامر / من المهارات")}</h3>
          <p className="mb-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("اكتبها بصندوق أي محادثة — كل أمر بيبعت تعليمات المهارة للنموذج.")}
          </p>
          <div className="flex flex-wrap gap-1.5" dir="ltr">
            {commands.map((c) => (
              <code key={`${c.skill}:${c.name}`} title={c.description || c.skill} className="rounded-md border px-2 py-0.5 text-[11px]" style={{ borderColor: "var(--color-border)", color: "var(--color-accent)" }}>
                /{c.name}
              </code>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {installed && (
          <motion.div
            className="fixed inset-0 flex items-center justify-center p-6"
            style={{ zIndex: "var(--z-index-modal)" as unknown as number, background: "rgba(0,0,0,0.45)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setInstalled(null)}
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.96, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0, transition: { duration: 0.15 } }}
              transition={{ duration: 0.28, ease: easeOutExpo }}
              className="flex w-full max-w-md flex-col gap-3 rounded-2xl border p-5 shadow-2xl"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <WandIcon className="h-5 w-5" style={{ color: "var(--color-accent)" }} />
                  {installed.skills.length === 1 ? t("انثبّتت المهارة") : t("انثبّتت {0} مهارات", { 0: installed.skills.length })}
                </h2>
                <button onClick={() => setInstalled(null)} aria-label={t("إغلاق")} className="rounded-lg p-1 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
              <ul className="flex flex-col gap-1">
                {installed.skills.map((s) => (
                  <li key={s.name} className="text-sm">
                    <code className="font-mono text-xs" dir="ltr">
                      {s.name}
                    </code>
                    {s.description && (
                      <span className="ms-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                        {s.description}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {installed.commands.length > 0 ? (
                <div className="rounded-lg border px-3 py-2" style={{ borderColor: "color-mix(in oklch, var(--color-accent) 40%, transparent)", background: "color-mix(in oklch, var(--color-accent) 8%, transparent)" }}>
                  <p className="mb-1.5 text-xs font-medium">{t("أوامر جديدة صارت بصندوق المحادثة:")}</p>
                  <div className="flex flex-wrap gap-1.5" dir="ltr">
                    {installed.commands.map((c) => (
                      <code key={c} className="rounded-md px-2 py-0.5 text-xs" style={{ background: "var(--color-surface)", color: "var(--color-accent)" }}>
                        {c}
                      </code>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {t("النموذج بيقرأها لحاله لما تلزم (skill_read)، وبتقدر تذكرها بالاسم بأي محادثة.")}
                </p>
              )}
              <Button onClick={() => setInstalled(null)} className="self-end">
                {t("تمام")}
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Chip({ skill }: { skill: AgentSkill }) {
  return (
    <span
      title={skill.description}
      className="rounded-full border px-2.5 py-1 font-mono text-[11px]"
      style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
      dir="ltr"
    >
      {skill.name}
      {skill.commands.length > 0 && <span style={{ color: "var(--color-accent)" }}> ·/{skill.commands.length}</span>}
    </span>
  );
}
