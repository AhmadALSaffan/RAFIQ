/**
 * The creative hub: designs, motion and notes behind one door in the rail. Three big
 * choices, each with what it's for, how many you have, and a button to open it or start
 * a new one — then what was made last, across the three.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { listDesigns, listMotionProjects, notesTree, type MotionProjectSummary, type NoteEntry } from "../lib/api";
import type { DesignSummary } from "../lib/types";
import { useCurrentWorkspaceId } from "../lib/workspace";
import { listContainer, listItem } from "../lib/motion";
import { timeAgo } from "../lib/time";
import { Block, BracketLabel } from "../components/brand";
import { MovieIcon, NotebookIcon, PlusIcon, SparkIcon } from "../components/Icons";
import { SkeletonRows } from "../components/easy/skeleton";
import { Illustration, type Scene as IllustrationScene } from "../components/Illustration";
import { t } from "../i18n";

type Made = { kind: "design" | "motion" | "note"; title: string; at: string; to: string };

/** A note's mtime (seconds or milliseconds since 1970) as an ISO date for timeAgo. */
function noteDate(mtime: number): string {
  return new Date(mtime > 1e12 ? mtime : mtime * 1000).toISOString();
}

const KIND_ICON = { design: SparkIcon, motion: MovieIcon, note: NotebookIcon } as const;

interface Choice {
  id: "designs" | "motion" | "notes";
  title: string;
  text: string;
  Icon: typeof SparkIcon;
  scene: IllustrationScene;
  count: string | null;
  open: string;
  create: string;
  newLabel: string;
  openLabel: string;
}

export function CreativePage() {
  const navigate = useNavigate();
  const workspaceId = useCurrentWorkspaceId();
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null);
  const [projects, setProjects] = useState<MotionProjectSummary[] | null>(null);
  const [notes, setNotes] = useState<NoteEntry[] | null>(null);

  useEffect(() => {
    listDesigns(workspaceId).then(setDesigns).catch(() => setDesigns([]));
    listMotionProjects(workspaceId).then(setProjects).catch(() => setProjects([]));
    notesTree()
      .then((tree) => setNotes(tree.items.filter((i) => i.kind === "note").sort((a, b) => b.mtime - a.mtime)))
      .catch(() => setNotes([]));
  }, [workspaceId]);

  const recent = useMemo<Made[] | null>(() => {
    if (designs === null || projects === null || notes === null) return null;
    const all: Made[] = [
      ...designs.map((d) => ({ kind: "design" as const, title: d.title, at: d.updated_at, to: `/designs/${d.id}` })),
      ...projects.map((p) => ({ kind: "motion" as const, title: p.title, at: p.updated_at, to: `/motion/${p.id}` })),
      ...notes.map((n) => ({ kind: "note" as const, title: n.title || n.name, at: noteDate(n.mtime), to: `/notes?path=${encodeURIComponent(n.path)}` })),
    ];
    return all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6);
  }, [designs, projects, notes]);

  const choices: Choice[] = [
    {
      id: "designs",
      title: t("التصاميم"),
      text: t("صمّم واجهة أو موقع أو صفحة هبوط، وشوفها قبل ما تبرمجها."),
      Icon: SparkIcon,
      scene: "designs",
      count: designs === null ? null : t("{0} تصميم", { 0: designs.length }),
      open: "/designs",
      create: "/designs?new=1",
      openLabel: t("افتح التصاميم"),
      newLabel: t("تصميم جديد"),
    },
    {
      id: "motion",
      title: t("موشن"),
      text: t("فيديوهات وموشن قرافك — 2D و 3D — بتحكي للموديل وهو بيبنيها."),
      Icon: MovieIcon,
      scene: "motion",
      count: projects === null ? null : t("{0} مشروع", { 0: projects.length }),
      open: "/motion",
      create: "/motion?new=1",
      openLabel: t("افتح الموشن"),
      newLabel: t("فيديو جديد"),
    },
    {
      id: "notes",
      title: t("ملاحظات"),
      text: t("اكتب أفكارك وملفاتك بـ Markdown، ورفيق بيساعدك ترتبها."),
      Icon: NotebookIcon,
      scene: "work",
      count: notes === null ? null : t("{0} ملاحظة", { 0: notes.length }),
      open: "/notes",
      create: "/notes?new=1",
      openLabel: t("افتح الملاحظات"),
      newLabel: t("ملاحظة جديدة"),
    },
  ];

  return (
    <motion.div variants={listContainer} initial="hidden" animate="show" className="mx-auto flex min-h-[calc(100vh-44px)] max-w-6xl flex-col justify-center gap-3 px-5 py-8 lg:px-8">
      {/* The headline, set big like Home's greeting. */}
      <motion.div variants={listItem} className="px-2 pb-2">
        <h1 className="text-[40px] font-extrabold leading-[1.15] lg:text-[52px]">
          {t("المركز الإبداعي")}
          <br />
          <span style={{ color: "var(--color-ink-muted)" }}>{t("شو بدك تعمل؟")}</span>
        </h1>
      </motion.div>

      {/* The three choices, side by side: pick where to go. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {choices.map((c) => (
          <motion.div
            key={c.id}
            variants={listItem}
            whileHover={{ y: -3 }}
            onClick={() => navigate(c.open)}
            className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border p-5 transition-colors"
            style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ background: "var(--color-accent)", color: "var(--color-accent-ink)" }}>
                <c.Icon className="h-6 w-6" />
              </span>
              {c.count !== null && (
                <span className="num rounded-full px-2.5 py-1 text-xs" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
                  {c.count}
                </span>
              )}
            </div>
            <h2 className="mt-4 text-[26px] font-extrabold leading-tight" style={{ fontFamily: "var(--font-display)" }}>
              {c.title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
              {c.text}
            </p>
            <Illustration scene={c.scene} size={130} className="mx-auto my-4" />
            <div className="mt-auto flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(c.open);
                }}
                className="flex-1 rounded-full px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: "var(--color-inverse)", color: "var(--color-on-inverse)" }}
              >
                {c.openLabel}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(c.create);
                }}
                className="flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ borderColor: "var(--color-border)" }}
                title={c.newLabel}
              >
                <PlusIcon className="h-4 w-4" />
                {c.newLabel}
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* What was made last, across the three. */}
      {(recent === null || recent.length > 0) && (
        <motion.div variants={listItem}>
          <Block className="p-5">
            <BracketLabel>{t("آخر الشغل")}</BracketLabel>
            {recent === null ? (
              <SkeletonRows rows={3} height={41} className="mt-2" />
            ) : (
              <ul className="mt-2 grid grid-cols-1 gap-x-6 md:grid-cols-2">
                {recent.map((m) => {
                  const Icon = KIND_ICON[m.kind];
                  return (
                    <li key={`${m.kind}:${m.to}`}>
                      <button
                        onClick={() => navigate(m.to)}
                        className="flex w-full items-center gap-3 border-b py-2.5 text-start text-sm hover:opacity-70"
                        style={{ borderColor: "var(--color-border)" }}
                      >
                        <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
                        <span className="min-w-0 flex-1 truncate" dir="auto">
                          {m.title}
                        </span>
                        <span className="num shrink-0 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                          {timeAgo(m.at)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Block>
        </motion.div>
      )}
    </motion.div>
  );
}
