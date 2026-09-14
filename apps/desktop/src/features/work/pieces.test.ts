import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackerIssue } from "../../lib/types";
import { isOverdue, issueId } from "./pieces";

function issue(overrides: Partial<TrackerIssue> = {}): TrackerIssue {
  return {
    integration_id: "int1",
    integration_name: "Jira",
    provider: "jira",
    key: "RAF-12",
    title: "مهمة",
    url: "https://example.test/RAF-12",
    status: "To Do",
    status_category: "todo",
    project: "رفيق",
    updated_at: "2026-03-10T09:00:00",
    created_at: "2026-03-01T09:00:00",
    description: null,
    priority: "High",
    issue_type: "Bug",
    assignee: "Ahmad",
    reporter: "Sara",
    labels: [],
    due_date: null,
    parent: null,
    milestone: null,
    estimate: null,
    comment_count: null,
    ...overrides,
  };
}

describe("inbox helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("ids an issue by account and key, so two trackers can share a key", () => {
    expect(issueId(issue())).toBe("int1::RAF-12");
    expect(issueId(issue({ integration_id: "int2" }))).not.toBe(issueId(issue()));
  });

  it("counts a past due date as overdue", () => {
    expect(isOverdue(issue({ due_date: "2026-03-01T00:00:00" }))).toBe(true);
  });

  it("does not call a finished issue overdue", () => {
    expect(isOverdue(issue({ due_date: "2026-03-01T00:00:00", status_category: "done" }))).toBe(false);
  });

  it("is quiet when there's no due date or it's still ahead", () => {
    expect(isOverdue(issue())).toBe(false);
    expect(isOverdue(issue({ due_date: "2026-04-01T00:00:00" }))).toBe(false);
  });
});
