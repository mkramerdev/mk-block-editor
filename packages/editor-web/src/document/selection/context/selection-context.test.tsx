import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  createIdleSelectionSnapshot,
  type EditorSelectionSnapshot,
  type EditorSelectionSnapshotEndpoint,
} from "@repo/editor-react/selection";
import {
  SelectionProvider,
  useEditorSelectionEndpoint,
  useEditorSelectionSnapshot,
} from "./selection-context.tsx";

describe("SelectionProvider", () => {
  it("provides only the document selection endpoint", () => {
    const endpoint = new TestSelectionEndpoint();
    render(
      <SelectionProvider endpoint={endpoint}>
        <EndpointProbe expected={endpoint} />
      </SelectionProvider>,
    );
    expect(screen.getByTestId("endpoint").textContent).toBe("provided");
  });

  it("subscribes to the endpoint and cleans up", () => {
    const endpoint = new TestSelectionEndpoint();
    const view = render(
      <SelectionProvider endpoint={endpoint}>
        <SnapshotProbe />
      </SelectionProvider>,
    );
    expect(endpoint.listenerCount).toBe(1);
    expect(screen.getByTestId("revision").textContent).toBe("0");
    act(() => {
      endpoint.publish({
        ...createIdleSelectionSnapshot(),
        selectionRevision: 2,
      });
    });
    expect(screen.getByTestId("revision").textContent).toBe("2");
    view.unmount();
    expect(endpoint.listenerCount).toBe(0);
  });

  it("uses the stable idle snapshot outside a provider", () => {
    render(<SnapshotProbe />);
    expect(screen.getByTestId("revision").textContent).toBe("0");
  });
});

function EndpointProbe({
  expected,
}: {
  readonly expected: EditorSelectionSnapshotEndpoint;
}) {
  const endpoint = useEditorSelectionEndpoint();
  return (
    <span data-testid="endpoint">
      {endpoint === expected ? "provided" : "missing"}
    </span>
  );
}

function SnapshotProbe() {
  const snapshot = useEditorSelectionSnapshot();
  return <span data-testid="revision">{snapshot.selectionRevision}</span>;
}

class TestSelectionEndpoint implements EditorSelectionSnapshotEndpoint {
  private snapshot: EditorSelectionSnapshot = createIdleSelectionSnapshot();
  private readonly listeners = new Set<() => void>();

  get listenerCount(): number {
    return this.listeners.size;
  }

  getSnapshot(): EditorSelectionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeBlock(_blockId: BlockId, listener: () => void): () => void {
    return this.subscribe(listener);
  }

  publish(snapshot: EditorSelectionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener();
  }
}
