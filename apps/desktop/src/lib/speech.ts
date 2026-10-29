/**
 * Replies read out loud. Windows' own voices ("system") play right here through the
 * browser engine — free, and nothing leaves the machine; the other providers are asked by
 * the agent (/speak) with the keys the user already gave them.
 *
 * One voice at a time: starting a reply stops whatever was being read. The id of the reply
 * being read is shared, so its button shows "stop" and the voice conversation knows when
 * the reading is over.
 */

import { useSyncExternalStore } from "react";
import { getSettings, speakText } from "./api";
import { t } from "../i18n";

export type SpeakProvider = "system" | "openai" | "elevenlabs" | "azure" | "local";

/** How much of a reply is read: a long one is cut at a sentence near here. */
export const MAX_SPOKEN = 4000;

const ARABIC_COMMA = String.fromCharCode(0x060c);
const ARABIC_QUESTION = String.fromCharCode(0x061f);

/** The words of a Markdown reply as they'd be said: no code, links read by their text,
 * no markup symbols, no bare addresses. */
export function speakable(markdown: string): string {
  let text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, " ")
    .replace(/\|/g, ARABIC_COMMA + " ")
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, "$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (text.length > MAX_SPOKEN) {
    const cut = text.slice(0, MAX_SPOKEN);
    const end = Math.max(cut.lastIndexOf("."), cut.lastIndexOf(ARABIC_QUESTION), cut.lastIndexOf("!"), cut.lastIndexOf("\n"));
    text = end > MAX_SPOKEN / 2 ? cut.slice(0, end + 1) : cut;
  }
  return text;
}

/** Which language a reply is in, for picking a Windows voice. */
export function languageOf(text: string): "ar" | "ru" | "en" {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic >= cyrillic && arabic >= latin && arabic > 0) return "ar";
  if (cyrillic > latin) return "ru";
  return "en";
}

/** Short pieces for the browser's speech engine, which stalls on long ones: whole
 * sentences, glued together up to `limit`. */
export function chunks(text: string, limit = 220): string[] {
  const sentences = text.split(/(?<=[.!?؟\n])\s+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const sentence of sentences) {
    for (let i = 0; i < sentence.length; i += limit) {
      const piece = sentence.slice(i, i + limit);
      const last = out[out.length - 1];
      if (last && last.length + piece.length + 1 <= limit) out[out.length - 1] = `${last} ${piece}`;
      else out.push(piece);
    }
  }
  return out;
}

// ── Who is speaking ───────────────────────────────────────────────────────────────────

let current: string | null = null;
let stopCurrent: (() => void) | null = null;
const listeners = new Set<() => void>();

function setCurrent(id: string | null) {
  current = id;
  listeners.forEach((l) => l());
}

/** The id of the reply being read now, or null. */
export function useSpeaking(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function stopSpeaking() {
  stopCurrent?.();
  stopCurrent = null;
  setCurrent(null);
}

function voices(): Promise<SpeechSynthesisVoice[]> {
  const now = window.speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  // The list fills in a moment after the page starts.
  return new Promise((resolve) => {
    const done = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    window.setTimeout(done, 1200);
  });
}

/** Windows' voice for the reply's language, or null when it has none (many machines
 * come without an Arabic one). */
async function windowsVoiceFor(text: string, voiceName: string | null | undefined): Promise<SpeechSynthesisVoice | null> {
  if (!("speechSynthesis" in window)) return null;
  const lang = languageOf(text);
  const all = await voices();
  return all.find((v) => v.name === voiceName && v.lang.toLowerCase().startsWith(lang)) ?? all.find((v) => v.lang.toLowerCase().startsWith(lang)) ?? null;
}

async function speakWithWindows(text: string, voice: SpeechSynthesisVoice, stopped: () => boolean): Promise<void> {
  for (const piece of chunks(text)) {
    if (stopped()) return;
    await new Promise<void>((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(piece);
      u.voice = voice;
      u.lang = voice.lang;
      u.onend = () => resolve();
      u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? resolve() : reject(new Error(e.error)));
      window.speechSynthesis.speak(u);
    });
  }
}

/** Every Windows voice there is, for the picker in Settings. */
export async function windowsVoices(): Promise<{ name: string; lang: string }[]> {
  if (!("speechSynthesis" in window)) return [];
  return (await voices()).map((v) => ({ name: v.name, lang: v.lang }));
}

/**
 * Reads `markdown` (a reply) out loud as `id`. Resolves when the reading ends — or is
 * stopped, or another reply starts; rejects with a reason the user can act on.
 */
export async function speak(id: string, markdown: string, provider: SpeakProvider, voice?: string | null): Promise<void> {
  stopSpeaking();
  const text = speakable(markdown);
  if (!text) return;
  let stopped = false;
  const controller = new AbortController();
  let audio: HTMLAudioElement | null = null;
  stopCurrent = () => {
    stopped = true;
    controller.abort();
    if (provider === "system" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    audio?.pause();
  };
  setCurrent(id);
  try {
    // Windows' voices when it has one for this language; otherwise the agent picks another
    // voice there is (the local one, or a provider's).
    const windowsVoice = provider === "system" ? await windowsVoiceFor(text, voice) : null;
    if (windowsVoice) {
      await speakWithWindows(text, windowsVoice, () => stopped);
      return;
    }
    const blob = await speakText(text, controller.signal, provider === "system");
    if (stopped) return;
    const url = URL.createObjectURL(blob);
    audio = new Audio(url);
    try {
      await new Promise<void>((resolve, reject) => {
        audio!.onended = () => resolve();
        audio!.onpause = () => resolve();
        audio!.onerror = () => reject(new Error(t("ما قدرت أشغّل الصوت.")));
        void audio!.play().catch(reject);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    if (stopped || (e instanceof DOMException && e.name === "AbortError")) return;
    throw e;
  } finally {
    if (current === id && !stopped) {
      stopCurrent = null;
      setCurrent(null);
    }
  }
}

/** `speak` with the provider and voice from the user's settings. */
export async function speakReply(id: string, markdown: string): Promise<void> {
  const settings = await getSettings().catch(() => null);
  await speak(id, markdown, settings?.speak_provider ?? "system", settings?.speak_voice);
}
