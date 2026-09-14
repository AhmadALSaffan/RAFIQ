export type Provider =
  | "anthropic"
  | "openai"
  | "gemini"
  | "deepseek"
  | "groq"
  | "mistral"
  | "xai"
  | "openrouter"
  | "ollama"
  | "custom";

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
}

export interface DiscoveredModel {
  id: string;
  display_name: string;
}

export type TaskStatus = "queued" | "pending" | "running" | "completed" | "failed" | "cancelled";

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
  status: TaskStatus;
  needs_approval: boolean;
  created_at: string;
  /** Last time the task moved; once it stops running this is when it finished. */
  updated_at: string;
}

export type ToolCategory = "read_only" | "write" | "exec";

export interface ToolCall {
  tool: string;
  category: ToolCategory;
  args: Record<string, unknown>;
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
  | { id: string; type: "error"; message: string; created_at: string };

export interface TaskDetail extends TaskSummary {
  prompt: string;
  events: TaskEvent[];
}

export type ReplyLength = "short" | "balanced" | "detailed";
export type ReplyLanguage = "auto" | "ar" | "en";

/** Per-chat generation settings — each field maps to a real knob on the request. */
export interface ReplySettings {
  length: ReplyLength;
  language: ReplyLanguage;
  temperature: number | null;
  tools: boolean;
  reasoning: boolean;
  reasoning_effort: "low" | "medium" | "high" | null;
  auto_summarize: boolean;
}

export interface ChatSummary {
  id: string;
  title: string;
  model_id: string | null;
  working_dir: string | null;
  settings: ReplySettings;
  summary: string | null;
  summary_until: string | null;
  pinned: boolean;
  message_count: number;
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
  | "issue_write";

export interface AppSettings {
  permissions: Record<PermissionKey, PermissionMode>;
  desktop_control_enabled: boolean;
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

export interface Design {
  /** First message of the design chat; sent automatically while that chat is empty. */
  kickoff: string;
  id: string;
  title: string;
  brief: Record<string, string | string[]> | null;
  spec: string | null;
  preview_html: string | null;
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

export interface AgentSkill {
  name: string;
  description: string;
  source: "bundled" | "user";
  files: string[];
}
