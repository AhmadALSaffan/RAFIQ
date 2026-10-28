/**
 * The engine's end of the agent channel. While a motion project is open, a model working on
 * it can have frames measured, checked, drawn, analysed and exported here — the same
 * engine the preview uses, so what the model is told is what the user sees. The channel is
 * open only while a motion project is open (the engine is the heaviest thing in the app);
 * with none open, the agent falls back to its structural checks and tells the model so.
 */

import { useEffect } from "react";
import { listenToEngineRequests, replyToEngine, type EngineRequest } from "../../lib/api";

let loaded: Promise<typeof import("./hostHandlers")> | null = null;

async function handle(request: EngineRequest): Promise<unknown> {
  loaded ??= import("./hostHandlers");
  const mod = await loaded;
  return mod.handle(request);
}

/** Keeps the channel open while the page that calls it is open, reconnecting after a drop;
 *  closing the page lets the engine go. */
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
      if (loaded) void loaded.then((mod) => mod.closeEngine());
    };
  }, []);
}
