/**
 * The engine's end of the agent channel. While the app is open, a model working on a motion
 * project can have frames measured, checked, drawn, analysed and exported here — the same
 * engine the preview uses, so what the model is told is what the user sees. The engine
 * itself loads on the first request, so the app starts as fast as before.
 */

import { useEffect } from "react";
import { listenToEngineRequests, replyToEngine, type EngineRequest } from "../../lib/api";

async function handle(request: EngineRequest): Promise<unknown> {
  const mod = await import("./hostHandlers");
  return mod.handle(request);
}

/** Keeps the channel open for as long as the app runs, reconnecting after a drop. */
export function useMotionEngineHost(): void {
  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    (async () => {
      let delay = 1000;
      while (!stopped) {
        try {
          await listenToEngineRequests((request) => {
            if (request.kind === "hello") {
              delay = 1000;
              return;
            }
            handle(request)
              .then((result) => replyToEngine(request.id, true, result))
              .catch((error) => replyToEngine(request.id, false, undefined, error instanceof Error ? error.message : String(error)));
          }, controller.signal);
        } catch {
          /* the agent restarted, or isn't up yet */
        }
        if (stopped) break;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(15000, delay * 2);
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, []);
}
