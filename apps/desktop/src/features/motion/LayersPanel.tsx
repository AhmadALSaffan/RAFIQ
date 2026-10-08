/**
 * Every layer in drawing order — the top row is drawn on top, like any editor's layer list.
 * Drag a row (or use the arrows) to change the order; the eye hides, the lock keeps a layer
 * from being picked or dragged on the stage; double-click renames. Sound is listed apart.
 */

import { useRef, useState } from "react";
import { t } from "../../i18n";
import { fieldDir } from "../../lib/bidi";
import { BracketLabel } from "../../components/brand";
import { ArrowDownIcon, ArrowUpIcon, ChartIcon, CopyIcon, EyeIcon, EyeOffIcon, GripIcon, IconsIcon, LayersIcon, LockIcon, MovieIcon, MusicIcon, PhotoIcon, ShapeIcon, TextIcon, TrashIcon, UnlockIcon } from "../../components/Icons";
import type { Layer, Scene } from "./engine/types";
import { duplicateLayerOps, layerLabel, layerRows, layerSlot, moveLayerOps, removeLayerOps, setField, type Op } from "./sceneEdit";

export const AUDIO_TINT = "var(--motion-audio, #2f9e8f)";

export function LayerTypeIcon({ type, className = "h-3.5 w-3.5" }: { type: string; className?: string }) {
  const Icon =
    type === "text" || type === "captions"
      ? TextIcon
      : type === "shape"
        ? ShapeIcon
        : type === "icon"
          ? IconsIcon
          : type === "image"
            ? PhotoIcon
            : type === "video"
              ? MovieIcon
              : type === "chart"
                ? ChartIcon
                : type === "group"
                  ? LayersIcon
                  : MusicIcon;
  return <Icon className={className} />;
}

