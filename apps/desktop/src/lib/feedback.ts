/**
 * Suggestions and problem reports from the people using Rafiq. There's no server of our own
 * yet, so a report leaves the app one of two ways, and the user picks: a GitHub issue
 * filled in and ready to post, or an email in their own mail program. Nothing is sent from
 * here — the user sees it and sends it themselves.
 */

export const FEEDBACK_REPO = "https://github.com/AhmadALSaffan/RAFIQ";
export const FEEDBACK_EMAIL = "ahmadalsaffan9@gmail.com";

export type FeedbackKind = "idea" | "bug" | "other";

export interface FeedbackDraft {
  kind: FeedbackKind;
  title: string;
  details: string;
  /** Add the app version, Windows and the language, so a problem can be reproduced. */
  withSystem: boolean;
}

const PREFIX: Record<FeedbackKind, string> = { idea: "Suggestion", bug: "Bug", other: "Feedback" };
const LABEL: Record<FeedbackKind, string> = { idea: "enhancement", bug: "bug", other: "feedback" };

// Long addresses get cut by browsers and mail programs; the details are trimmed to fit.
const MAX_ISSUE_URL = 7000;
const MAX_MAIL_URL = 1900;

export function systemLines(version: string, userAgent: string, language: string): string {
  const windows = /Windows NT 10\.0/.test(userAgent) ? "Windows 10/11" : /Windows/.test(userAgent) ? "Windows" : userAgent.slice(0, 60);
  return [`Rafiq ${version}`, windows, `UI: ${language}`].join(" · ");
}

function body(draft: FeedbackDraft, system: string | null): string {
  return draft.details.trim() + (draft.withSystem && system ? `\n\n---\n${system}` : "");
}

/** Fits `text` into an address of at most `max` characters by trimming the details. */
function fit(make: (details: string) => string, details: string, max: number): string {
  let url = make(details);
  let keep = details.length;
  while (url.length > max && keep > 0) {
    keep = Math.max(0, keep - Math.max(50, Math.ceil((url.length - max) / 3)));
    url = make(details.slice(0, keep).trimEnd() + "…");
  }
  return url;
}

export function issueUrl(draft: FeedbackDraft, system: string | null = null): string {
  const title = `[${PREFIX[draft.kind]}] ${draft.title.trim()}`;
  return fit(
    (details) =>
      `${FEEDBACK_REPO}/issues/new?` +
      new URLSearchParams({ title, body: body({ ...draft, details }, system), labels: LABEL[draft.kind] }).toString(),
    draft.details.trim(),
    MAX_ISSUE_URL,
  );
}

export function mailUrl(draft: FeedbackDraft, system: string | null = null): string {
  const subject = `Rafiq — ${PREFIX[draft.kind]}: ${draft.title.trim()}`;
  // mailto wants %20 for spaces, not "+".
  const q = (v: string) => encodeURIComponent(v);
  return fit((details) => `mailto:${FEEDBACK_EMAIL}?subject=${q(subject)}&body=${q(body({ ...draft, details }, system))}`, draft.details.trim(), MAX_MAIL_URL);
}
