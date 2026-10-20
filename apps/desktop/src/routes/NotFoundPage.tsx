/**
 * The address doesn't lead anywhere (an old link, a deleted chat), or a page broke while
 * drawing. Either way: say so plainly, and offer the way back.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { NotFound } from "../components/easy/not-found";
import { Button } from "../components/ui";
import { ArrowDownIcon, HomeIcon, RefreshIcon } from "../components/Icons";
import { t } from "../i18n";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="grid min-h-[calc(100vh-44px)] place-items-center px-6">
      <NotFound code="404" badge="404 // NOT FOUND" title={t("هالصفحة مش موجودة.")} description={t("يمكن الرابط قديم، أو الشي اللي كان فيها انحذف.")}>
        <Button variant="accent" onClick={() => navigate("/")}>
          <HomeIcon className="h-4 w-4" />
          {t("ارجع للرئيسية")}
        </Button>
        <Button variant="soft" onClick={() => navigate(-1)}>
          <ArrowDownIcon className="h-4 w-4 rotate-90 rtl:-rotate-90" />
          {t("الصفحة اللي قبل")}
        </Button>
      </NotFound>
    </div>
  );
}

/** What a page that threw shows instead of a blank window. */
function Broken({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="grid min-h-[calc(100vh-44px)] place-items-center px-6">
      <NotFound code=":(" badge="ERROR // PAGE" title={t("صار خطأ بهالصفحة.")} description={error.message || t("خطأ غير معروف.")}>
        <Button variant="accent" onClick={onRetry}>
          <RefreshIcon className="h-4 w-4" />
          {t("جرّب مرة تانية")}
        </Button>
        <Button
          variant="soft"
          onClick={() => {
            window.location.hash = "#/";
            onRetry();
          }}
        >
          <HomeIcon className="h-4 w-4" />
          {t("ارجع للرئيسية")}
        </Button>
      </NotFound>
    </div>
  );
}

/** Catches a page that throws while rendering, so the rest of the app keeps working. Give
 * it a key that changes with the route, and moving to another page clears the error. */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("page crashed", error, info.componentStack);
  }

  render() {
    return this.state.error ? <Broken error={this.state.error} onRetry={() => this.setState({ error: null })} /> : this.props.children;
  }
}
