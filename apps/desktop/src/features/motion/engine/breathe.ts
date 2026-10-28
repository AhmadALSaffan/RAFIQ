/**
 * Long engine work (checking every quarter second of a reel, drawing frames for the model)
 * runs on the page's own thread. Done in one go it freezes the app until it's finished, which
 * on a laptop is seconds. `breather()` gives a function to call inside such a loop: after
 * `budget` ms of work it lets the page draw and take clicks, then carries on. The result is
 * the same; only the waiting is spread out.
 */

/** One turn of the page's event loop. A message, not a timer: a timer in a window that's
 *  in the background waits a whole second, and the model is often working while you're
 *  elsewhere. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export function breather(budget = 12): () => Promise<void> {
  let since = performance.now();
  return async () => {
    if (performance.now() - since < budget) return;
    await nextTurn();
    since = performance.now();
  };
}
