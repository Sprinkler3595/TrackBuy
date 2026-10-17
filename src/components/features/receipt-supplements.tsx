import { AlertTriangle, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { unitLabel } from "@/lib/supplements"
import { formatPrice } from "@/lib/utils"
import type * as api from "@/lib/tauri"

/// Ce qui a réellement été accompli sur un mois : une semaine d'astreinte,
/// deux dimanches.
///
/// La saisie est en **quantités**, jamais en francs : personne ne connaît par
/// cœur le montant d'un dimanche de 2019, alors que tout le monde sait combien
/// il en a fait. Le barème de la version de contrat en vigueur ce mois-là fait
/// le reste.
///
/// Le total alimente « Autre élément de salaire » (`other_gross_amount`),
/// colonne que le moteur soumet déjà à l'AVS et range en rubrique 1 du
/// certificat de salaire — prestations périodiques, ce qu'une astreinte
/// mensuelle est bien.
///
/// Deux usages, un seul écran :
///
///   - **saisir** un bulletin du mois : on tape les quantités, le montant suit ;
///   - **contrôler** une vieille fiche : le montant versé est déjà là, et
///     l'écart avec le barème s'affiche au lieu d'être écrasé en silence.

export function ReceiptSupplements({
  rates,
  quantities,
  onQuantity,
  paidAmount,
  onUseComputed,
  currency,
  contractLabel,
}: {
  rates: api.SupplementRate[]
  quantities: Record<string, string>
  onQuantity: (code: string, value: string) => void
  /// Le montant effectivement porté sur « Autre élément de salaire ».
  /// `null` = rien de saisi, ce qui n'est pas la même chose que zéro.
  paidAmount: number | null
  onUseComputed: (amount: number) => void
  currency: string
  contractLabel?: string | null
}) {
  const lines = rates.map((r) => {
    const q = parseFloat(quantities[r.code] ?? "")
    const quantity = Number.isNaN(q) || q < 0 ? 0 : q
    return { rate: r, quantity, amount: quantity * r.amount }
  })
  const computed = lines.reduce((s, l) => s + l.amount, 0)
  const active = lines.filter((l) => l.quantity > 0)

  // Un écart inférieur à cinq centimes est un arrondi de barème, pas une erreur
  // de l'employeur : le signaler serait du bruit à chaque bulletin.
  const gap = paidAmount == null ? null : paidAmount - computed
  const mismatch = gap != null && Math.abs(gap) >= 0.05 && (computed > 0 || paidAmount !== 0)

  return (
    <div className="space-y-3 sm:col-span-2 lg:col-span-3">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lines.map(({ rate, amount, quantity }) => (
          <div key={rate.id} className="space-y-1.5">
            <label className="text-sm font-medium">{rate.label}</label>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={quantities[rate.code] ?? ""}
              onChange={(e) => onQuantity(rate.code, e.target.value)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              {formatPrice(rate.amount, currency)} {unitLabel(rate.unit)}
              {quantity > 0 && (
                <span className="ml-1 font-medium text-foreground tabular-nums">
                  = {formatPrice(amount, currency)}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>

      {computed > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm">
              {active
                .map((l) => `${l.quantity} × ${l.rate.label.toLowerCase()}`)
                .join(", ")}
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {formatPrice(computed, currency)}
            </span>
          </div>

          {mismatch ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
              <span className="text-amber-700 dark:text-amber-500">
                Votre bulletin porte {formatPrice(paidAmount as number, currency)} :{" "}
                {(gap as number) > 0 ? "+" : "−"}
                {formatPrice(Math.abs(gap as number), currency)} par rapport au barème.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onUseComputed(computed)}
              >
                Reprendre {formatPrice(computed, currency)}
              </Button>
            </div>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 border-t pt-2 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
              Reporté sur « Autre élément de salaire », soumis à l'AVS.
            </p>
          )}
        </div>
      )}

      {contractLabel && (
        <p className="text-xs text-muted-foreground">
          Barème de « {contractLabel} », la version du contrat en vigueur à cette date.
        </p>
      )}
    </div>
  )
}
