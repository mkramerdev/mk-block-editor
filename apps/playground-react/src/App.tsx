import { Button } from "@repo/ui/button";

export default function App() {
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
