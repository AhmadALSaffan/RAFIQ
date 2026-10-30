import { ForcedUpdate } from "./features/updates/ForcedUpdate";
import { lazy, Suspense, type ReactNode } from "react";
import { Toasts } from "./lib/toast";
import { Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { ContextMenuProvider } from "./components/ContextMenu";
import { BootGate } from "./components/BootGate";
import { TopProgress } from "./components/TopProgress";
import { FirstRun } from "./components/FirstRun";
import { WhatsNew } from "./features/updates/WhatsNew";
import { ChatPage } from "./features/chat";
import { ModelsPage } from "./routes/ModelsPage";
import { IntegrationsPage } from "./routes/IntegrationsPage";
import { WorkPage } from "./features/work";
import { TasksPage } from "./features/tasks/TasksPage";
import { CouncilPage } from "./routes/CouncilPage";
import { TaskDetailPage } from "./features/tasks/TaskDetailPage";
import { SettingsPage } from "./routes/SettingsPage";
import { AboutPage } from "./routes/AboutPage";
import { GuidePage } from "./routes/GuidePage";
import { NotFoundPage } from "./routes/NotFoundPage";
import { FeedbackPage } from "./routes/FeedbackPage";
import { QuickAsk } from "./routes/QuickAsk";
import { HomePage } from "./routes/HomePage";
import { EngineLoading } from "./features/motion/EngineLoading";

// The studios and the notes editor load when they're first opened, not at startup: the motion
// engine (three.js, audio, video export), the design workspace and CodeMirror would otherwise
// sit in memory for someone who never goes there.
const NotesPage = lazy(() => import("./features/notes/NotesPage"));
const LiteNote = lazy(() => import("./features/notes/LiteNote"));
const DesignsPage = lazy(() => import("./routes/DesignsPage").then((m) => ({ default: m.DesignsPage })));
const DesignWorkspace = lazy(() => import("./routes/DesignWorkspace").then((m) => ({ default: m.DesignWorkspace })));
const MotionPage = lazy(() => import("./routes/MotionPage").then((m) => ({ default: m.MotionPage })));
const CreativePage = lazy(() => import("./routes/CreativePage").then((m) => ({ default: m.CreativePage })));
const MotionWorkspace = lazy(() => import("./routes/MotionWorkspace").then((m) => ({ default: m.MotionWorkspace })));

/** A page that loads on demand: nothing in its place for the moment it takes (or `wait`). */
const later = (page: ReactNode, wait: ReactNode = null) => <Suspense fallback={wait}>{page}</Suspense>;

// The design-system sheet only exists in dev builds.
const DesignSystemPage = import.meta.env.DEV ? lazy(() => import("./routes/DesignSystemPage").then((m) => ({ default: m.DesignSystemPage }))) : null;

export function App() {
  return (
    <Toasts>
    <ContextMenuProvider>
      <TopProgress />
      <BootGate>
        <Routes>
          {/* The quick-ask window (global shortcut): no sidebar, just the box. */}
          <Route path="/quick" element={<QuickAsk />} />
          {/* Rafiq Lite: one Markdown file in a window of its own (opened from Windows). */}
          <Route path="/lite" element={later(<LiteNote />)} />
          <Route element={<Shell />}>
            <Route index element={<HomePage />} />
            {/* One optional-param route so /chat → /chat/:id never remounts the page mid-stream. */}
            <Route path="/chat/:id?" element={<ChatPage />} />
            <Route path="/council" element={<CouncilPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/work" element={<WorkPage />} />
            <Route path="/create" element={later(<CreativePage />)} />
            <Route path="/notes" element={later(<NotesPage />)} />
            <Route path="/designs" element={later(<DesignsPage />)} />
            <Route path="/designs/:id" element={later(<DesignWorkspace />)} />
            <Route path="/motion" element={later(<MotionPage />)} />
            <Route path="/motion/:id" element={later(<MotionWorkspace />, <EngineLoading full />)} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/feedback" element={<FeedbackPage />} />
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
            {/* Any address that leads nowhere. */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
        {/* A new version must be installed before the app carries on. */}
        <ForcedUpdate />
        <FirstRun />
        <WhatsNew />
      </BootGate>
    </ContextMenuProvider>
    </Toasts>
  );
}
