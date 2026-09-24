export type Provider =
  | "anthropic"
  | "openai"
  | "gemini"
  | "deepseek"
  | "groq"
  | "mistral"
  | "xai"
  | "openrouter"
  | "azure"
  | "bedrock"
  | "vertex_ai"
  | "cerebras"
  | "fireworks_ai"
  | "together_ai"
  | "dashscope"
  | "moonshot"
  | "zai"
  | "lm_studio"
  | "ollama"
  | "custom"
  | "github_copilot"
  | "authai";

export interface LlmModel {
  id: string;
  name: string;
  provider: Provider;
  model_id: string;
  base_url?: string | null;
  has_key: boolean;
  created_at: string;
  verify_ok: boolean | null;
  verify_error: string | null;
  verify_latency_ms: number | null;
  verified_at: string | null;
  supports_tools: boolean | null;
  /** "api_key" or "oauth" (signs in with a connected account). */
  auth_method: AuthMethod;
  account_id: string | null;
  /** Who the agent signs in as — a display name, never a token. */
  account_label: string | null;
  account_status: "connected" | "disconnected" | null;
  /** Another agent that takes over when this one's provider keeps failing. */
  fallback_model_id?: string | null;
  /** Non-secret provider settings (region, api_version, project…). */
  options?: Record<string, string>;
  /** Tools this model brings itself, so Rafiq doesn't offer a second one (e.g. web_fetch). */
  native_tools?: string[];
}

export type AuthMethod = "api_key" | "oauth";

/** A provider that supports signing in with an account. */
export interface AccountProvider {
  id: Provider;
  name: string;
  method: string;
  experimental: boolean;
  available: boolean;
  unavailable_reason: string | null;
}

export interface AuthAccount {
  id: string;
  provider: Provider;
  method: string;
  label: string;
  status: "connected" | "disconnected";
  created_at: string;
  verified_at: string | null;
  /** Names of the agents that sign in with this account. */
  used_by: string[];
}

export interface ConnectStart {
  flow_id: string;
  /** "device": type `user_code` at `verification_uri`. "browser": open it and approve. */
  kind: "device" | "browser";
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/** AuthAI (experimental) settings. The app secret is write-only — only `has_secret` comes back. */
export interface AuthAIConfig {
  enabled: boolean;
  relay_url: string | null;
  has_secret: boolean;
}

export interface ConnectPoll {
  status: "pending" | "complete" | "expired" | "denied" | "error";
  message: string | null;
  account: AuthAccount | null;
}

export interface DiscoveredModel {
  id: string;
  display_name: string;
}

export type TaskStatus = "queued" | "pending" | "running" | "planned" | "completed" | "failed" | "cancelled";

/** "auto" runs straight through; "plan" writes a plan and waits for approval; "step" asks
 *  before every write or command. */
export type TaskMode = "auto" | "plan" | "step";

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  kind: "image" | "text" | "pdf" | "binary";
  size: number;
}

export interface TaskSummary {
  id: string;
  title: string;
  model_id: string;
  working_dir: string | null;
  attachments: Attachment[] | null;
  origin: { chat_id?: string } | null;
  mode?: TaskMode;
  /** The plan the model wrote (plan mode), as approved. */
  plan?: string | null;
  workspace_id?: string | null;
  status: TaskStatus;
  needs_approval: boolean;
  /** Its changes in git (null when the folder isn't a repository). */
  changes?: ChangesState | null;
  /** Works in its own git worktree. */
  isolated?: boolean;
  created_at: string;
  /** Last time the task moved; once it stops running this is when it finished. */
  updated_at: string;
}

export type ToolCategory = "read_only" | "write" | "exec";

export interface ToolCall {
  tool: string;
  category: ToolCategory;
  args: Record<string, unknown>;
  /** What the call would change — a diff for a file write — shown on the permission card. */
  preview?: string;
}

export type TaskEvent =
  | { id: string; type: "message"; role: "agent"; text: string; created_at: string }
  | { id: string; type: "tool_call"; call: ToolCall; created_at: string }
  | { id: string; type: "tool_result"; tool: string; ok: boolean; output: string; created_at: string }
  | {
      id: string;
      type: "permission_request";
      call: ToolCall;
      resolution: "pending" | "approved" | "denied";
      created_at: string;
    }
  | { id: string; type: "status"; status: TaskStatus; note?: string; created_at: string }
  | { id: string; type: "plan"; text: string; created_at: string }
  | { id: string; type: "plan_approved"; text: string; created_at: string }
  | { id: string; type: "error"; message: string; created_at: string };

