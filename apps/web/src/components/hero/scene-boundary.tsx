"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
  label?: string;
}

interface State {
  failed: boolean;
}

/**
 * Contains failures from the WebGL scene.
 *
 * A browser without a usable GPU, a blocked canvas, or a driver that throws on
 * context creation must degrade to the static artwork — it must never take the
 * whole landing page down with it. Class components are still the only way to
 * implement `componentDidCatch`.
 */
export class SceneBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Logged rather than swallowed, so a real defect is still visible.
    console.warn(`${this.props.label || "3D scene"} fell back to static artwork:`, error.message);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
