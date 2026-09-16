/**
 * Live status for the tasks shown in a chat.
 *
 * A reply can create up to a hundred tasks; polling each one would be a hundred requests
 * every few seconds. Instead every task card on screen shares one poll of the task list,
 * which runs only while some watched task is still waiting or running.
 */

import { useEffect, useState } from "react";
import { listTasks } from "../../lib/api";
import type { TaskStatus, TaskSummary } from "../../lib/types";

export const ACTIVE: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["queued", "pending", "running"]);
const EVERY_MS = 2000;
// A task missing from this many polls in a row was deleted (a just-created one shows up
// on the next poll).
const GONE_AFTER = 3;

const listeners = new Set<() => void>();
const watched = new Map<string, number>();
const missing = new Map<string, number>();
let known = new Map<string, TaskSummary>();
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight = false;
let again = false;

function stillMoving(id: string): boolean {
  const task = known.get(id);
  if (!task) return (missing.get(id) ?? 0) < GONE_AFTER;
  return ACTIVE.has(task.status);
}

async function poll(): Promise<void> {
  timer = undefined;
  if (inflight) {
    again = true;
    return;
  }
  inflight = true;
  try {
    const tasks = await listTasks();
    known = new Map(tasks.map((task) => [task.id, task]));
    for (const id of watched.keys()) missing.set(id, known.has(id) ? 0 : (missing.get(id) ?? 0) + 1);
    listeners.forEach((listener) => listener());
  } catch {
    // the agent is busy or restarting — the next poll catches up
  } finally {
    inflight = false;
  }
  if (again) {
    again = false;
    void poll();
  } else if (!timer && [...watched.keys()].some(stillMoving)) {
    timer = setTimeout(poll, EVERY_MS);
  }
}

function pollNow(): void {
  clearTimeout(timer);
  timer = undefined;
  void poll();
}

/** The latest summary of each task id (absent = not seen yet, or deleted — see `isGone`). */
export function useTaskSummaries(ids: string[]): Map<string, TaskSummary> {
  const key = ids.join(",");
  const [, rerender] = useState(0);

  useEffect(() => {
    const list = key ? key.split(",") : [];
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    list.forEach((id) => watched.set(id, (watched.get(id) ?? 0) + 1));
    if (list.some(stillMoving)) pollNow();
    return () => {
      listeners.delete(listener);
      for (const id of list) {
        const left = (watched.get(id) ?? 1) - 1;
        if (left > 0) watched.set(id, left);
        else watched.delete(id);
      }
    };
  }, [key]);

  return known;
}

export function isGone(id: string): boolean {
  return !known.has(id) && (missing.get(id) ?? 0) >= GONE_AFTER;
}