export interface TaskDetail extends TaskSummary {
  prompt: string;
  events: TaskEvent[];
}

export type ReplyLength = "short" | "balanced" | "detailed";
export type ReplyLanguage = "auto" | "ar" | "en" | "ru";

/** Per-chat generation settings — each field maps to a real knob on the request. */
export interface ReplySettings {
  length: ReplyLength;
  language: ReplyLanguage;
  temperature: number | null;
  tools: boolean;
  reasoning: boolean;
  reasoning_effort: "low" | "medium" | "high" | null;
  auto_summarize: boolean;
  /** Rafiq's search tool for this chat. null = decide by the model: one that searches the
   *  web itself uses its own; anything else gets Rafiq's. */
  web_search: boolean | null;
  /** The two heaviest tool groups. Off = their schemas are never sent. */
  mcp: boolean;
  browser: boolean;
  /** No tools, no thinking, a short answer — the cheapest a turn can be. */
  economy: boolean;
  /** Token saving. On: skills are named and the model reads the ones it wants. Off: every
   *  skill is described in the prompt, every message. */
  saver: boolean;
}

/** What one reply cost, as the agent counted it. */
export interface TurnUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cost_usd: number;
}

/** A chat that matched a search inside chats (agent core/search.py). */
export interface ChatSearchResult {
  chat_id: string;
  title: string;
  updated_at: string;
  pinned: boolean;
  title_match: boolean;
  /** Archived chats are still found; the list marks them. */
  archived: boolean;
  /** Messages in this chat containing every word of the search. */
  matches: number;
  /** The best matching message, cut around the match; `marks` are [start, end) in `text`. */
  snippet: { message_id: string; role: string; text: string; marks: [number, number][] } | null;
}

export interface ChatSummary {
  id: string;
  title: string;
  /** Set when archived: out of the list, still searchable, back on the next message. */
  archived_at?: string | null;
  model_id: string | null;
  working_dir: string | null;
  workspace_id?: string | null;
  settings: ReplySettings;
  summary: string | null;
  summary_until: string | null;
  pinned: boolean;
  message_count: number;
  /** A reply is being written right now — the chat page reattaches to it. */
  streaming?: boolean;
  created_at: string;
  updated_at: string;
}

export interface SummarizeResult {
  summary: string;
  summary_until: string;
  folded_messages: number;
  approx_tokens_before: number;
  approx_tokens_after: number;
}

export type Resolution = "pending" | "approved" | "denied";

export type ChatPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; tool: string; args: Record<string, unknown>; ok?: boolean; output?: string }
  | { kind: "permission"; id: string; call: ToolCall; resolution: Resolution }
  | { kind: "task"; task_id: string; title: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string | null;
  model_id?: string | null;
  parts?: ChatPart[] | null;
  attachments?: Attachment[] | null;
  created_at: string;
}

export interface ChatDetail extends ChatSummary {
  messages: ChatMessage[];
}

export interface IntegrationField {
  key: string;
  label: string;
  kind: "text" | "password" | "url";
  placeholder: string;
  required: boolean;
  help: string;
}

export interface IntegrationProvider {
  id: string;
  name: string;
  icon: string;
  color: string;
  docs_url: string;
  blurb: string;
  secret_field: string;
  fields: IntegrationField[];
}

