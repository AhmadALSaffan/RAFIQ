import {
  siAirtable,
  siAtlassian,
  siBrave,
  siClickup,
  siCloudflare,
  siCloudflareworkers,
  siDocker,
  siFigma,
  siFirebase,
  siGit,
  siGithub,
  siGitlab,
  siGooglechrome,
  siHuggingface,
  siIntercom,
  siLinear,
  siMiro,
  siModelcontextprotocol,
  siNeon,
  siNetlify,
  siNotion,
  siPaypal,
  siPostgresql,
  siPosthog,
  siPrisma,
  siSentry,
  siSqlite,
  siSquare,
  siStripe,
  siSupabase,
  siTodoist,
  siUpstash,
  siVercel,
  siWebflow,
  siWix,
  siZapier,
  type SimpleIcon,
} from "simple-icons";
import { FolderIcon, GlobeIcon, ListIcon, ModelsIcon } from "./Icons";

/** The logo of a catalogue MCP server. Brands come from simple-icons; the generic
 *  reference servers get our own glyphs; anything unknown gets the MCP mark. */
const ICONS: Record<string, SimpleIcon> = {
  github: siGithub,
  notion: siNotion,
  linear: siLinear,
  atlassian: siAtlassian,
  sentry: siSentry,
  supabase: siSupabase,
  postgres: siPostgresql,
  sqlite: siSqlite,
  stripe: siStripe,
  firebase: siFirebase,
  brave: siBrave,
  figma: siFigma,
  "cloudflare-docs": siCloudflare,
  docker: siDocker,
  context7: siUpstash,
  gitlab: siGitlab,
  vercel: siVercel,
  netlify: siNetlify,
  "cloudflare-workers": siCloudflareworkers,
  "cloudflare-observability": siCloudflare,
  posthog: siPosthog,
  neon: siNeon,
  prisma: siPrisma,
  airtable: siAirtable,
  todoist: siTodoist,
  clickup: siClickup,
  intercom: siIntercom,
  zapier: siZapier,
  miro: siMiro,
  webflow: siWebflow,
  wix: siWix,
  paypal: siPaypal,
  square: siSquare,
  huggingface: siHuggingface,
  "chrome-devtools": siGooglechrome,
  git: siGit,
};

/** Brands simple-icons doesn't carry: a monogram badge in the brand colour. */
const MONOGRAMS: Record<string, { text: string; color: string }> = {
  playwright: { text: "PW", color: "#2EAD33" },
  slack: { text: "S", color: "#4A154B" },
  semgrep: { text: "Sg", color: "#1B7A5A" },
  jam: { text: "J", color: "#E04A88" },
  monday: { text: "m", color: "#6161FF" },
  close: { text: "C", color: "#1463FF" },
  granola: { text: "G", color: "#5F7A3A" },
  canva: { text: "C", color: "#00A3C4" },
  "microsoft-learn": { text: "ML", color: "#0F6CBD" },
  deepwiki: { text: "DW", color: "#2F5BEA" },
  "aws-knowledge": { text: "AWS", color: "#232F3E" },
  exa: { text: "Ex", color: "#1F40ED" },
};

const GLYPHS: Record<string, typeof FolderIcon> = {
  filesystem: FolderIcon,
  memory: ModelsIcon,
  "sequential-thinking": ListIcon,
  fetch: GlobeIcon,
};

function isDark(hex: string): boolean {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.3;
}

/** Near-black marks (GitHub, Notion) follow the ink colour so they survive the dark theme. */
function safeColor(hex: string): string {
  return isDark(hex) ? "var(--color-ink)" : `#${hex}`;
}

/** Whether a catalogue id has its own mark (else it falls back to the MCP logo). */
export function hasMcpLogo(preset: string): boolean {
  return preset in ICONS || preset in MONOGRAMS || preset in GLYPHS;
}

export function McpLogo({ preset, className = "h-5 w-5" }: { preset: string | null | undefined; className?: string }) {
  const icon = preset ? ICONS[preset] : undefined;
  if (icon) {
    return (
      <svg role="img" viewBox="0 0 24 24" className={className} fill={safeColor(icon.hex)} aria-label={icon.title}>
        <path d={icon.path} />
      </svg>
    );
  }
  const mono = preset ? MONOGRAMS[preset] : undefined;
  if (mono) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-md font-semibold text-white ${className}`}
        style={{ background: mono.color, fontSize: "0.55em", lineHeight: 1 }}
        aria-hidden="true"
      >
        {mono.text}
      </span>
    );
  }
  const Glyph = preset ? GLYPHS[preset] : undefined;
  if (Glyph) return <Glyph className={className} style={{ color: "var(--color-ink)" }} />;
  return (
    <svg role="img" viewBox="0 0 24 24" className={className} fill="var(--color-ink-muted)" aria-label={siModelcontextprotocol.title}>
      <path d={siModelcontextprotocol.path} />
    </svg>
  );
}
