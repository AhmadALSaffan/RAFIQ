// The type is part of the identity, so it ships with the app (works offline, never a
// fallback face on first paint): Alexandria for headings, IBM Plex Sans Arabic for text,
// Space Grotesk for numbers.
import "@fontsource-variable/alexandria";
import "@fontsource-variable/space-grotesk";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "./styles/index.css";
import { adoptInstallerLanguage } from "./lib/firstLanguage";

// The language is settled first (on the first launch, the one picked in the installer):
// the i18n module reads it once, when it loads, so everything else loads after.
async function boot(): Promise<void> {
  await adoptInstallerLanguage();
  const [{ StrictMode }, { createRoot }, { HashRouter }, { App }, { installExternalLinkHandler }, { installTextSize }, { applyDocumentLocale }] =
    await Promise.all([
      import("react"),
      import("react-dom/client"),
      import("react-router-dom"),
      import("./App"),
      import("./lib/links"),
      import("./lib/textSize"),
      import("./i18n"),
    ]);

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
}

void boot();
