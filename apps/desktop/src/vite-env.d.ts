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

/** Every icon name the motion engine draws, by set (a virtual module in vite.config.ts). */
declare module "virtual:icon-names" {
  const sets: Record<string, string[]>;
  export default sets;
}

/** Every simple-icons brand mark, slug → SVG path (a virtual module in vite.config.ts). */
declare module "virtual:simple-icon-paths" {
  const paths: Record<string, string>;
  export default paths;
}

/** Every Tabler outline icon as SVG nodes (aliased in vite.config.ts). */
declare module "tabler-nodes-outline" {
  const nodes: Record<string, [string, Record<string, string | number>][]>;
  export default nodes;
}

