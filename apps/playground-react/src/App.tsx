import { Button } from "@repo/ui/button";
import { Route, Routes } from "react-router";
import FullEditor from "./routes/full-editor";

function Home() {
  return (
    <main>
      <p className="eyebrow">Vite + React</p>
      <h1>React playground</h1>
      <p>
        Get started by editing <code>apps/playground-react/src/App.tsx</code>.
      </p>
      <Button appName="playground-react" className="action">
        Open alert
      </Button>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/full-editor" element={<FullEditor />} />
    </Routes>
  );
}
