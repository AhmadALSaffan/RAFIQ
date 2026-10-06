/**
 * Home: what Rafiq has been doing today, at a glance, and a box to start the next thing.
 * Every number here is real — today's tasks, today's spending, the next schedule.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { getUsage, listChats, listDesigns, listModels, listSchedules, listTasks } from "../lib/api";
import type { ChatSummary, DesignSummary, LlmModel, Schedule, TaskSummary, UsageSummary } from "../lib/types";
import { useCurrentWorkspaceId } from "../lib/workspace";
import { queueChatSend } from "../lib/handoff";
import { listContainer, listItem } from "../lib/motion";
import { bigClock, parseUtc, timeAgo } from "../lib/time";
import { fieldDir } from "../lib/bidi";
import { BigNumber, Block, BracketLabel, LedBar, Wireframe } from "../components/brand";
import { ArrowDownIcon, ChatIcon, ChevronDownIcon, FolderIcon, ModelsIcon } from "../components/Icons";
import { BrandMark } from "../components/BrandMark";
import { rememberModel, savedModel } from "../features/chat/constants";
import { Illustration } from "../components/Illustration";
import { t } from "../i18n";

/** Today's tasks (started today, local time) and how the finished ones went. */
export function todayStats(tasks: Pick<TaskSummary, "status" | "created_at">[], now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const today = tasks.filter((x) => parseUtc(x.created_at).getTime() >= start);
  const done = today.filter((x) => x.status === "completed").length;
  const failed = today.filter((x) => x.status === "failed").length;
  const running = today.filter((x) => x.status === "running" || x.status === "pending" || x.status === "queued").length;
  return { count: today.length, done, failed, running, rate: done + failed ? done / (done + failed) : null };
}

/** The next enabled schedule to run. */
export function nextSchedule(schedules: Schedule[]): Schedule | null {
  return (
    schedules
      .filter((s) => s.enabled && s.next_run_at)
      .sort((a, b) => parseUtc(a.next_run_at as string).getTime() - parseUtc(b.next_run_at as string).getTime())[0] ?? null
  );
}

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? t("صباح الخير.") : h < 18 ? t("نهارك سعيد.") : t("مسا الخير.");
}

