import { Upload, X } from "lucide-react"

/**
 * File slot UI used wherever the user attaches a single file (photo, invoice,
 * purchase order, ticket PDF, ...). Picks via the Tauri dialog plugin so the
 * returned path is a real absolute path the backend can re-validate.
 *
 * Extracted from items.tsx so it can be reused by the scan-review wizard and
 * any other page that needs the same affordance.
 */

export type PickedFileValue = { path: string; name: string } | null

interface DocSlotProps {
  label: string
  icon: React.ReactNode
  value: PickedFileValue
  onChange: (next: PickedFileValue) => void
  dialogTitle: string
  /** When true, restrict the file picker to image extensions. */
  imageOnly?: boolean
}

export function DocSlot({ label, icon, value, onChange, dialogTitle, imageOnly }: DocSlotProps) {
  const pick = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const filters = imageOnly
        ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic"] }]
        : [{ name: "Documents", extensions: ["pdf", "png", "jpg", "jpeg", "webp"] }]
      const selected = await open({ multiple: false, title: dialogTitle, filters })
      if (typeof selected === "string") {
        const name = selected.split("/").pop() || selected.split("\\").pop() || "fichier"
        onChange({ path: selected, name })
      }
    } catch (err) {
      console.error(err)
    }
  }
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </p>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-card p-2 text-sm">
          <span className="truncate">{value.name}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-muted-foreground hover:text-destructive shrink-0"
            title="Retirer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={pick}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-muted-foreground/30 px-3 py-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
        >
          <Upload className="h-3.5 w-3.5" />
          Choisir un fichier
        </button>
      )}
    </div>
  )
}
