type IconProps = { className?: string; style?: React.CSSProperties };

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function ModelsIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
      <path d="M3 12l9 4.5 9-4.5" />
      <path d="M3 16.5l9 4.5 9-4.5" />
    </svg>
  );
}

export function TasksIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <path d="m4 6 1 1 2-2" />
      <path d="m4 12 1 1 2-2" />
      <path d="m4 18 1 1 2-2" />
    </svg>
  );
}

export function SettingsIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.65 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.65a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.65a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.35 9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  );
}

export function PlusIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TerminalIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  );
}

export function ShieldIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M12 3 4.5 6v6c0 4.5 3 7.5 7.5 9 4.5-1.5 7.5-4.5 7.5-9V6L12 3Z" />
    </svg>
  );
}

export function CheckCircleIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}

export function XCircleIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
    </svg>
  );
}

export function ClockIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function SpinnerIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={`${className ?? ""} animate-spin`} style={style}>
      <path d="M21 12a9 9 0 1 1-3.6-7.2" />
    </svg>
  );
}

export function TrashIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  );
}

export function StopIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function SunIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function InboxIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M3 13h4l1.5 3h7L17 13h4" />
      <path d="M5.5 5h13l2.5 8v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4l2.5-8Z" />
    </svg>
  );
}

export function LinkIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1L11.5 4.4" />
      <path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.4-1.4" />
    </svg>
  );
}

export function PaperclipIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="m20.5 11.5-8.3 8.3a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
    </svg>
  );
}

export function MicIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </svg>
  );
}

export function ForkIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="6" cy="4" r="2" />
      <circle cx="6" cy="20" r="2" />
      <circle cx="18" cy="9" r="2" />
      <path d="M6 6v12M6 13h6a4 4 0 0 0 4-4v-.5" />
    </svg>
  );
}

export function FileIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

export function XIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function SparkIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

export function ChatIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12Z" />
      <path d="M9 11h.01M12 11h.01M15 11h.01" />
    </svg>
  );
}

export function FolderIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

export function RefreshIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 20v-4h-4" />
    </svg>
  );
}

export function SearchIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function AlertIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M12 4 2.5 20h19L12 4Z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  );
}

export function MoonIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

export function CopyIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

export function DownloadIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function UploadIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M12 16V4" />
      <path d="m7 8 5-5 5 5" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function ArchiveIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

export function HelpIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.2A2.6 2.6 0 0 1 14.5 10c0 1.7-2.5 2-2.5 3.6" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}

/** Two arrows folding inward — the "condense this chat" mark. */
export function CompressIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M4 5h16" />
      <path d="M4 19h16" />
      <path d="M12 8v3" />
      <path d="m9 8.5 3-2.5 3 2.5" />
      <path d="M12 16v-3" />
      <path d="m9 15.5 3 2.5 3-2.5" />
    </svg>
  );
}

/** Panel with a collapse arrow — the sidebar fold control. */
export function CollapseIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
      <path d="m10 10 2 2-2 2" />
    </svg>
  );
}

export function PinIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M9 3h6l-.8 5.2 3 2.8H6.8l3-2.8L9 3Z" />
      <path d="M12 11v10" />
    </svg>
  );
}

export function PencilIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14.5 6.5 3 3" />
    </svg>
  );
}

export function ArrowDownIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </svg>
  );
}

/** A circled "i" — the About page's mark. */
export function InfoIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.8h.01" />
    </svg>
  );
}

/** Arrow leaving a box — "this opens outside the app". */
export function ExternalIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </svg>
  );
}

export function ChevronDownIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function BriefcaseIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 12h18" />
    </svg>
  );
}

export function GitIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="8" r="2" />
      <path d="M6 7v10" />
      <path d="M18 10a4 4 0 0 1-4 4h-4a4 4 0 0 0-4 3" />
    </svg>
  );
}

export function ListIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

export function GlobeIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
    </svg>
  );
}

export function WandIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="m15 4 5 5" />
      <path d="M3 21 14 10" />
      <path d="m14 3 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z" />
    </svg>
  );
}

export function PlugIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12l-1 5a5 5 0 0 1-10 0L6 8Z" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function WalletIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2" />
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M16 14h.01" />
    </svg>
  );
}
