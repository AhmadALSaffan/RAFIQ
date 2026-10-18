/**
 * The app's notifications: short results that stack at the edge (a design that finished, a
 * video exported, something copied). `notify()` works from anywhere — a component, a hook, a
 * plain function — once <Toasts /> is mounted; earlier calls wait for it.
 */

import { useEffect } from "react";
import { ToastStack, ToastStackProvider, useToastStack, type ToastOptions } from "../components/arc/toast-stack/toast-stack";
import { direction, t } from "../i18n";

type Api = ReturnType<typeof useToastStack>;
let api: Api | null = null;
const waiting: (() => void)[] = [];

function whenReady(run: () => void) {
  if (api) run();
  else waiting.push(run);
}

/** Shows a notification; returns its id, for `updateToast` / `dismissToast`. */
export function notify(options: ToastOptions): string {
  const id = options.id ?? `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  whenReady(() => api?.toast({ ...options, id }));
  return id;
}

export function updateToast(id: string, patch: Partial<Omit<ToastOptions, "id">>) {
  whenReady(() => api?.update(id, patch));
}

export function dismissToast(id?: string) {
  whenReady(() => api?.dismiss(id));
}

function Bridge() {
  const stack = useToastStack();
  useEffect(() => {
    api = stack;
    waiting.splice(0).forEach((run) => run());
    return () => {
      if (api === stack) api = null;
    };
  }, [stack]);
  return null;
}

/** Mount once, around the app. Toasts gather at the end edge (left in Arabic). */
export function Toasts({ children }: { children: React.ReactNode }) {
  return (
    <ToastStackProvider>
      {children}
      <Bridge />
      <ToastStack label={t("الإشعارات")} position={direction() === "rtl" ? "bottom-left" : "bottom-right"} />
    </ToastStackProvider>
  );
}
