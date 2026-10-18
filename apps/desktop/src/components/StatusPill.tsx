import type { TaskStatus } from "../lib/types";
import { statusLabel } from "../lib/api";
import { Badge, type BadgeTone } from "./arc/badge/badge";
import { ClockIcon, ShieldIcon, SpinnerIcon, XCircleIcon } from "./Icons";
import { DrawnCheck } from "./ui";

const tone: Record<TaskStatus, BadgeTone> = {
  queued: "neutral",
  pending: "neutral",
  running: "info",
  planned: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "running") return <SpinnerIcon className="h-3.5 w-3.5" />;
  if (status === "completed") return <DrawnCheck className="h-3.5 w-3.5" />;
  if (status === "pending" || status === "queued") return <ClockIcon className="h-3.5 w-3.5" />;
  if (status === "planned") return <ShieldIcon className="h-3.5 w-3.5" />;
  return <XCircleIcon className="h-3.5 w-3.5" />;
}

/** A task's status: a badge whose label and icon swap in place as the task moves along. */
export function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <Badge tone={tone[status]} icon={<StatusIcon status={status} />} className="shrink-0">
      {statusLabel(status)}
    </Badge>
  );
}