export function HomePage() {
  const navigate = useNavigate();
  const workspaceId = useCurrentWorkspaceId();
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null);
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [models, setModels] = useState<LlmModel[] | null>(null);
  const [text, setText] = useState("");
  // The last model the user chatted with, until they pick another one here.
  const [modelId, setModelId] = useState<string>(() => savedModel() ?? "");

  useEffect(() => {
    listTasks(workspaceId).then(setTasks).catch(() => setTasks([]));
    listChats(workspaceId).then(setChats).catch(() => setChats([]));
    listDesigns(workspaceId).then(setDesigns).catch(() => setDesigns([]));
    listSchedules().then(setSchedules).catch(() => setSchedules([]));
    getUsage(1).then(setUsage).catch(() => setUsage(null));
    listModels().then(setModels).catch(() => setModels([]));
  }, [workspaceId]);

  const stats = useMemo(() => todayStats(tasks ?? []), [tasks]);
  const next = useMemo(() => nextSchedule(schedules ?? []), [schedules]);
  const spent = workspaceId ? (usage?.by_workspace?.find((w) => w.id === workspaceId)?.today_usd ?? 0) : (usage?.today_usd ?? 0);

  // A first run: no model yet, so nothing below can work — show the way in instead.
  if (models !== null && models.length === 0) return <FirstRun onModels={() => navigate("/models")} onChat={() => navigate("/chat")} />;

  const usable = (models ?? []).filter((m) => m.verify_ok !== false);
  const chosen = usable.find((m) => m.id === modelId) ?? null;

  function start() {
    const message = text.trim();
    if (!message || !chosen) return;
    rememberModel(chosen.id);
    queueChatSend(message, chosen.id);
    navigate("/chat");
  }

  return (
    <motion.div
      variants={listContainer}
      initial="hidden"
      animate="show"
      className="mx-auto grid min-h-[calc(100vh-44px)] max-w-6xl grid-cols-1 content-center gap-3 px-5 py-8 md:grid-cols-3 lg:px-8"
    >
      {/* The greeting, set big — the screen's headline — with someone saying hello. */}
      <motion.div variants={listItem} className="relative flex items-end justify-between gap-4 px-2 pb-1 md:col-span-2">
        <h1 className="text-[40px] font-extrabold leading-[1.15] lg:text-[52px]">
          {greeting()}
          <br />
          <span style={{ color: "var(--color-ink-muted)" }}>{t("شو بدنا نخلص اليوم؟")}</span>
        </h1>
        <Illustration scene="chat" size={150} className="hidden shrink-0 lg:block" />
      </motion.div>

      {/* Today, inverted: the one strong block on the screen. */}
      <motion.div variants={listItem} className="md:row-span-2">
        <Block tone="inverse" className="flex h-full min-h-72 flex-col gap-4 p-6">
          <BracketLabel tone="inverse">{t("اليوم")}</BracketLabel>
          {stats.rate === null ? (
            <div>
              <BigNumber value={stats.count} size={72} />
              <p className="mt-2 text-sm opacity-70">{stats.count ? t("مهام شغّالة، ولسا ما خلص شي") : t("ما بلّشت ولا مهمة اليوم")}</p>
            </div>
          ) : (
            <div>
              <BigNumber value={Math.round(stats.rate * 100)} unit="%" size={72} />
              <p className="mt-2 text-sm opacity-70">{t("من المهام خلصت بدون أخطاء")}</p>
            </div>
          )}
          <div className="mt-auto flex gap-8">
            <div>
              <BigNumber value={stats.count} size={28} />
              <p className="mt-0.5 text-xs opacity-60">{t("المهام")}</p>
            </div>
            <div>
              <BigNumber value={spent} decimals={2} prefix="$" size={28} />
              <p className="mt-0.5 text-xs opacity-60">{t("مصروف")}</p>
            </div>
            {stats.running > 0 && (
              <div>
                <BigNumber value={stats.running} size={28} />
                <p className="mt-0.5 text-xs opacity-60">{t("عم تشتغل")}</p>
              </div>
            )}
          </div>
          {stats.count > 0 && <LedBar value={stats.count ? (stats.done + stats.failed) / stats.count : 0} tone="inverse" label={t("المهام اللي خلصت")} />}
        </Block>
      </motion.div>

      {/* Start something: pick the model, say what you need. */}
      <motion.div variants={listItem} className="relative z-10 md:col-span-2">
        {/* Not a Block: that clips, and the model list has to open outside the box. */}
        <div className="relative flex flex-col gap-3 rounded-2xl p-4" style={{ background: "var(--color-surface)" }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
            placeholder={t("اكتب شو بدك، ورفيق بيبلّش محادثة…")}
            aria-label={t("ابدأ محادثة")}
            className="min-w-0 bg-transparent px-1 text-base outline-none"
            dir={fieldDir(text)}
          />
          <div className="flex items-center justify-between gap-2">
            <ModelPicker models={usable} value={chosen?.id ?? ""} onChange={setModelId} />
            <div className="flex items-center gap-2">
              {!chosen && text.trim() && (
                <span className="text-xs" style={{ color: "var(--color-pending)" }}>
                  {t("اختار نموذج أول")}
                </span>
              )}
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={start}
                disabled={!text.trim() || !chosen}
                aria-label={t("ابدأ")}
                title={chosen ? t("ابدأ") : t("اختار نموذج أول")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
                style={{ background: "var(--color-accent)", color: "var(--color-accent-ink)" }}
              >
                <ArrowDownIcon className="h-4 w-4 rotate-180" />
              </motion.button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Recent chats. */}
      <motion.div variants={listItem} className="md:row-span-2">
        <Block className="flex h-full min-h-80 flex-col p-5">
          <BracketLabel>{t("آخر المحادثات")}</BracketLabel>
          {chats === null ? (
            <div className="shimmer mt-3 h-24 rounded-lg" />
          ) : chats.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--color-ink-muted)" }}>
              {t("ما في محادثات لسا. اكتب فوق وبلّش.")}
            </p>
          ) : (
            <ul className="mt-2">
              {chats.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => navigate(`/chat/${c.id}`)}
                    className="flex w-full items-center justify-between gap-3 border-b py-2.5 text-start text-sm last:border-b-0 hover:opacity-70"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <span className="truncate" dir="auto">
                      {c.title}
                    </span>
                    <span className="num shrink-0 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                      {timeAgo(c.updated_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Illustration scene="search" size={120} className="mx-auto mt-auto pt-3" />
        </Block>
      </motion.div>

      {/* Designs — the wireframe globe stays, with someone at a screen beside it. */}
      <motion.div variants={listItem}>
        <button onClick={() => navigate(designs?.length ? "/designs" : "/designs?new=1")} className="block h-full w-full text-start">
          <Block tone="alt" className="h-full min-h-44 p-5 transition-colors hover:bg-[var(--color-border)]">
            <BracketLabel>{t("التصاميم")}</BracketLabel>
            <p className="relative mt-2 max-w-[65%] text-[20px] font-bold leading-snug" style={{ fontFamily: "var(--font-display)" }}>
              {designs?.length ? t("{0} تصميم", { 0: designs.length }) : t("صمّم واجهة")}
              <br />
              {designs?.length ? <span style={{ color: "var(--color-ink-muted)" }}>{designs[0].title}</span> : t("قبل ما تبرمجها")}
            </p>
            <Wireframe size={170} className="absolute -bottom-10 -start-8 opacity-40" />
            <Illustration scene="designs" size={110} className="absolute -bottom-1 end-2" />
          </Block>
        </button>
      </motion.div>

      {/* The next schedule. */}
      <motion.div variants={listItem}>
        <button onClick={() => navigate("/tasks?view=schedules")} className="block h-full w-full text-start">
          <Block className="h-full min-h-44 p-5">
            <BracketLabel>{t("المجدولة")}</BracketLabel>
            {next?.next_run_at ? (
              <>
                <p className="num mt-3 text-[44px] font-bold leading-none">{bigClock(next.next_run_at)}</p>
                <p className="mt-2 max-w-[65%] truncate text-sm" dir="auto">
                  {next.title}
                </p>
                <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {timeAgo(next.next_run_at)}
                </p>
              </>
            ) : (
              <p className="relative mt-3 max-w-[60%] text-sm" style={{ color: "var(--color-ink-muted)" }}>
                {t("ما في مهام مجدولة. خلّي رفيق يشتغل لحاله بوقت محدد.")}
              </p>
            )}
            <Illustration scene="schedule" size={100} className="absolute -bottom-1 end-1 opacity-90" />
          </Block>
        </button>
      </motion.div>

      {/* Tasks running or waiting. */}
      <motion.div variants={listItem} className="md:col-span-2">
        <button onClick={() => navigate("/tasks")} className="block h-full w-full text-start">
          <Block className="flex h-full min-h-40 gap-4 p-5">
            <div className="min-w-0 flex-1">
              <BracketLabel>{t("المهام")}</BracketLabel>
              {tasks && tasks.length ? (
                <ul className="mt-2">
                  {tasks.slice(0, 3).map((x) => (
                    <li key={x.id} className="flex items-center justify-between gap-3 border-b py-2.5 text-sm last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
                      <span className="truncate" dir="auto">
                        {x.title}
                      </span>
                      <span
                        className="shrink-0 text-xs"
                        style={{ color: x.status === "completed" ? "var(--color-success)" : x.status === "failed" ? "var(--color-danger)" : "var(--color-ink-muted)" }}
                      >
                        {x.status === "completed" ? t("خلصت") : x.status === "failed" ? t("فشلت") : x.status === "running" ? t("عم تشتغل") : t("بالدور")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 flex items-center gap-2 text-sm" style={{ color: "var(--color-ink-muted)" }}>
                  <ChatIcon className="h-4 w-4" />
                  {t("ابعت خطة بالمحادثة، ورفيق بيقسمها لمهام.")}
                </p>
              )}
            </div>
            <Illustration scene="tasks" size={130} className="hidden shrink-0 self-end sm:block" />
          </Block>
        </button>
      </motion.div>
    </motion.div>
  );
}

/** Which model the new chat runs on — chosen here, before anything is sent. */
function ModelPicker({ models, value, onChange }: { models: LlmModel[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ borderColor: current ? "var(--color-border)" : "var(--color-pending)", color: current ? "var(--color-ink)" : "var(--color-pending)" }}
      >
        {current ? <BrandMark provider={current.provider} className="h-3.5 w-3.5" /> : <ModelsIcon className="h-3.5 w-3.5" />}
        <span className="max-w-48 truncate">{current?.name ?? t("اختار نموذج")}</span>
        <ChevronDownIcon className="h-3 w-3" />
      </button>
      {open && (
        <motion.ul
          role="listbox"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute start-0 top-full z-30 mt-2 max-h-72 w-64 overflow-y-auto rounded-2xl border p-1 shadow-lg"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          {models.length === 0 ? (
            <li className="px-3 py-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {t("أضف نموذج شغّال أولاً")}
            </li>
          ) : (
            models.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={m.id === value}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm transition-colors hover:bg-[var(--color-surface-2)]"
                  style={{ background: m.id === value ? "var(--color-surface-2)" : undefined }}
                >
                  <BrandMark provider={m.provider} className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                </button>
              </li>
            ))
          )}
        </motion.ul>
      )}
    </div>
  );
}

