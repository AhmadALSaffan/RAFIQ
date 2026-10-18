/** Arc's link: a plain anchor (Rafiq routes with hash URLs, so `href="#/…"` just works). */
import type { AnchorHTMLAttributes, Ref } from "react";

export interface ArcLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  ref?: Ref<HTMLAnchorElement>;
}

export function ArcLink(props: ArcLinkProps) {
  return <a {...props} />;
}
