import React from "react"
import { AlertTriangle } from "lucide-react"

interface State {
  error: Error | null
  info: React.ErrorInfo | null
}

/// Catches uncaught render errors and shows them inline so the user gets
/// a readable message instead of a silent black page. Critical in a
/// desktop app where the only diagnostic channel is the visible UI.
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ error, info })
    // eslint-disable-next-line no-console
    console.error("Uncaught render error:", error, info)
  }

  reset = () => this.setState({ error: null, info: null })

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="p-8">
        <div className="mx-auto max-w-2xl space-y-4 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Une erreur a interrompu l'affichage</h2>
          </div>
          <p className="text-sm">
            Le composant a planté pendant le rendu. Détails techniques ci-dessous —
            envoyez-les si vous reportez le bug.
          </p>
          <pre className="max-h-64 overflow-auto rounded-md bg-background p-3 font-mono text-xs">
            {this.state.error.message}
            {this.state.error.stack && "\n\n" + this.state.error.stack}
          </pre>
          {this.state.info?.componentStack && (
            <details className="text-xs">
              <summary className="cursor-pointer">Stack de composants</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-background p-3 font-mono">
                {this.state.info.componentStack}
              </pre>
            </details>
          )}
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Réessayer
            </button>
            <button
              onClick={() => {
                window.location.href = "/ce-mois"
              }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Retour à l'accueil
            </button>
          </div>
        </div>
      </div>
    )
  }
}
