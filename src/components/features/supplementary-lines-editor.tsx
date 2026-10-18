import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatPrice } from "@/lib/utils"
import { HEALTH_SUPPLEMENTARY_OPTIONS, lineDiscount, lineNet, linesTotal, type SupplementaryLine } from "@/lib/health"

/// Supplementary (LCA) covers as the policy lists them: one line per product,
/// with the insurer's own name, its monthly premium and its discount — in
/// percent or in francs. The suggestions are only a help to type; any name is
/// accepted.

export const emptyLine = (): SupplementaryLine => ({ name: "", monthly_premium: 0, discount_kind: "pct", discount_value: 0 })

export function SupplementaryLinesEditor({ lines, onChange, fr }: {
  lines: SupplementaryLine[]
  onChange: (lines: SupplementaryLine[]) => void
  fr: boolean
}) {
  const set = (i: number, patch: Partial<SupplementaryLine>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const num = (v: string) => {
    const n = parseFloat(v)
    return Number.isNaN(n) ? 0 : n
  }
  const fieldCls = "h-9 rounded-md border border-input bg-background px-2 text-sm"

  return (
    <div className="space-y-2">
      <datalist id="lca-suggestions">
        {HEALTH_SUPPLEMENTARY_OPTIONS.map((o) => <option key={o.slug} value={fr ? o.fr : o.en} />)}
      </datalist>
      <div className="hidden gap-2 text-xs text-muted-foreground sm:grid sm:grid-cols-[1fr_7rem_9rem_6rem_2.25rem]">
        <span>{fr ? "Complémentaire (nom sur la police)" : "Cover (name on the policy)"}</span>
        <span>{fr ? "Prime /mois" : "Premium /mo"}</span>
        <span>{fr ? "Rabais" : "Discount"}</span>
        <span className="text-right">{fr ? "Net /mois" : "Net /mo"}</span>
        <span />
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-md bg-muted/30 p-2 sm:grid-cols-[1fr_7rem_9rem_6rem_2.25rem] sm:bg-transparent sm:p-0">
          <Input className="col-span-2 h-9 sm:col-span-1" list="lca-suggestions" value={l.name} autoFocus={i === lines.length - 1 && !l.name}
            onChange={(e) => set(i, { name: e.target.value })} placeholder={fr ? "Ex : Hospital Flex" : "e.g. Hospital Flex"} />
          <Input className="h-9" type="number" min="0" step="0.05" value={l.monthly_premium || ""}
            onChange={(e) => set(i, { monthly_premium: num(e.target.value) })} placeholder="0.00" />
          <div className="flex gap-1">
            <Input className="h-9 w-full" type="number" min="0" step="0.05" value={l.discount_value || ""}
              onChange={(e) => set(i, { discount_value: num(e.target.value) })} placeholder="0" />
            <select className={fieldCls} value={l.discount_kind} onChange={(e) => set(i, { discount_kind: e.target.value as "pct" | "chf" })}>
              <option value="pct">%</option>
              <option value="chf">CHF</option>
            </select>
          </div>
          <span className="text-right text-sm">
            {formatPrice(lineNet(l))}
            {lineDiscount(l) > 0 && <span className="block text-xs text-muted-foreground">− {formatPrice(lineDiscount(l))}</span>}
          </span>
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(lines.filter((_, j) => j !== i))}
            aria-label={fr ? "Retirer" : "Remove"}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...lines, emptyLine()])}>
          <Plus className="mr-1 h-4 w-4" />{fr ? "Ajouter une complémentaire" : "Add a cover"}
        </Button>
        {lines.length > 0 && (
          <span className="text-sm">{fr ? "Total net" : "Net total"} : <span className="font-semibold">{formatPrice(linesTotal(lines))}</span> / {fr ? "mois" : "month"}</span>
        )}
      </div>
    </div>
  )
}
