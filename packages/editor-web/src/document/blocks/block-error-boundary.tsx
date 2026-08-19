"use client";

import { Component, type ReactNode } from "react";
import type { BlockId } from "@repo/editor-core/kernel";

export interface BlockErrorBoundaryProps {
  blockId: BlockId;
  children: ReactNode;
}

interface BlockErrorBoundaryState {
  failed: boolean;
}

export class BlockErrorBoundary extends Component<
  BlockErrorBoundaryProps,
  BlockErrorBoundaryState
> {
  state: BlockErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): BlockErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch() {
    this.setState({ failed: true });
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          className="editor-web-error"
          role="alert"
          data-editor-error-block={this.props.blockId}
        >
          Block unavailable
        </div>
      );
    }
    return this.props.children;
  }
}
