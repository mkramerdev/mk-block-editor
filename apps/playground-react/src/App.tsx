import { Navigate, Route, Routes } from "react-router";
import MkBlockEditorLayout from "./routes/layout";
import MkBlockEditorPage from "./routes/page";

function Home() {
  return (
    <main className="playground-home">
      <p className="eyebrow">Vite + React</p>
      <h1>React playground</h1>
      <p>
        Get started by editing <code>apps/playground-react/src/App.tsx</code>.
      </p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/first-draft"
        element={
          <MkBlockEditorLayout>
            <MkBlockEditorPage />
          </MkBlockEditorLayout>
        }
      />
      <Route
        path="/mk-block-editor"
        element={<Navigate to="/first-draft" replace />}
      />
      <Route
        path="/full-editor"
        element={<Navigate to="/first-draft" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
