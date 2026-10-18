/**
 * The icon names the Arc components use, drawn with Rafiq's own family (Tabler, stroke 1.75)
 * so they sit with every other icon in the app. Directional ones mirror in right-to-left.
 */

import type { Icon as TablerIcon } from "@tabler/icons-react";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowUp,
  IconBold,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconCircleX,
  IconCode,
  IconCopy,
  IconFile,
  IconFileCode,
  IconFileText,
  IconFileZip,
  IconFolder,
  IconFolderOpen,
  IconH1,
  IconH2,
  IconH3,
  IconInfoCircle,
  IconItalic,
  IconLink,
  IconList,
  IconListNumbers,
  IconMinus,
  IconMovie,
  IconPhoto,
  IconPilcrow,
  IconQuote,
  IconRotateClockwise,
  IconRotate,
  IconLoader2,
  IconSearch,
  IconSourceCode,
  IconStrikethrough,
  IconUnlink,
  IconX,
} from "@tabler/icons-react";

export type ArcIconProps = {
  size?: number | string;
  width?: number | string;
  height?: number | string;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
};

function make(Icon: TablerIcon, mirror = false) {
  return function ArcIcon({ size, width, height, strokeWidth, className, style, ...rest }: ArcIconProps) {
    const box = size ?? width ?? height ?? 16;
    return (
      <Icon
        size={box}
        stroke={strokeWidth ?? 1.75}
        className={`${mirror ? "arc-mirror " : ""}${className ?? ""}`}
        style={style}
        aria-hidden={rest["aria-hidden"] ?? true}
      />
    );
  };
}

export const Check = make(IconCheck);
export const X = make(IconX);
export const ChevronDown = make(IconChevronDown);
export const ChevronRight = make(IconChevronRight, true);
export const ChevronLeft = make(IconChevronLeft, true);
export const ArrowLeft = make(IconArrowLeft, true);
export const ArrowUp = make(IconArrowUp);
export const Copy = make(IconCopy);
export const Info = make(IconInfoCircle);
export const CircleAlert = make(IconAlertCircle);
export const CircleCheck = make(IconCircleCheck);
export const CircleX = make(IconCircleX);
export const TriangleAlert = make(IconAlertTriangle);
export const RotateCw = make(IconRotateClockwise);
export const File = make(IconFile);
export const FileArchive = make(IconFileZip);
export const FileCode2 = make(IconFileCode);
export const FileImage = make(IconPhoto);
export const FilePlay = make(IconMovie);
export const FileText = make(IconFileText);
export const Folder = make(IconFolder);
export const FolderOpen = make(IconFolderOpen);
export const Bold = make(IconBold);
export const Italic = make(IconItalic);
export const Strikethrough = make(IconStrikethrough);
export const Code = make(IconCode);
export const SquareCode = make(IconSourceCode);
export const Heading1 = make(IconH1);
export const Heading2 = make(IconH2);
export const Heading3 = make(IconH3);
export const Link = make(IconLink);
export const Unlink = make(IconUnlink);
export const List = make(IconList);
export const ListOrdered = make(IconListNumbers);
export const Minus = make(IconMinus);
export const Pilcrow = make(IconPilcrow);
export const Quote = make(IconQuote);
export const LoaderCircle = make(IconLoader2);
export const RotateCcw = make(IconRotate);
export const Search = make(IconSearch);
