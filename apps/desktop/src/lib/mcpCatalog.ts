import { t } from "../i18n";
import type { McpRequirements } from "./types";

/**
 * Ready-made MCP servers. The user picks one and only fills what it truly needs — a
 * token, a folder, a connection string — or nothing at all; OAuth servers open the
 * provider's own sign-in page. The command line and URL stay out of sight (they're here,
 * the way each server's docs say to run it).
 */
export interface McpSecretField {
  /** Header name (http) or env var (stdio) the value goes into. */
  key: string;
  label: string;
  help?: string;
  /** Where to create the token. */
  url?: string;
}

export interface McpParam {
  label: string;
  placeholder: string;
  kind: "folder" | "text";
  help?: string;
}

export interface McpPreset {
  id: string;
  name: string;
  blurb: string;
  transport: "stdio" | "http";
  command?: string;
  /** `{param}` is replaced by the user's `param` value. */
  args?: string;
  url?: string;
  /** "oauth": sign in through the browser. "token": paste a key. "none": just connect. */
  auth: "oauth" | "token" | "none";
  secrets?: McpSecretField[];
  param?: McpParam;
  /** Runtime the command needs, so the UI can warn before it fails. */
  needs?: keyof McpRequirements;
  docs: string;
  category: "code" | "docs" | "work" | "data" | "web" | "other";
  /** Something the user should know before connecting (e.g. a CLI login). */
  note?: string;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "github",
    name: "GitHub",
    blurb: t("مستودعات، PRs، issues والـ Actions — من حساب GitHub تبعك."),
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    auth: "token",
    secrets: [
      {
        key: "Authorization",
        label: t("توكن GitHub"),
        help: t("Personal access token (classic أو fine-grained) بصلاحيات repo وissues وpull requests. الصق التوكن بس — رفيق بيضيف Bearer لحاله."),
        url: "https://github.com/settings/tokens",
      },
    ],
    docs: "https://github.com/github/github-mcp-server",
    category: "code",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    blurb: t("قراءة وكتابة ملفات بمجلدات بتحددها إنت (خارج مجلد المحادثة)."),
    transport: "stdio",
    command: "npx",
    args: "-y @modelcontextprotocol/server-filesystem {param}",
    auth: "none",
    param: { label: t("المجلد اللي بيقدر يوصله"), placeholder: "C:\\Users\\you\\Projects", kind: "folder" },
    needs: "npx",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    category: "data",
  },
  {
    id: "memory",
    name: "Knowledge graph",
    blurb: t("ذاكرة على شكل رسم بياني للكيانات والعلاقات، بتضل بين الجلسات."),
    transport: "stdio",
    command: "npx",
    args: "-y @modelcontextprotocol/server-memory",
    auth: "none",
    needs: "npx",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    category: "other",
  },
  {
    id: "sequential-thinking",
    name: "Sequential thinking",
    blurb: t("بيخلّي النموذج يفكّر خطوة خطوة بمسائل معقّدة ويراجع نفسه."),
    transport: "stdio",
    command: "npx",
    args: "-y @modelcontextprotocol/server-sequential-thinking",
    auth: "none",
    needs: "npx",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    category: "other",
  },
  {
    id: "playwright",
    name: "Playwright",
    blurb: t("متصفح كامل من Microsoft: تصفّح، ضغط، تعبئة نماذج، ولقطات شاشة."),
    transport: "stdio",
    command: "npx",
    args: "-y @playwright/mcp@latest",
    auth: "none",
    needs: "npx",
    docs: "https://github.com/microsoft/playwright-mcp",
    category: "web",
  },
  {
    id: "fetch",
    name: "Fetch",
    blurb: t("بيجيب صفحة ويب وبيحوّلها لنص نظيف للنموذج."),
    transport: "stdio",
    command: "uvx",
    args: "mcp-server-fetch",
    auth: "none",
    needs: "uvx",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    category: "web",
  },
  {
    id: "context7",
    name: "Context7",
    blurb: t("توثيق محدّث لأي مكتبة برمجية، بدل ما النموذج يخمّن من ذاكرته."),
    transport: "stdio",
    command: "npx",
    args: "-y @upstash/context7-mcp",
    auth: "none",
    needs: "npx",
    docs: "https://github.com/upstash/context7",
    category: "docs",
  },
  {
    id: "notion",
    name: "Notion",
    blurb: t("صفحات وقواعد بيانات Notion — بحث، قراءة، وإنشاء."),
    transport: "http",
    url: "https://mcp.notion.com/mcp",
    auth: "oauth",
    docs: "https://developers.notion.com/docs/mcp",
    category: "work",
  },
  {
    id: "linear",
    name: "Linear",
    blurb: t("مهام ومشاريع Linear من داخل المحادثة."),
    transport: "http",
    url: "https://mcp.linear.app/mcp",
    auth: "oauth",
    docs: "https://linear.app/docs/mcp",
    category: "work",
  },
  {
    id: "atlassian",
    name: "Atlassian (Jira & Confluence)",
    blurb: t("Jira وConfluence عبر خادم Atlassian الرسمي."),
    transport: "http",
    url: "https://mcp.atlassian.com/v1/mcp",
    auth: "oauth",
    docs: "https://support.atlassian.com/atlassian-rovo-mcp-server/",
    category: "work",
  },
  {
    id: "sentry",
    name: "Sentry",
    blurb: t("الأخطاء والـ issues من Sentry، مع تفاصيلها."),
    transport: "http",
    url: "https://mcp.sentry.dev/mcp",
    auth: "oauth",
    docs: "https://docs.sentry.io/product/sentry-mcp/",
    category: "code",
  },
  {
    id: "supabase",
    name: "Supabase",
    blurb: t("جداول، استعلامات SQL، وإدارة مشاريع Supabase."),
    transport: "stdio",
    command: "npx",
    args: "-y @supabase/mcp-server-supabase@latest",
    auth: "token",
    secrets: [{ key: "SUPABASE_ACCESS_TOKEN", label: t("Access token من Supabase"), url: "https://supabase.com/dashboard/account/tokens" }],
    needs: "npx",
    docs: "https://supabase.com/docs/guides/getting-started/mcp",
    category: "data",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    blurb: t("استعلامات قراءة على قاعدة Postgres عبر رابط الاتصال."),
    transport: "stdio",
    command: "npx",
    args: "-y @modelcontextprotocol/server-postgres {param}",
    auth: "none",
    param: { label: t("رابط الاتصال"), placeholder: "postgresql://user:pass@localhost:5432/db", kind: "text", help: t("بينحفظ مع إعداد الخادم — استخدم مستخدم قراءة بس.") },
    needs: "npx",
    docs: "https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres",
    category: "data",
  },
  {
    id: "sqlite",
    name: "SQLite",
    blurb: t("استعلام وتحليل ملفات SQLite محلية."),
    transport: "stdio",
    command: "uvx",
    args: "mcp-server-sqlite --db-path {param}",
    auth: "none",
    param: { label: t("ملف قاعدة البيانات"), placeholder: "C:\\data\\app.db", kind: "text" },
    needs: "uvx",
    docs: "https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sqlite",
    category: "data",
  },
  {
    id: "stripe",
    name: "Stripe",
    blurb: t("عملاء، فواتير، ومدفوعات Stripe."),
    transport: "http",
    url: "https://mcp.stripe.com",
    auth: "oauth",
    docs: "https://docs.stripe.com/mcp",
    category: "work",
  },
  {
    id: "firebase",
    name: "Firebase",
    blurb: t("مشاريع Firebase: Firestore، Auth، والاستضافة."),
    transport: "stdio",
    command: "npx",
    args: "-y firebase-tools@latest experimental:mcp",
    auth: "none",
    needs: "npx",
    note: t("بيستخدم تسجيل دخولك بـ firebase-tools (شغّل «npx firebase login» مرة بالطرفية)."),
    docs: "https://firebase.google.com/docs/cli/mcp-server",
    category: "data",
  },
  {
    id: "brave",
    name: "Brave Search",
    blurb: t("بحث ويب ومحلي عبر Brave (بمفتاح API)."),
    transport: "stdio",
    command: "npx",
    args: "-y @brave/brave-search-mcp-server",
    auth: "token",
    secrets: [{ key: "BRAVE_API_KEY", label: t("مفتاح Brave Search API"), url: "https://api-dashboard.search.brave.com/" }],
    needs: "npx",
    docs: "https://github.com/brave/brave-search-mcp-server",
    category: "web",
  },
  {
    id: "slack",
    name: "Slack",
    blurb: t("قنوات ورسائل Slack (توكن بوت)."),
    transport: "stdio",
    command: "npx",
    args: "-y @modelcontextprotocol/server-slack",
    auth: "token",
    secrets: [
      { key: "SLACK_BOT_TOKEN", label: t("Bot token (xoxb-…)"), url: "https://api.slack.com/apps" },
      { key: "SLACK_TEAM_ID", label: t("Team ID (T…)"), help: t("من رابط مساحة العمل أو إعدادات التطبيق.") },
    ],
    needs: "npx",
    docs: "https://github.com/modelcontextprotocol/servers-archived/tree/main/src/slack",
    category: "work",
  },
  {
    id: "figma",
    name: "Figma",
    blurb: t("ملفات وتصاميم Figma عبر الخادم الرسمي."),
    transport: "http",
    url: "https://mcp.figma.com/mcp",
    auth: "oauth",
    docs: "https://help.figma.com/hc/en-us/articles/32132100833559",
    category: "docs",
  },
  {
    id: "cloudflare-docs",
    name: "Cloudflare docs",
    blurb: t("توثيق Cloudflare كامل، بدون مفتاح."),
    transport: "http",
    url: "https://docs.mcp.cloudflare.com/mcp",
    auth: "none",
    docs: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
    category: "docs",
  },
  {
    id: "docker",
    name: "Docker",
    blurb: t("حاويات وصور Docker على جهازك."),
    transport: "stdio",
    command: "docker",
    args: "mcp gateway run",
    auth: "none",
    needs: "docker",
    docs: "https://docs.docker.com/ai/mcp-catalog-and-toolkit/",
    category: "code",
  },
];

export function presetById(id: string | null | undefined): McpPreset | undefined {
  return id ? MCP_PRESETS.find((p) => p.id === id) : undefined;
}

export const MCP_CATEGORY_LABEL: Record<McpPreset["category"], string> = {
  code: t("برمجة"),
  docs: t("توثيق وتصميم"),
  work: t("شغل وفرق"),
  data: t("بيانات"),
  web: t("ويب"),
  other: t("أخرى"),
};

export const REQUIREMENT_LABEL: Record<keyof McpRequirements, string> = {
  node: "Node.js",
  npx: "Node.js (npx)",
  uvx: "uv (uvx)",
  python: "Python",
  docker: "Docker",
};

export const REQUIREMENT_URL: Record<keyof McpRequirements, string> = {
  node: "https://nodejs.org/",
  npx: "https://nodejs.org/",
  uvx: "https://docs.astral.sh/uv/getting-started/installation/",
  python: "https://www.python.org/downloads/",
  docker: "https://www.docker.com/products/docker-desktop/",
};
