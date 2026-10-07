import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import { installExternalLinkHandler } from "./lib/links";
import { installTextSize } from "./lib/textSize";
import { applyDocumentLocale } from "./i18n";
// The type is part of the identity, so it ships with the app (works offline, never a
// fallback face on first paint): Alexandria for headings, IBM Plex Sans Arabic for text,
// Space Grotesk for numbers.
import "@fontsource-variable/alexandria";
import "@fontsource-variable/space-grotesk";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "./styles/index.css";

applyDocumentLocale();
installExternalLinkHandler();
installTextSize();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
