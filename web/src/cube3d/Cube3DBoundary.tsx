import { Component, type ReactNode } from 'react'

interface Cube3DBoundaryProps {
  children: ReactNode
  fallback: ReactNode
}

interface Cube3DBoundaryState {
  failed: boolean
}

/** Catches the lazy 3D chunk failing to load, or the canvas throwing while it renders. */
export class Cube3DBoundary extends Component<Cube3DBoundaryProps, Cube3DBoundaryState> {
  state: Cube3DBoundaryState = { failed: false }

  static getDerivedStateFromError(): Cube3DBoundaryState {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * What the board shows when the 3D view cannot run. The view is client-only, so
 * switching to flat mid-match is safe and loses nothing -- which is exactly what
 * the copy has to tell a player who is mid-turn.
 */
export function Cube3DFallback({ onUseFlat }: { onUseFlat: () => void }) {
  return (
    <div className="cube3d-fallback" role="alert">
      <p>This device can&apos;t draw the 3D cube. The flat view plays the same match.</p>
      <button type="button" onClick={onUseFlat}>
        USE FLAT VIEW
      </button>
    </div>
  )
}
