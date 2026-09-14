import type { Provider } from "../../lib/types";

/** How an account reads in the UI: GitHub logins get their "@", key-based sign-ins don't. */
export function accountLabel(provider: Provider, label: string): string {
  return provider === "github_copilot" ? `@${label}` : label;
}