export interface IntegrationAccount {
  id: string;
  provider: string;
  name: string;
  config: Record<string, string>;
  account_label: string | null;
  verify_ok: boolean | null;
  verify_error: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface TrackerIssue {
  integration_id: string;
  integration_name: string;
  provider: string;
  key: string;
  title: string;
  url: string;
  status: string;
  status_category: "todo" | "in_progress" | "done" | null;
  project: string | null;
  updated_at: string | null;
  created_at: string | null;
  description: string | null;
  priority: string | null;
  issue_type: string | null;
  assignee: string | null;
  reporter: string | null;
  labels: string[];
  due_date: string | null;
  parent: string | null;
  milestone: string | null;
  estimate: string | null;
  comment_count: number | null;
}

/** A state an issue can move to, as the tracker reports it. */
export interface StatusOption {
  id: string;
  name: string;
  category: "todo" | "in_progress" | "done" | null;
}

export interface IssueComment {
  author: string;
  body: string;
  created_at: string | null;
}

export interface TrackerIssueDetail extends TrackerIssue {
  comments: IssueComment[];
  comments_error: string | null;
}

export interface WorkspaceFile {
  path: string;
  name: string;
  size: number;
  depth: number;
}

export type PermissionMode = "auto" | "ask" | "deny";

export type PermissionKey =
  | "filesystem_write"
  | "shell"
  | "process"
  | "browser_navigate"
  | "desktop_control"
  | "issue_write"
  | "mcp"
  | "memory";

export type WebSearchProvider = "none" | "brave" | "tavily" | "searxng";

export interface AppSettings {
  permissions: Record<PermissionKey, PermissionMode>;
  desktop_control_enabled: boolean;
  /** How many tasks may run at once (1–100); tasks editing the same files still take turns. */
  max_parallel_tasks: number;
  /** Requests to one provider credential in flight at once (the rest wait instead of hitting 429s). */
  provider_concurrency: number;
  /** Tasks on a git repository each work in their own worktree. */
  task_isolation: boolean;
  /** Which agent runs the tasks a chat opens (null = the chat's own). */
  task_model_id: string | null;
  /** Which agent does Rafiq's own chores — summaries, commit messages (null = the chat's). */
  helper_model_id: string | null;
  web_search_provider: WebSearchProvider;
  searxng_url: string | null;
  /** The browser tool opens a visible window (off = headless). */
  browser_visible: boolean;
  /** Closing the window keeps Rafiq running in the tray. */
  run_in_background: boolean;
  /** Stop calling providers once this much is spent today / this month (0 = no limit). */
  daily_budget_usd: number;
  monthly_budget_usd: number;
  /** The speech-to-text model the composer's microphone uses. */
  transcribe_model: string;
  /** Rafiq may remember things across chats (each save still goes through the "memory" permission). */
  memory_enabled: boolean;
  /** What a new chat's "save tokens" starts at; each chat can still flip its own copy. */
  token_saver: boolean;
}

/** What a backup holds, read from its manifest (see agent core/backup.py). */
export interface BackupCounts {
  chats: number;
  messages: number;
  tasks: number;
  models: number;
  memories: number;
  skills: number;
  attachments: number;
}

export interface BackupManifest {
  version: string;
  created_at: string;
  counts: BackupCounts;
}

export interface BackupSaved {
  path: string;
  manifest: BackupManifest;
}

export interface RestoreResult {
  manifest: BackupManifest;
  /** Where the data that was replaced went — restoring it undoes the restore. */
  safety_copy: string;
  /** Models and connections whose key this computer doesn't have (backups carry no secrets). */
  missing_secrets: number;
}

/** Something the user asked Rafiq to remember — shown to every chat and task. */
export interface Memory {
  id: string;
  text: string;
  kind: string;
  source_chat_id: string | null;
  enabled: boolean;
  created_at: string;
}

/** A project: its folder, preferred model and standing instructions. */
export interface Workspace {
  id: string;
  name: string;
  working_dir: string | null;
  model_id: string | null;
  instructions: string | null;
  color: string | null;
  created_at: string;
  chats: number;
  tasks: number;
  designs: number;
}

export type WorkspaceInput = Pick<Workspace, "name" | "working_dir" | "model_id" | "instructions" | "color">;

export interface CatalogTemplate {
  name: string;
  prompt: string;
  tags: string[];
}

export interface McpRequirements {
  node: boolean;
  npx: boolean;
  uvx: boolean;
  python: boolean;
  docker: boolean;
}

export interface CommitDescription {
  commit_message: string;
  pr_title: string;
  pr_body: string;
}

export interface UsageByModel {
  model_ref: string | null;
  name: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cost_usd: number;
}

export interface UsageSummary {
  days: number;
  today_usd: number;
  month_usd: number;
  daily_budget_usd: number;
  monthly_budget_usd: number;
  total_usd: number;
  total_tokens: number;
  by_model: UsageByModel[];
  by_day: { date: string; cost_usd: number; tokens: number }[];
}

/** The bug report — see the agent's api/insights.py; carries nothing secret. */
/** A log file the agent can show: its own, or one MCP server's. */
export interface LogInfo {
  id: string;
  name: string;
  kind: "agent" | "mcp";
  size: number;
  modified: string;
}

/** The tail of a log, already scrubbed of secrets by the agent. */
export interface LogOut extends LogInfo {
  text: string;
  lines: number;
  /** Older lines exist that weren't sent. */
  truncated: boolean;
  path: string;
}

export interface Diagnostics {
  generated_at: string;
  version: string;
  python: string;
  platform: string;
  frozen: boolean;
  settings: Record<string, unknown>;
  models: Record<string, unknown>[];
  mcp_servers: Record<string, unknown>[];
  counts: Record<string, number>;
  recent_failures: Record<string, unknown>[];
  usage: Record<string, number>;
}

export interface WebSearchKeys {
  brave: boolean;
  tavily: boolean;
}

/** A task's changes in git — see the agent's core/task_git.py. */
export type ChangesState = "running" | "applied" | "pending" | "conflict" | "reverted" | "empty" | "error";

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface TaskChanges {
  available: boolean;
  mode: "worktree" | "inplace" | "none" | null;
  state: ChangesState | null;
  error: string | null;
  files: ChangedFile[];
  diff: string;
  truncated: boolean;
}

export interface TaskTemplate {
  id: string;
  name: string;
  prompt: string;
  model_id: string | null;
  working_dir: string | null;
  created_at: string;
}

export type ScheduleKind = "interval" | "daily" | "weekly";

export interface ScheduleInput {
  title: string;
  prompt: string;
  model_id: string;
  working_dir: string | null;
  kind: ScheduleKind;
  every_minutes: number | null;
  at_time: string | null;
  /** 0 = Monday … 6 = Sunday */
  weekdays: number[] | null;
  enabled: boolean;
}

export interface Schedule extends ScheduleInput {
  id: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_task_id: string | null;
  created_at: string;
}

export interface McpServerInput {
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  url: string | null;
  /** Secret values. On update an empty value keeps the saved one; a key left out is removed. */
  env: Record<string, string>;
  headers: Record<string, string>;
  enabled: boolean;
  /** "oauth": the user signs in through the browser; tokens stay in the credential store. */
  auth: "none" | "oauth";
  /** Catalogue entry it was made from (lib/mcpCatalog.ts); null for a custom server. */
  preset: string | null;
}

export interface McpConnectResult {
  /** The page to open for an OAuth sign-in; absent when already connected. */
  authorize_url: string | null;
  connected: boolean;
  error: string | null;
}

export interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  url: string | null;
  enabled: boolean;
  /** Names of the saved secrets — never their values. */
  secret_keys: string[];
  auth: "none" | "oauth";
  preset: string | null;
  /** OAuth servers: the browser step is done. */
  authorized: boolean;
  status: { connected: boolean; tools: string[]; error: string | null };
}