/** The first screen of a fresh install: the orange welcome, then three steps (the first one inverted). */
function FirstRun({ onModels, onChat }: { onModels: () => void; onChat: () => void }) {
  const steps = [
    { n: "01", title: t("أضف نموذج"), text: t("اختار المزوّد وحط مفتاحك، أو اربط حسابك."), Icon: ModelsIcon, action: onModels, primary: true },
    { n: "02", title: t("اختار مجلد (اختياري)"), text: t("رفيق بيقرأ ويعدّل ملفاته بإذنك."), Icon: FolderIcon, action: onChat, primary: false },
    { n: "03", title: t("ابعت أول رسالة"), text: t("اسأل، أو ابعت خطة ورفيق بيقسمها لمهام."), Icon: ChatIcon, action: onChat, primary: false },
  ];
  return (
    <motion.div variants={listContainer} initial="hidden" animate="show" className="mx-auto flex max-w-4xl flex-col gap-2 p-3 lg:p-4">
      <motion.div
        variants={listItem}
        className="relative flex min-h-64 flex-col justify-end overflow-hidden rounded-2xl p-6"
        style={{ background: "linear-gradient(135deg, #f0a35e 0%, var(--color-accent) 55%, #c96a1f 100%)", color: "#1f1306" }}
      >
        <Illustration scene="welcome" size={240} className="absolute -top-2 end-2 opacity-95 sm:end-8" />
        <p className="relative text-[12px]">( {t("أهلاً")} )</p>
        <h1 className="relative mt-1 max-w-md text-[34px] font-extrabold leading-[1.15]">{t("رفيق جاهز يشتغل معك.")}</h1>
        <p className="relative mt-2 max-w-sm text-sm" style={{ opacity: 0.8 }}>
          {t("تلات خطوات وبتكون عم تحكي معه.")}
        </p>
      </motion.div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {steps.map((step) => (
          <motion.button
            key={step.n}
            variants={listItem}
            whileHover={{ y: -2 }}
            onClick={step.action}
            className="flex flex-col items-start gap-3 rounded-2xl p-4 text-start"
            style={{ background: step.primary ? "var(--color-inverse)" : "var(--color-surface)", color: step.primary ? "var(--color-on-inverse)" : undefined }}
          >
            <span className="flex w-full items-center justify-between">
              <span className="num text-[11px] opacity-60">{step.n}</span>
              <step.Icon className="h-5 w-5" />
            </span>
            <span className="text-[15px] font-bold" style={{ fontFamily: "var(--font-display)" }}>
              {step.title}
            </span>
            <span className="text-xs leading-relaxed opacity-70">{step.text}</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
