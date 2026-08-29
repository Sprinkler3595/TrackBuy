import { useEffect, useState } from "react"
import { CalendarClock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// « Combien d'astreintes en 2019, et combien m'ont-elles rapporté ? »
///
/// La question ne trouvait de réponse nulle part : le total était noyé dans
/// « Autre élément de salaire », mois par mois. Le décompte est ici, à côté des
/// bulletins de l'année dont il est la somme.
///
/// Le panneau se tait quand il n'y a rien à dire — quelqu'un dont le salaire
/// ne comporte que le fixe ne verra jamais ce bloc.

export function SupplementYearSummary({
  incomeId,
  year,
  currency,
  reloadKey = 0,
}: {
  incomeId: string
  year: number
  currency: string
  /// Change à chaque écriture de bulletin : le décompte doit suivre, sinon il
  /// affiche encore l'astreinte qu'on vient de retirer.
  reloadKey?: number
}) {
  const [rows, setRows] = useState<api.SupplementYearTotal[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await api.getSupplementTotals(incomeId, year)
        if (!cancelled) setRows(list)
      } catch {
        if (!cancelled) setRows([])
      }
    })()
    return () => { cancelled = true }
  }, [incomeId, year, reloadKey])

  if (rows.length === 0) return null

  const total = rows.reduce((s, r) => s + r.amount, 0)

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Suppléments {year}
        </span>
        {rows.map((r) => (
          <span key={r.code} className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{r.quantity}</span>
            {" × "}
            {r.label.toLowerCase()}
            <span className="ml-1 tabular-nums">({formatPrice(r.amount, currency)})</span>
          </span>
        ))}
        <span className="ml-auto text-sm font-semibold tabular-nums">
          {formatPrice(total, currency)}
        </span>
      </CardContent>
    </Card>
  )
}
