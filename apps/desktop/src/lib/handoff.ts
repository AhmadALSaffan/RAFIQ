const KEY = "rafiq-chat-handoff";

/** Text queued for the chat composer when arriving from another page (e.g. an issue). */
export function queueChatMessage(text: string): void {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // session storage unavailable — the handoff just won't prefill
  }
}

const SEND_KEY = "rafiq-chat-send";

export interface ChatSend {
  text: string;
  /** The model the user picked for it. */
  model: string | null;
}

/** A message to *send* as soon as the chat page opens (the home screen's box), on the model picked there. */
export function queueChatSend(text: string, model: string | null = null): void {
  try {
    sessionStorage.setItem(SEND_KEY, JSON.stringify({ text, model }));
  } catch {
    // session storage unavailable — nothing to send
  }
}

export function takeChatSend(): ChatSend | null {
  try {
    const value = sessionStorage.getItem(SEND_KEY);
    if (!value) return null;
    sessionStorage.removeItem(SEND_KEY);
    const parsed = JSON.parse(value) as Partial<ChatSend>;
    return typeof parsed.text === "string" && parsed.text ? { text: parsed.text, model: parsed.model ?? null } : null;
  } catch {
    return null;
  }
}

export function takeChatMessage(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}
