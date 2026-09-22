/**
 * Backing up and restoring Rafiq's data.
 *
 * In the app, the file is picked in the native dialog and only its path crosses to the agent,
 * which reads or writes it directly. The browser build has no dialog, so it downloads and
 * uploads the bytes instead.
 */

import { getApiConfig } from "../config";
import { locale } from "../../i18n";
import { request, tracked } from "./client";
import type { BackupManifest, BackupSaved, RestoreResult } from "../types";

export function saveBackup(path: string): Promise<BackupSaved> {
  return request<BackupSaved>("/backup/save", { method: "POST", body: JSON.stringify({ path }) });
}

export function inspectBackup(path: string): Promise<BackupManifest> {
  return request<BackupManifest>("/backup/inspect", { method: "POST", body: JSON.stringify({ path }) });
}

export function restoreBackupFile(path: string): Promise<RestoreResult> {
  return request<RestoreResult>("/backup/restore-file", { method: "POST", body: JSON.stringify({ path }) });
}

async function raw(path: string, init: RequestInit): Promise<Response> {
  const { baseUrl, token } = await getApiConfig();
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Accept-Language": locale(), ...init.headers },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `${res.status} ${res.statusText}`);
  }
  return res;
}

/** The browser build: the backup as a file to download. */
export async function downloadBackup(): Promise<Blob> {
  return tracked(raw("/backup", { method: "GET" }).then((res) => res.blob()));
}

/** The browser build: a backup the user picked, uploaded and restored. */
export async function restoreBackupUpload(file: File): Promise<RestoreResult> {
  const form = new FormData();
  form.append("file", file);
  return tracked(raw("/backup/restore", { method: "POST", body: form }).then((res) => res.json() as Promise<RestoreResult>));
}
