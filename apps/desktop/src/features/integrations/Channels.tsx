/** Team channels — Slack, Teams, Discord incoming webhooks — and what goes to each. */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { addChannel, editChannel, listChannels, removeChannel, testChannel } from "../../lib/api";
import type { ChannelEvent, ChannelKind, NotifyChannel } from "../../lib/types";
import { Button, ErrorText, Field, Reveal } from "../../components/ui";
import { PlusIcon, SpinnerIcon, TrashIcon } from "../../components/Icons";
import { BrandMark } from "../../components/BrandMark";
import { notify } from "../../lib/toast";
import { t } from "../../i18n";

const KIND_NAME: Record<ChannelKind, string> = { slack: "Slack", teams: "Microsoft Teams", discord: "Discord" };
const KIND_HELP: Record<ChannelKind, string> = {
  slack: t("Slack ← Apps ← Incoming Webhooks ← Add to Slack، واختار القناة"),
  teams: t("Teams ← القناة ← Workflows ← «Post to a channel when a webhook request is received»"),
  discord: t("Discord ← إعدادات القناة ← Integrations ← Webhooks ← New Webhook"),
};
export const EVENT_LABEL: Record<ChannelEvent, string> = {
  assigned: t("مهمة انسندت"),
  mention: t("منشن"),
  review: t("طلب مراجعة"),
  comment: t("تعليق"),
  status: t("تغيير حالة"),
  task_done: t("تاسك خلص"),
  report: t("ملخصات وتقارير"),
};
const EVENTS = Object.keys(EVENT_LABEL) as ChannelEvent[];

export function Channels() {
  const [channels, setChannels] = useState<NotifyChannel[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    listChannels().then(setChannels).catch(() => setChannels([]));
  }, []);

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">{t("قنوات الفريق")}</h2>
          <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("رفيق بيبعت التنبيهات والملخصات لـ Slack أو Teams أو Discord — والموديل كمان فيه يبعت (بموافقتك).")}
          </p>
        </div>
        <Button variant="ghost" onClick={() => setAdding((v) => !v)}>
          <PlusIcon className="h-4 w-4" />
          {t("قناة")}
        </Button>
      </div>
      <Reveal open={adding}>
        <ChannelForm onDone={(c) => { setChannels((prev) => [...prev, c]); setAdding(false); }} onCancel={() => setAdding(false)} />
      </Reveal>
      <AnimatePresence initial={false}>
        {channels.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            onChange={(next) => setChannels((prev) => prev.map((c) => (c.id === next.id ? next : c)))}
            onRemove={() => setChannels((prev) => prev.filter((c) => c.id !== channel.id))}
          />
        ))}
      </AnimatePresence>
    </section>
  );
}

function EventPicker({ value, onChange }: { value: ChannelEvent[]; onChange: (v: ChannelEvent[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {EVENTS.map((event) => {
        const on = value.includes(event);
        return (
          <button
            key={event}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((e) => e !== event) : [...value, event])}
            className="rounded-full px-3 py-1 text-xs transition-colors"
            style={{ background: on ? "var(--color-inverse)" : "var(--color-surface-2)", color: on ? "var(--color-on-inverse)" : "var(--color-ink-muted)" }}
          >
            {EVENT_LABEL[event]}
          </button>
        );
      })}
    </div>
  );
}

function ChannelForm({ onDone, onCancel }: { onDone: (c: NotifyChannel) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<ChannelKind>("slack");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<ChannelEvent[]>(["mention", "review", "task_done"]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onDone(await addChannel({ kind, name: name.trim() || KIND_NAME[kind], url: url.trim(), events }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما انحفظت"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mb-3 flex flex-col gap-3 rounded-2xl p-4" style={{ background: "var(--color-surface)" }}>
      <div className="flex gap-2">
        {(Object.keys(KIND_NAME) as ChannelKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
            style={{ background: kind === k ? "var(--color-inverse)" : "var(--color-surface-2)", color: kind === k ? "var(--color-on-inverse)" : "var(--color-ink)" }}
          >
            <BrandMark provider={k} className="h-3.5 w-3.5" />
            {KIND_NAME[k]}
          </button>
        ))}
      </div>
      <Field label={t("رابط الـ webhook")} hint={KIND_HELP[kind]}>
        <input className="input font-mono" dir="ltr" type="password" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" />
      </Field>
      <Field label={t("الاسم")}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`#${t("الفريق")}`} />
      </Field>
      <div>
        <p className="mb-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>{t("شو يوصل لهون")}</p>
        <EventPicker value={events} onChange={setEvents} />
      </div>
      <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>{t("الرابط بينحفظ بخزنة ويندوز — أي حدا معه الرابط بيقدر يكتب بالقناة.")}</p>
      <ErrorText message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !url.trim()}>
          {saving && <SpinnerIcon className="h-4 w-4" />}
          {t("احفظ")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("إلغاء")}
        </Button>
      </div>
    </form>
  );
}

function ChannelRow({ channel, onChange, onRemove }: { channel: NotifyChannel; onChange: (c: NotifyChannel) => void; onRemove: () => void }) {
  const [testing, setTesting] = useState(false);

  async function setEvents(events: ChannelEvent[]) {
    onChange(await editChannel(channel.id, { kind: channel.kind, name: channel.name, events }));
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="mb-2 rounded-2xl px-4 py-3" style={{ background: "var(--color-surface)" }}>
      <div className="mb-2 flex items-center gap-2">
        <BrandMark provider={channel.kind} className="h-4 w-4" />
        <span className="text-sm font-medium">{channel.name}</span>
        <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>{KIND_NAME[channel.kind]}</span>
        <Button
          variant="ghost"
          className="ms-auto px-2.5 py-1 text-xs"
          disabled={testing}
          onClick={async () => {
            setTesting(true);
            try {
              await testChannel(channel.id);
              notify({ type: "success", title: t("انبعتت رسالة تجربة لـ {0}", { 0: channel.name }) });
            } catch (err) {
              notify({ type: "error", title: err instanceof Error ? err.message : t("ما زبط") });
            } finally {
              setTesting(false);
            }
          }}
        >
          {testing && <SpinnerIcon className="h-3.5 w-3.5" />}
          {t("جرّب")}
        </Button>
        <button
          onClick={async () => {
            await removeChannel(channel.id);
            onRemove();
          }}
          className="rounded-full p-1.5 hover:bg-[var(--color-surface-2)]"
          aria-label={t("احذف القناة")}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
      <EventPicker value={channel.events} onChange={(events) => void setEvents(events)} />
    </motion.div>
  );
}
