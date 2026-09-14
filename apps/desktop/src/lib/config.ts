export interface ApiConfig {
  baseUrl: string;
  token: string;
}

interface RustApiConfig {
  base_url: string;
  token: string;
}

let cached: Promise<ApiConfig> | undefined;

/**
 * Resolves where the local FastAPI sidecar lives and the bearer token required to
 * call it. Inside the packaged Tauri app this comes from the `get_api_config` Rust
 * command — the Rust side picks a free port, generates a random token, and spawns
 * the backend with it on startup. In plain `vite dev` (no Rust toolchain available
 * when this was first scaffolded) it falls back to env vars pointing at a manually
 * started `uvicorn` instance.
 */
export function getApiConfig(): Promise<ApiConfig> {
  if (!cached) {
    cached = resolveApiConfig();
  }
  return cached;
}

async function resolveApiConfig(): Promise<ApiConfig> {
  const { isTauri, invoke } = await import("@tauri-apps/api/core");
  if (isTauri()) {
    const config = await invoke<RustApiConfig>("get_api_config");
    return { baseUrl: config.base_url, token: config.token };
  }

  return {
    baseUrl: import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8765",
    token: import.meta.env.VITE_API_TOKEN ?? "dev-token",
  };
}
