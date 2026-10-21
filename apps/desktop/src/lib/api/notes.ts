/** The user's notes: Markdown files in their notes folder (agent: api/notes.py). */

import { request } from "./client";
import { getApiConfig } from "../config";
import { wordsDir } from "../noteBidi";

export interface NoteEntry {
  path: string;
  name: string;
  kind: "dir" | "note";
  mtime: number;
  size: number;
  title: string;
  /** The first line of text under the title. */
  excerpt?: string;
}

export interface NotesTree {
  root: string;
  default_root: string;
  pinned: string[];
  items: NoteEntry[];
}

export interface NoteFile {
  path: string;
  name: string;
  content: string;
  mtime: number;
  /** A file opened from elsewhere on the machine, not one in the notes folder. */
  external: boolean;
}

export interface NoteHit {
  path: string;
  title: string;
  line: number;
  snippet: string;
}

export type AssistAction = "tidy" | "continue" | "translate" | "shorten" | "fix";

export function notesTree(): Promise<NotesTree> {
  return request<NotesTree>("/notes/tree");
}

export function searchNotes(q: string): Promise<NoteHit[]> {
  return request<NoteHit[]>(`/notes/search?${new URLSearchParams({ q })}`);
}

export function readNote(path: string): Promise<NoteFile> {
  return request<NoteFile>(`/notes/file?${new URLSearchParams({ path })}`);
}

/** Saves a note. With `baseMtime`, a file changed elsewhere since is refused (status 409). */
export function saveNote(path: string, content: string, baseMtime?: number | null): Promise<{ path: string; mtime: number }> {
  return request("/notes/file", { method: "PUT", body: JSON.stringify({ path, content, base_mtime: baseMtime ?? null }) });
}

export function newNote(body: { folder?: string; title?: string; content?: string }): Promise<{ path: string; mtime: number }> {
  return request("/notes/new", { method: "POST", body: JSON.stringify(body) });
}

export function newNotesFolder(path: string): Promise<{ path: string }> {
  return request("/notes/folder", { method: "POST", body: JSON.stringify({ path }) });
}

export function moveNote(src: string, dst: string): Promise<{ path: string }> {
  return request("/notes/move", { method: "POST", body: JSON.stringify({ src, dst }) });
}

export function trashNote(path: string): Promise<{ path: string }> {
  return request("/notes/trash", { method: "POST", body: JSON.stringify({ path }) });
}

export function pinNote(path: string, pinned: boolean): Promise<{ pinned: string[] }> {
  return request("/notes/pin", { method: "POST", body: JSON.stringify({ path, pinned }) });
}

export function saveNoteImage(note: string, name: string, dataUrl: string): Promise<{ src: string }> {
  return request("/notes/image", { method: "POST", body: JSON.stringify({ note, name, data_url: dataUrl }) });
}

/** A picture a note links to, for an <img> (it can't send the Authorization header). */
export async function noteImageUrl(note: string, src: string): Promise<string> {
  const { baseUrl, token } = await getApiConfig();
  return `${baseUrl}/notes/image?${new URLSearchParams({ note, src, token })}`;
}

export function exportNote(path: string, dest: string): Promise<{ path: string }> {
  return request("/notes/export", { method: "POST", body: JSON.stringify({ path, dest, format: "docx" }) });
}

export function assistNote(action: AssistAction, text: string, modelId?: string | null): Promise<{ text: string; model: string }> {
  return request("/notes/assist", { method: "POST", body: JSON.stringify({ action, text, model_id: modelId ?? null }) });
}

/**
 * The token a chat message uses for a note, ready to insert: `@note:<path>` without `.md`
 * and with spaces as `_` (a mention ends at a space). It sits in an isolate that runs the
 * way the note's name is written, so an Arabic name reads right to left in the box.
 */
export function noteMention(path: string): string {
  const name = path.replace(/\.(md|markdown)$/i, "").replace(/ /g, "_");
  const token = `@note:${name}`;
  const [open, close] = [String.fromCharCode(wordsDir(name) === "rtl" ? 0x2067 : 0x2066), String.fromCharCode(0x2069)];
  return `${open}${token}${close}`;
}
