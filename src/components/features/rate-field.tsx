import { AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { RATE_GUIDES, rateWarning, type RateKind } from "@/lib/payroll-rates"

/// Un des trois taux d'entreprise, avec ce qu'il faut pour ne pas se tromper :
/// de quoi le pourcentage est un pourcentage, et une alerte quand la valeur
/// saisie ressemble à une répartition employeur/employé plutôt qu'à un taux.
///
/// L'alerte ne bloque rien. Un règlement de caisse inhabituel existe, et c'est
/// le salarié qui a sa fiche sous les yeux.

export function RateField({
  kind,
  value,
  onChange,
  label,
  footnote,
}: {
  kind: RateKind
  value: string
  onChange: (v: string) => void
  /// Remplace l'intitulé du guide, quand le contexte de l'écran le précise
  /// mieux — « taux unique de repli » là où un plan par tranches existe à côté.
  label?: string
  /// Précision propre à l'écran, ajoutée sous l'aide habituelle.
  footnote?: React.ReactNode
}) {
  const guide = RATE_GUIDES[kind]
  const warning = rateWarning(kind, value)
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">
        {label ?? guide.label}
        <span className="ml-1 font-normal text-muted-foreground">({guide.unit})</span>
      </label>
      <Input
        type="number"
        min="0"
        // Les primes AANP se cotent au millième (1.375 %) : un pas plus grossier
        // ferait rejeter un taux parfaitement légitime.
        step="0.001"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={guide.placeholder}
        className={warning ? "border-amber-500" : undefined}
      />
      {warning ? (
        <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{warning}</span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{guide.hint}</p>
      )}
      {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
    </div>
  )
}
