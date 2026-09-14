import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import { installExternalLinkHandler } from "./lib/links";
import { applyDocumentLocale } from "./i18n";
import "./styles/index.css";

applyDocumentLocale();
installExternalLinkHandler();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
