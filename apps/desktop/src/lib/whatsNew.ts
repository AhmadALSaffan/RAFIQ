/**
 * "What's new": after an update installs, the new version shows what changed — a short
 * video and the main points — until the user closes it themselves (closing Rafiq with it
 * open brings it back next time). A fresh install doesn't (the welcome covers it), and a
 * version with nothing listed here passes silently.
 *
 * The video lives online (its links are in the entry: an .mp4 or a YouTube video, one per
 * language), so the installer doesn't carry it; offline, the dialog shows the points alone.
 */

import { t, type Locale } from "../i18n";
import chatgptPicture from "../assets/whats-new/0.5.6.webp";

// The version whose dialog the user closed. (A new key: the first builds marked a version
// seen as soon as it opened, shown or not.)
export const SEEN_KEY = "rafiq-whats-new-closed";
/** Fired on window to open the dialog again (the About page's "What's new"). */
export const OPEN_EVENT = "rafiq:whats-new";

export interface ReleaseNews {
  version: string;
  /** The video in each language (a direct .mp4 link or a YouTube link). A language without
   *  its own gets the Arabic one; none at all = the release's whats-new.mp4. */
  videos?: Partial<Record<Locale, string>>;
  /** A picture instead of a video (shipped with the app, so it shows offline too). */
  image?: string;
  title: () => string;
  points: () => string[];
}

export const NEWS: ReleaseNews[] = [
  {
    version: "0.5.6",
    image: chatgptPicture,
    title: () => t("سجّل دخول بـ ChatGPT واستخدم خطتك"),
    points: () => [
      t("ربط حساب ChatGPT (Plus أو Pro) من الإعدادات ← الحسابات المتصلة، أو وأنت عم تضيف موديل"),
      t("طلبات رفيق بتنحسب من خطتك — بدون مفتاح API ولا دفع إضافي"),
      t("بتختار أي موديل متاح بخطتك، وبيشتغل بالمحادثات والمهام"),
      t("الدخول من صفحة OpenAI نفسها — رفيق ما بيشوف كلمة السر"),
    ],
  },
  {
    version: "0.5.5",
    videos: {
      ar: "https://ik.imagekit.io/ahmadalsaffan/Rafiq_Updates/v14-notes.mp4",
      en: "https://ik.imagekit.io/ahmadalsaffan/Rafiq_Updates/v14-notes-en.mp4",
      ru: "https://ik.imagekit.io/ahmadalsaffan/Rafiq_Updates/v14-notes-ru.mp4",
    },
    title: () => t("ملاحظاتك، بالعربي والإنجليزي سوا"),
    points: () => [
      t("صفحة «ملاحظات»: كل ملاحظة ملف Markdown بمجلدك، بمجلدات وبحث وتثبيت"),
      t("كل سطر بياخد اتجاهه من كلامه، والكلمات الإنجليزية جوّا الجملة العربية بتضل بمحلها"),
      t("«ساعدني» بيرتّب أو يكمّل أو يترجم أو يصحّح النص اللي محدّده"),
      t("احفظ أي رد كملاحظة، وشاور على ملاحظاتك بالمحادثة من @"),
      t("افتح أي ملف Markdown من الويندوز برفيق، وصدّره PDF أو Word"),
    ],
  },
];

export function newsFor(version: string): ReleaseNews | undefined {
  return NEWS.find((n) => n.version === version);
}

export function videoUrl(news: ReleaseNews, lang: Locale): string {
  return news.videos?.[lang] ?? news.videos?.ar ?? `https://github.com/AhmadALSaffan/RAFIQ/releases/download/v${news.version}/whats-new.mp4`;
}

/** The video's id when the link is a YouTube one (watch, youtu.be, shorts or embed). */
export function youtubeId(url: string): string | null {
  const match = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url);
  return match ? match[1] : null;
}

export function releaseUrl(version: string): string {
  return `https://github.com/AhmadALSaffan/RAFIQ/releases/tag/v${version}`;
}

/**
 * Whether this launch shows the dialog. `closed` is the version whose dialog the user
 * closed last; with none, `usedBefore` (a model added, or the welcome finished) tells an
 * update from a first install.
 */
export function shouldShow(current: string, closed: string | null, usedBefore: boolean): boolean {
  if (closed === current) return false;
  if (closed === null && !usedBefore) return false;
  return Boolean(newsFor(current));
}

export function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function markSeen(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    // shown again next time — harmless
  }
}