export function LayersPanel({
  scene,
  selected,
  onSelect,
  onChange,
}: {
  scene: Scene;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (ops: Op[], summary: string) => void;
}) {
  const rows = layerRows(scene);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // read by the drop handlers: state set on dragstart may not be rendered yet
  const dragRef = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const sameList = (a: string, b: string) => layerSlot(scene, a)?.base === layerSlot(scene, b)?.base;
  const toggle = (layer: Layer, field: "hidden" | "locked") =>
    onChange(
      setField(scene, layer.id, field, layer[field] ? undefined : true),
      field === "hidden" ? (layer.hidden ? t("أظهرت {id}", { id: layer.id }) : t("أخفيت {id}", { id: layer.id })) : layer.locked ? t("فكّيت قفل {id}", { id: layer.id }) : t("قفلت {id}", { id: layer.id }),
    );

  const small = "rounded p-1 hover:bg-[var(--color-surface)]";
  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-2 flex items-center justify-between">
        <BracketLabel>{t("الطبقات")}</BracketLabel>
        <span className="num text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
          {rows.length}
        </span>
      </div>
      {rows.length === 0 && (
        <p className="py-6 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("ما في طبقات لسا — ضيف من تبويب «إضافة» أو احكي للموديل.")}
        </p>
      )}
      <ul className="flex flex-col gap-0.5" role="listbox" aria-label={t("الطبقات")}>
        {rows.map(({ layer, depth, index, count }) => {
          const on = selected === layer.id;
          const label = layer.name ?? layerLabel(layer);
          return (
            <li
              key={layer.id}
              role="option"
              aria-selected={on}
              draggable={renaming !== layer.id}
              onDragStart={(e) => {
                dragRef.current = layer.id;
                setDragging(layer.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                dragRef.current = null;
                setDragging(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                const from = dragRef.current;
                if (!from || from === layer.id || !sameList(from, layer.id)) return;
                e.preventDefault();
                setOver(layer.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragRef.current;
                if (from && from !== layer.id && sameList(from, layer.id)) onChange(moveLayerOps(scene, from, index), t("رتّبت الطبقات"));
                dragRef.current = null;
                setDragging(null);
                setOver(null);
              }}
              onClick={() => onSelect(layer.id)}
              className="group flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs"
              style={{
                paddingInlineStart: 6 + depth * 14,
                background: on ? "var(--color-surface-2)" : undefined,
                boxShadow: over === layer.id ? "inset 0 2px 0 var(--color-accent)" : on ? "inset 0 0 0 1px var(--color-accent)" : undefined,
                opacity: layer.hidden ? 0.45 : dragging === layer.id ? 0.5 : 1,
              }}
            >
              <GripIcon className="h-3.5 w-3.5 shrink-0 cursor-grab opacity-40 group-hover:opacity-100" />
              <span style={{ color: "var(--color-ink-muted)" }}>
                <LayerTypeIcon type={layer.type} />
              </span>
              {renaming === layer.id ? (
                <input
                  autoFocus
                  defaultValue={layer.name ?? ""}
                  placeholder={layerLabel(layer)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const v = e.currentTarget.value.trim();
                    setRenaming(null);
                    if (v !== (layer.name ?? "")) onChange(setField(scene, layer.id, "name", v || undefined), t("سمّيت {id}", { id: layer.id }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="min-w-0 flex-1 rounded border px-1 py-0.5 text-xs outline-none"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate" dir={fieldDir(label)} onDoubleClick={() => setRenaming(layer.id)} title={t("دبل كليك لإعادة التسمية")}>
                  {label}
                </span>
              )}
              <span className="num shrink-0 text-[10px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                {layer.start}–{layer.end}s
              </span>
              <div className={`flex shrink-0 items-center ${on ? "" : "opacity-0 group-hover:opacity-100"}`} onClick={(e) => e.stopPropagation()}>
                <button type="button" className={small} disabled={index === count - 1} title={t("لقدّام")} aria-label={t("لقدّام")} onClick={() => onChange(moveLayerOps(scene, layer.id, "up"), t("قدّمت {id}", { id: layer.id }))}>
                  <ArrowUpIcon className="h-3 w-3" />
                </button>
                <button type="button" className={small} disabled={index === 0} title={t("لورا")} aria-label={t("لورا")} onClick={() => onChange(moveLayerOps(scene, layer.id, "down"), t("رجّعت {id} لورا", { id: layer.id }))}>
                  <ArrowDownIcon className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className={small}
                  title={t("كرّر")}
                  aria-label={t("كرّر")}
                  onClick={() => {
                    const dup = duplicateLayerOps(scene, layer.id);
                    if (dup) {
                      onChange(dup.ops, t("كرّرت {id}", { id: layer.id }));
                      onSelect(dup.id);
                    }
                  }}
                >
                  <CopyIcon className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className={small}
                  title={t("احذف")}
                  aria-label={t("احذف")}
                  style={{ color: "var(--color-danger)" }}
                  onClick={() => {
                    onChange(removeLayerOps(scene, layer.id), t("حذفت {id}", { id: layer.id }));
                    if (on) onSelect(null);
                  }}
                >
                  <TrashIcon className="h-3 w-3" />
                </button>
              </div>
              <button type="button" className={small} title={layer.locked ? t("فك القفل") : t("اقفل")} aria-label={layer.locked ? t("فك القفل") : t("اقفل")} onClick={(e) => (e.stopPropagation(), toggle(layer, "locked"))} style={{ opacity: layer.locked ? 1 : 0.4 }}>
                {layer.locked ? <LockIcon className="h-3.5 w-3.5" /> : <UnlockIcon className="h-3.5 w-3.5" />}
              </button>
              <button type="button" className={small} title={layer.hidden ? t("أظهر") : t("أخفِ")} aria-label={layer.hidden ? t("أظهر") : t("أخفِ")} onClick={(e) => (e.stopPropagation(), toggle(layer, "hidden"))}>
                {layer.hidden ? <EyeOffIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
              </button>
            </li>
          );
        })}
      </ul>

      {(scene.audio?.length ?? 0) > 0 && (
        <>
          <div className="mb-2 mt-5 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: AUDIO_TINT }} />
            <BracketLabel>{t("الصوت")}</BracketLabel>
          </div>
          <ul className="flex flex-col gap-0.5">
            {scene.audio!.map((track) => {
              const key = `audio:${track.id}`;
              return (
                <li
                  key={track.id}
                  onClick={() => onSelect(key)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs"
                  style={{ background: selected === key ? "var(--color-surface-2)" : undefined, boxShadow: selected === key ? `inset 0 0 0 1px ${AUDIO_TINT}` : undefined }}
                >
                  <span style={{ color: AUDIO_TINT }}>
                    <MusicIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate" dir="ltr">
                    {track.id}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                    {track.pattern ?? track.kind ?? track.source}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
