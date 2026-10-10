import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { ContextMenuProvider } from "./components/ContextMenu";
import { BootGate } from "./components/BootGate";
import { TopProgress } from "./components/TopProgress";
import { ChatPage } from "./features/chat";
import { ModelsPage } from "./routes/ModelsPage";
import { IntegrationsPage } from "./routes/IntegrationsPage";
import { WorkPage } from "./features/work";
import { DesignsPage } from "./routes/DesignsPage";
import { DesignWorkspace } from "./routes/DesignWorkspace";
import { MotionPage } from "./routes/MotionPage";
import { MotionWorkspace } from "./routes/MotionWorkspace";
import { TasksPage } from "./features/tasks/TasksPage";
import { TaskDetailPage } from "./features/tasks/TaskDetailPage";
import { SettingsPage } from "./routes/SettingsPage";
import { AboutPage } from "./routes/AboutPage";
import { GuidePage } from "./routes/GuidePage";
import { QuickAsk } from "./routes/QuickAsk";
import { HomePage } from "./routes/HomePage";

// The design-system sheet only exists in dev builds.
const DesignSystemPage = import.meta.env.DEV ? lazy(() => import("./routes/DesignSystemPage").then((m) => ({ default: m.DesignSystemPage }))) : null;

export function App() {
  return (
    <ContextMenuProvider>
      <TopProgress />
      <BootGate>
        <Routes>
          {/* The quick-ask window (global shortcut): no sidebar, just the box. */}
          <Route path="/quick" element={<QuickAsk />} />
          <Route element={<Shell />}>
            <Route index element={<HomePage />} />
            {/* One optional-param route so /chat → /chat/:id never remounts the page mid-stream. */}
            <Route path="/chat/:id?" element={<ChatPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/work" element={<WorkPage />} />
            <Route path="/designs" element={<DesignsPage />} />
            <Route path="/designs/:id" element={<DesignWorkspace />} />
            <Route path="/motion" element={<MotionPage />} />
            <Route path="/motion/:id" element={<MotionWorkspace />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/guide" element={<GuidePage />} />
            {DesignSystemPage && (
              <Route
                path="/design-system"
                element={
                  <Suspense fallback={null}>
                    <DesignSystemPage />
                  </Suspense>
                }
              />
            )}
          </Route>
        </Routes>
      </BootGate>
    </ContextMenuProvider>
  );
}
