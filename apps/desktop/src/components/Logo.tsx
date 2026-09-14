import iconUrl from "../assets/rafiq-icon.png";

import { t } from "../i18n";
/** The Rafiq mark. The source already includes its orange rounded square. */
export function Logo({ className = "h-8 w-8", alt = t("رفيق") }: { className?: string; alt?: string }) {
  return <img src={iconUrl} alt={alt} draggable={false} className={`select-none rounded-[22%] ${className}`} />;
}

export { iconUrl as logoUrl };
