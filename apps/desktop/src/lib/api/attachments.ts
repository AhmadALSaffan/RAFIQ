/** Uploads: images and documents a message or a task carries. */

import { getApiConfig } from "../config";
import type {
  Attachment,
} from "../types";

/** Uploads one file; reports 0–1 progress (XHR, since fetch can't observe upload progress). */
export async function uploadAttachment(
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Attachment> {
  const { baseUrl, token } = await getApiConfig();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${baseUrl}/attachments`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON error body
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Attachment);
      else reject(new Error((body as { detail?: string } | null)?.detail ?? `فشل الرفع (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("ما قدرت أرفع الملف"));
    signal?.addEventListener("abort", () => {
      xhr.abort();
      reject(new DOMException("aborted", "AbortError"));
    });
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export async function attachmentUrl(id: string): Promise<string> {
  const { baseUrl, token } = await getApiConfig();
  return `${baseUrl}/attachments/${id}/raw?token=${encodeURIComponent(token)}`;
}
