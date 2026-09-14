const KEY = "rafiq-chat-handoff";

/** Text queued for the chat composer when arriving from another page (e.g. an issue). */
export function queueChatMessage(text: string): void {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // session storage unavailable — the handoff just won't prefill
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
