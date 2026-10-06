/**
 * The app's icons — one family (Tabler outline, stroke 1.75) everywhere. Pages import these
 * names, not Tabler directly, so the family can change in one place.
 */

import type { Icon as TablerIcon } from "@tabler/icons-react";
import {
  IconAlertTriangle,
  IconArchive,
  IconArrowDown,
  IconArrowsDiagonalMinimize2,
  IconBriefcase,
  IconChevronDown,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconFile,
  IconFolder,
  IconGitBranch,
  IconGitFork,
  IconHelp,
  IconHome,
  IconInbox,
  IconInfoCircle,
  IconLayoutSidebar,
  IconLink,
  IconList,
  IconListCheck,
  IconLoader2,
  IconMessageCircle,
  IconMicrophone,
  IconMoon,
  IconPaperclip,
  IconPencil,
  IconPin,
  IconPlayerStop,
  IconPlug,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShield,
  IconSparkles,
  IconStack2,
  IconStar,
  IconStarFilled,
  IconSun,
  IconTerminal2,
  IconTrash,
  IconUpload,
  IconWallet,
  IconWand,
  IconWorld,
  IconX,
} from "@tabler/icons-react";

type IconProps = { className?: string; style?: React.CSSProperties };

function make(Glyph: TablerIcon) {
  return function AppIcon({ className, style }: IconProps) {
    return <Glyph size={20} stroke={1.75} className={className} style={style} aria-hidden />;
  };
}

export const HomeIcon = make(IconHome);
export const ModelsIcon = make(IconStack2);
export const TasksIcon = make(IconListCheck);
export const SettingsIcon = make(IconSettings);
export const PlusIcon = make(IconPlus);
export const TerminalIcon = make(IconTerminal2);
export const ShieldIcon = make(IconShield);
export const CheckCircleIcon = make(IconCircleCheck);
export const XCircleIcon = make(IconCircleX);
export const ClockIcon = make(IconClock);
export const TrashIcon = make(IconTrash);
export const StopIcon = make(IconPlayerStop);
export const SunIcon = make(IconSun);
export const InboxIcon = make(IconInbox);
export const LinkIcon = make(IconLink);
export const PaperclipIcon = make(IconPaperclip);
export const MicIcon = make(IconMicrophone);
export const ForkIcon = make(IconGitFork);
export const FileIcon = make(IconFile);
export const XIcon = make(IconX);
export const SparkIcon = make(IconSparkles);
export const ChatIcon = make(IconMessageCircle);
export const FolderIcon = make(IconFolder);
export const RefreshIcon = make(IconRefresh);
export const SearchIcon = make(IconSearch);
export const AlertIcon = make(IconAlertTriangle);
export const MoonIcon = make(IconMoon);
export const CopyIcon = make(IconCopy);
export const DownloadIcon = make(IconDownload);
export const UploadIcon = make(IconUpload);
export const ArchiveIcon = make(IconArchive);
export const HelpIcon = make(IconHelp);
export const CompressIcon = make(IconArrowsDiagonalMinimize2);
export const CollapseIcon = make(IconLayoutSidebar);
export const PinIcon = make(IconPin);
export const PencilIcon = make(IconPencil);
export const ArrowDownIcon = make(IconArrowDown);
export const InfoIcon = make(IconInfoCircle);
export const ExternalIcon = make(IconExternalLink);
export const ChevronDownIcon = make(IconChevronDown);
export const BriefcaseIcon = make(IconBriefcase);
export const GitIcon = make(IconGitBranch);
export const ListIcon = make(IconList);
export const GlobeIcon = make(IconWorld);
export const WandIcon = make(IconWand);
export const PlugIcon = make(IconPlug);
export const WalletIcon = make(IconWallet);

export function SpinnerIcon({ className, style }: IconProps) {
  return <IconLoader2 size={20} stroke={1.75} className={`${className ?? ""} animate-spin`} style={style} aria-hidden />;
}

export function StarIcon({ className, style, filled = false }: IconProps & { filled?: boolean }) {
  const Glyph = filled ? IconStarFilled : IconStar;
  return <Glyph size={20} stroke={1.75} className={className} style={style} aria-hidden />;
}
