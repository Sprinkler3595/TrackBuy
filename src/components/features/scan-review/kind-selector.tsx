import { Package, KeyRound, TicketPercent, Ticket } from "lucide-react"
import type { ItemKind } from "@/lib/tauri"

/**
 * Pill selector to pick the `item_kind` of a line in the scan-review wizard.
 * The four kinds map 1:1 to the DB enum (physical / license / voucher / ticket).
 *
 * Used inside <ItemStep />. Visually compact — designed to sit at the top of
 * the per-item form so the rest of the fields can react to the chosen kind.
 */

const KINDS: Array<{ value: ItemKind; label: string; icon: typeof Package; tone: string }> = [
  { value: "physical", label: "Article",  icon: Package,        tone: "bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30" },
  { value: "license",  label: "Licence",  icon: KeyRound,       tone: "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30" },
  { value: "voucher",  label: "Bon",      icon: TicketPercent,  tone: "bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30" },
  { value: "ticket",   label: "Billet",   icon: Ticket,         tone: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30" },
]

interface KindSelectorProps {
  value: ItemKind
  onChange: (next: ItemKind) => void
}

export function KindSelector({ value, onChange }: KindSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Type
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {KINDS.map(({ value: k, label, icon: Icon, tone }) => {
          const active = value === k
          return (
            <button
              key={k}
              type="button"
              onClick={() => onChange(k)}
              className={`flex flex-col items-center gap-1 rounded-md border p-3 text-sm transition-colors ${
                active
                  ? `${tone} border-current font-semibold`
                  : "border-input bg-background hover:bg-accent text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
