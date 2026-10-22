import { Component, type ErrorInfo, type ReactNode } from 'react'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  error: Error | null
}

/**
 * Top-level safety net. Without this, an uncaught error anywhere in the tree
 * unmounts the whole app and leaves a blank white page with nothing in the
 * DOM and no visible indication of what happened — this renders a message
 * (and logs the real error to the console) instead.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-page-bg px-4 text-text">
          <div className="max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
            <h1 className="text-xl font-semibold text-brand">Something went wrong</h1>
            <p className="mt-2 text-sm text-text-muted">
              This page hit an unexpected error. Reloading usually fixes it; if it keeps happening, please let us know.
            </p>
            <p className="mt-3 break-words rounded-md bg-surface-muted px-3 py-2 text-left text-xs text-text-muted">
              {this.state.error.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-md bg-button px-4 py-2 text-sm font-medium text-white hover:bg-button-hover"
            >
              Reload the page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
