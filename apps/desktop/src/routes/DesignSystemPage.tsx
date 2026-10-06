/**
 * Developer-only sheet of the visual language (#/design-system, dev builds only): every
 * brand piece in both themes and both directions, so a change is checked in one place.
 */

import { useState } from "react";
import { BigNumber, Block, BracketLabel, Chip, LedBar, PageTitle, Wireframe } from "../components/brand";
import { Button, EmptyState } from "../components/ui";
import { FolderIcon, ModelsIcon, PlusIcon, SparkIcon, TasksIcon } from "../components/Icons";
import { MotionDemo } from "../features/motion/MotionDemo";
import { t } from "../i18n";

const SWATCHES = ["bg", "surface", "surface-2", "border", "ink", "ink-muted", "inverse", "on-inverse", "accent", "danger", "success"];

function Section({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="num text-[11px] uppercase tracking-wider" style={{ color: "var(--color-ink-muted)" }}>
        {name}
      </h2>
      {children}
    </section>
  );
}

export function DesignSystemPage() {
  const [dir, setDir] = useState<"rtl" | "ltr">("rtl");
  const [chip, setChip] = useState(0);
  const [led, setLed] = useState(0.6);

  return (
    <div dir={dir} className="mx-auto flex max-w-5xl flex-col gap-8 p-4">
      <div className="flex items-end justify-between gap-4">
        <PageTitle sub="Rafiq visual language, dev only">Design system</PageTitle>
        <div className="flex gap-2">
          <Chip active={dir === "rtl"} onClick={() => setDir("rtl")}>
            RTL
          </Chip>
          <Chip active={dir === "ltr"} onClick={() => setDir("ltr")}>
            LTR
          </Chip>
        </div>
      </div>

      <Section name="Colour tokens">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {SWATCHES.map((name) => (
            <div key={name} className="overflow-hidden rounded-[10px] border" style={{ borderColor: "var(--color-border)" }}>
              <div className="h-12" style={{ background: `var(--${name})` }} />
              <p className="num px-2 py-1 text-[11px]">{name}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section name="Type">
        <Block className="flex flex-col gap-2">
          <p className="text-[38px] font-extrabold leading-tight" style={{ fontFamily: "var(--font-display)" }}>
            {t("شو بدنا نخلص اليوم؟")}
          </p>
          <h1 className="text-[28px] font-extrabold">{t("المحادثات")}</h1>
          <h2 className="text-[20px] font-bold">{t("آخر المحادثات")}</h2>
          <h3 className="text-[16px] font-bold">{t("المجدولة")}</h3>
          <p className="text-sm">{t("ابعت خطة بالمحادثة، ورفيق بيقسمها لمهام.")}</p>
          <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("ما في مهام مجدولة. خلّي رفيق يشتغل لحاله بوقت محدد.")}
          </p>
          <p className="num text-[44px] font-bold leading-none">0123456789</p>
          <code className="text-xs">C:\Projects\shop\src\main.tsx</code>
        </Block>
      </Section>

      <Section name="Blocks">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Block>
            <BracketLabel>{t("آخر المحادثات")}</BracketLabel>
            <p className="mt-3 text-sm">default</p>
          </Block>
          <Block tone="alt">
            <BracketLabel>{t("التصاميم")}</BracketLabel>
            <p className="mt-3 text-sm">alt</p>
            <Wireframe size={110} className="absolute -bottom-5 -start-5 opacity-40" />
          </Block>
          <Block tone="inverse">
            <BracketLabel tone="inverse">{t("اليوم")}</BracketLabel>
            <div className="mt-2">
              <BigNumber value={87} unit="%" />
            </div>
            <LedBar value={led} tone="inverse" label="progress" className="mt-3" />
          </Block>
        </div>
      </Section>

      <Section name="Numbers and LED">
        <Block className="flex flex-wrap items-end gap-8">
          <BigNumber value={44} size={44} />
          <BigNumber value={12.5} decimals={2} prefix="$" size={34} />
          <BigNumber value={7} size={20} />
          <div className="min-w-48 flex-1">
            <LedBar value={led} label="ink" />
            <LedBar value={led} tone="accent" label="accent" className="mt-2" />
            <input type="range" min={0} max={1} step={0.05} value={led} onChange={(e) => setLed(Number(e.target.value))} className="mt-3 w-full" aria-label="LED value" />
          </div>
        </Block>
      </Section>

      <Section name="Buttons">
        <Block className="flex flex-wrap gap-2">
          <Button variant="accent">
            <PlusIcon className="h-4 w-4" />
            {t("ابدأ")}
          </Button>
          <Button>{t("ابدأ محادثة")}</Button>
          <Button variant="soft">soft</Button>
          <Button variant="ghost">ghost</Button>
          <Button variant="danger">danger</Button>
          <Button disabled>disabled</Button>
        </Block>
      </Section>

      <Section name="Chips">
        <Block className="flex flex-wrap gap-2">
          {[ModelsIcon, TasksIcon, FolderIcon, SparkIcon].map((Icon, i) => (
            <Chip key={i} active={chip === i} onClick={() => setChip(i)}>
              <Icon className="h-3.5 w-3.5" />
              chip {i + 1}
            </Chip>
          ))}
        </Block>
      </Section>

      <Section name="Inputs">
        <Block className="flex flex-col gap-2">
          <input className="input" placeholder={t("اكتب شو بدك، ورفيق بيبلّش محادثة…")} />
          <textarea className="input" rows={2} defaultValue={`Latin + ${t("المحادثات")}`} dir="auto" />
        </Block>
      </Section>

      <Section name="Motion page parts">
        <MotionDemo />
      </Section>

      <Section name="Empty state">
        <EmptyState scene="chat" title={t("آخر المحادثات")} text={t("ما في محادثات لسا. اكتب فوق وبلّش.")} action={<Button variant="accent">{t("ابدأ محادثة")}</Button>} />
      </Section>
    </div>
  );
}