export interface InitQuestion {
  id: string;
  label: string;
  kind: "text" | "choice" | "multi";
  options?: string[];
  placeholder?: string;
  required: boolean;
}

export type DesignStatus = "draft" | "ready" | "handed_off";

export interface DesignSummary {
  id: string;
  title: string;
  chat_id: string;
  model_id: string | null;
  working_dir: string | null;
  status: DesignStatus;
  has_preview: boolean;
  created_at: string;
  updated_at: string;
}

/** One document of a design. A design usually has one; a model that answers with a second
 *  screen adds another, and the preview lets you switch between them. */
export interface DesignFile {
  name: string;
  html: string;
  /** Where it was written on disk, when the design has a folder. */
  path: string | null;
}

/** Something the design preview can open: a document from the conversation, or an HTML
 *  file sitting in the design's folder. */
export interface DesignDocument {
  name: string;
  source: "chat" | "folder";
  path: string | null;
  size: number | null;
}

export interface Design {
  /** First message of the design chat; sent automatically while that chat is empty. */
  kickoff: string;
  id: string;
  title: string;
  brief: Record<string, string | string[]> | null;
  spec: string | null;
  preview_html: string | null;
  /** Every document, oldest first; the preview opens on the one the model touched last. */
  files: DesignFile[];
  chat_id: string;
  model_id: string | null;
  working_dir: string | null;
  /** Where the latest preview was written on disk, when a folder is set. */
  saved_path: string | null;
  status: DesignStatus;
  created_at: string;
  updated_at: string;
}

export interface HandoffResult {
  message: string;
  chat_id: string | null;
  task_id: string | null;
}

/** A slash command a skill adds to the composer. */
export interface SkillCommand {
  name: string;
  description: string;
  prompt: string;
}

export interface AgentSkill {
  name: string;
  description: string;
  source: "bundled" | "user";
  files: string[];
  commands: SkillCommand[];
}

export interface SkillInstallResult {
  skills: AgentSkill[];
  /** Every "/command" the install brought. */
  commands: string[];
}
