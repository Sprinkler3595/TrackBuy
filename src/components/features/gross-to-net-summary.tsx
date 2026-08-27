import { AlertTriangle, ScrollText } from "lucide-react"
import { cn, formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// Le récapitulatif « du brut au net », partagé par l'assistant de création et
/// par la fiche d'un revenu existant.
///
/// Une règle traverse tout ce fichier : une retenue à `null` n'est pas une
/// retenue à zéro. `null` veut dire que le taux contractuel est inconnu, donc
/// que RIEN n'a été retenu et que le net affiché est trop élevé. Le dire est
/// tout l'intérêt du panneau — un net trop beau, présenté comme une certitude,
/// serait pire que pas de calcul du tout.

/// Libellés des retenues, dans l'ordre d'un décompte suisse. Repris de
/// `payslip-form-state.ts` pour qu'un même poste ne porte pas deux noms selon
/// l'écran.
const LINES = [
  { key: "avs_ai_apg", label: "AVS / AI / APG", rate: (p: api.PayrollParams) => p.avs_ai_apg_employee_pct },
  { key: "ac", label: "Assurance-chômage", rate: (p: api.PayrollParams) => p.ac_employee_pct },
  { key: "ac_solidarity", label: "Pour-cent de solidarité AC", rate: (p: api.PayrollParams) => p.ac_solidarity_employee_pct },
  { key: "lpp_employee", label: "2ᵉ pilier (LPP)", rate: () => null },
  { key: "laa_nonoccupational", label: "LAA — accidents non prof.", rate: () => null },
  { key: "ijm", label: "Indemnités journalières maladie", rate: () => null },
  { key: "tax_at_source", label: "Impôt à la source", rate: () => null },
] as const

type LineKey = (typeof LINES)[number]["key"]

/// Pourquoi un poste n'a pas pu être chiffré. Le message doit dire quoi faire,
/// pas seulement constater le manque.
const MISSING_HINT: Record<string, string> = {
  lpp: "part employé du 2ᵉ pilier inconnue",
  laa_nonoccupational: "taux LAA accidents non professionnels inconnu",
  ijm: "taux d'indemnités journalières inconnu",
  tax_at_source: "aucun barème cantonal importé ni taux effectif saisi",
}

const UNCOMPUTABLE_KEY: Record<string, LineKey> = {
  lpp: "lpp_employee",
  laa_nonoccupational: "laa_nonoccupational",
  ijm: "ijm",
  tax_at_source: "tax_at_source",
}

const TAX_SOURCE_LABEL: Record<api.TaxSource, string | null> = {
  tariff: "barème cantonal importé",
  manual_rate: "taux effectif saisi",
  not_subject: null,
  unavailable: null,
}

function Row({
  label,
  hint,
  amount,
  currency,
  missing,
}: {
  label: string
  hint?: string | null
  amount: number | null
  currency: string
  missing: boolean
}) {
  return (
    <li
      className={cn(
        "flex items-baseline justify-between gap-3 py-1.5",
        missing && "text-amber-700 dark:text-amber-500",
      )}
    >
      <span className="min-w-0 text-sm">
        {label}
        {hint && <span className="ml-1.5 text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className="shrink-0 text-sm tabular-nums">
        {missing || amount == null ? "—" : `− ${formatPrice(amount, currency)}`}
      </span>
    </li>
  )
}

export function GrossToNetSummary({
  result,
  loading,
  error,
  currency = "CHF",
  className,
}: {
  result: api.NetFromGrossResponse | null
  loading: boolean
  error: string | null
  currency?: string
  className?: string
}) {
  if (error) {
    return (
      <div className={cn("rounded-lg border border-destructive/40 bg-destructive/5 p-3", className)}>
        <p className="text-sm font-medium">Calcul impossible</p>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
      </div>
    )
  }

  if (!result) {
    return (
      <div className={cn("rounded-lg border border-dashed p-4 text-center", className)}>
        <p className="text-sm text-muted-foreground">
          {loading ? "Calcul en cours…" : "Saisissez un salaire brut pour voir les retenues."}
        </p>
      </div>
    )
  }

  const { projection, params, tax_source } = result
  const period = projection.periods[0]
  if (!period) return null

  const missingKeys = new Set(projection.uncomputable.map((u) => UNCOMPUTABLE_KEY[u]).filter(Boolean))
  const incomplete = projection.uncomputable.length > 0

  return (
    <div className={cn("space-y-3 rounded-lg border bg-muted/20 p-4", loading && "opacity-60", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">Salaire brut</span>
        <span className="text-sm font-medium tabular-nums">{formatPrice(period.gross, currency)}</span>
      </div>

      <ul className="divide-y border-y">
        {LINES.map((line) => {
          const amount = period[line.key]
          const missing = missingKeys.has(line.key)
          // Un poste absent du décompte (solidarité abolie, pas d'imposition à
          // la source) n'a pas à occuper une ligne.
          if (!missing && (amount == null || amount === 0)) return null
          const rate = line.rate(params)
          const hint =
            missing
              ? `— ${MISSING_HINT[projection.uncomputable.find((u) => UNCOMPUTABLE_KEY[u] === line.key) ?? ""] ?? "taux inconnu"}`
              : line.key === "tax_at_source"
                ? TAX_SOURCE_LABEL[tax_source]
                : rate != null
                  ? `${rate} %`
                  : null
          return (
            <Row
              key={line.key}
              label={line.label}
              hint={hint}
              amount={amount}
              currency={currency}
              missing={missing}
            />
          )
        })}
      </ul>

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">
          {incomplete ? "Net versé au maximum" : "Net versé"}
        </span>
        <span className="text-lg font-semibold tabular-nums">
          {formatPrice(period.net, currency)}
        </span>
      </div>

      {incomplete && (
        <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
          <span>
            {projection.uncomputable.length === 1 ? "Une retenue n'a pas pu être calculée" : "Certaines retenues n'ont pas pu être calculées"}{" "}
            : le net réel sera plus bas. Complétez les taux de votre employeur pour
            obtenir le montant exact.
          </span>
        </p>
      )}

      {projection.varies_across_year && (
        <p className="text-xs text-muted-foreground">
          Le plafond annuel de l'assurance-chômage est franchi en cours d'année : les
          retenues baissent ensuite. Sur l'année, {formatPrice(projection.annual_net, currency)}{" "}
          net pour {formatPrice(projection.annual_gross, currency)} brut.
        </p>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
        <ScrollText className="h-3 w-3 shrink-0" />
        {params.estimated
          ? `Barèmes ${params.effective_year} appliqués à ${params.year} (estimation)`
          : `${params.source}`}
        {result.overridden_fields.length > 0 && " · valeurs modifiées par vous"}
      </p>
    </div>
  )
}
