/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_API_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** package.json version, injected by vite.config.ts. */
declare const __APP_VERSION__: string;
