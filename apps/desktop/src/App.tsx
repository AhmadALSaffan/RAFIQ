import { Navigate, Route, Routes } from "react-router-dom";
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
import { TasksPage } from "./features/tasks/TasksPage";
import { TaskDetailPage } from "./features/tasks/TaskDetailPage";
import { SettingsPage } from "./routes/SettingsPage";
import { AboutPage } from "./routes/AboutPage";

export function App() {
  return (
    <ContextMenuProvider>
      <TopProgress />
      <BootGate>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Navigate to="/chat" replace />} />
            {/* One optional-param route so /chat → /chat/:id never remounts the page mid-stream. */}
            <Route path="/chat/:id?" element={<ChatPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/work" element={<WorkPage />} />
            <Route path="/designs" element={<DesignsPage />} />
            <Route path="/designs/:id" element={<DesignWorkspace />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/about" element={<AboutPage />} />
          </Route>
        </Routes>
      </BootGate>
    </ContextMenuProvider>
  );
}
