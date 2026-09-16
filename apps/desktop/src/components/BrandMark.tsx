import {
  siAnthropic,
  siDeepseek,
  siGithub,
  siGithubcopilot,
  siGitlab,
  siGooglegemini,
  siJira,
  siLinear,
  siMistralai,
  siOllama,
  siOpenrouter,
  type SimpleIcon,
} from "simple-icons";
import { BRAND_PATHS } from "./brandPaths";

/** Icons that ship with simple-icons, keyed by our provider ids. */
const ICONS: Record<string, SimpleIcon> = {
  anthropic: siAnthropic,
  gemini: siGooglegemini,
  deepseek: siDeepseek,
  mistral: siMistralai,
  openrouter: siOpenrouter,
  ollama: siOllama,
  jira: siJira,
  linear: siLinear,
  github: siGithub,
  github_copilot: siGithubcopilot,
  gitlab: siGitlab,
};

/** Whatever has no icon at all falls back to a monogram badge in its brand colour. */
const MONOGRAMS: Record<string, { text: string; color: string }> = {
  xai: { text: "X", color: "#111111" },
  custom: { text: "⚙", color: "#8B8B8B" },
  authai: { text: "A", color: "#B7791F" },
  azure: { text: "Az", color: "#0078D4" },
  bedrock: { text: "aws", color: "#FF9900" },
  vertex_ai: { text: "V", color: "#4285F4" },
  cerebras: { text: "C", color: "#F05A28" },
  fireworks_ai: { text: "F", color: "#5C24E0" },
  together_ai: { text: "T", color: "#0F6FFF" },
  dashscope: { text: "Q", color: "#615CED" },
  moonshot: { text: "K", color: "#1A1A1A" },
  zai: { text: "Z", color: "#2B6CF5" },
  lm_studio: { text: "LM", color: "#4338CA" },
};

function isDark(hex: string): boolean {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.3;
}

/** Near-black marks (GitHub, Ollama, Anthropic…) would vanish on the dark theme, so
 *  they follow the ink colour, which already flips with the theme. */
function safeColor(hex: string): string {
  return isDark(hex) ? "var(--color-ink)" : `#${hex.replace("#", "")}`;
}

export function BrandMark({ provider, className = "h-4 w-4" }: { provider: string; className?: string }) {
  const icon = ICONS[provider];
  if (icon) {
    return (
      <svg role="img" viewBox="0 0 24 24" className={className} fill={safeColor(icon.hex)} aria-label={icon.title}>
        <path d={icon.path} />
      </svg>
    );
  }

  const brand = BRAND_PATHS[provider];
  if (brand) {
    return (
      <svg role="img" viewBox={brand.viewBox} className={className} fill={safeColor(brand.hex)} aria-label={brand.title}>
        <path d={brand.path} />
      </svg>
    );
  }

  const mono = MONOGRAMS[provider] ?? { text: provider.slice(0, 1).toUpperCase(), color: "#8B8B8B" };
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md text-[0.6em] font-bold leading-none ${className}`}
      style={{ background: `color-mix(in oklch, ${mono.color} 18%, transparent)`, color: safeColor(mono.color) }}
      aria-label={provider}
    >
      {mono.text}
    </span>
  );
}
