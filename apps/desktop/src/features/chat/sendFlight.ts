/**
 * Where a sent message left from: the composer remembers its text box as it sends, and the
 * new bubble flies from there to its place in the conversation.
 */

let origin: { rect: DOMRect; at: number } | null = null;

export function rememberSendOrigin(el: Element | null): void {
  origin = el ? { rect: el.getBoundingClientRect(), at: performance.now() } : null;
}

/** The composer's box for a message sent just now (a new chat may take a moment to open). */
export function sendOrigin(): DOMRect | null {
  return origin && performance.now() - origin.at < 2500 ? origin.rect : null;
}

export function forgetSendOrigin(): void {
  origin = null;
}
