import { AlertTriangle, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ErrorPanelProps {
  error: string
  onRetry?: () => void
  retryLabel?: string
  title?: string
}

/// Inline error block for pages where the entire view depends on a backend
/// call. Replaces the old "infinite spinner" pattern that left the user
/// staring at a spinner forever when the IPC call rejected.
export function ErrorPanel({ error, onRetry, retryLabel = "Réessayer", title = "Erreur de chargement" }: ErrorPanelProps) {
  return (
    <div className="flex h-64 items-center justify-center p-4">
      <div className="w-full max-w-md space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <p className="text-sm text-muted-foreground break-words">{error}</p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCw className="mr-1 h-3.5 w-3.5" />
            {retryLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
