/** App-wide settings (permission policy, desktop control). */

import { request } from "./client";
import type {
  AppSettings,
} from "../types";

export async function getSettings(): Promise<AppSettings> {
  return request<AppSettings>("/settings");
}

export async function updateSettings(next: AppSettings): Promise<AppSettings> {
  return request<AppSettings>("/settings", { method: "PUT", body: JSON.stringify(next) });
}
