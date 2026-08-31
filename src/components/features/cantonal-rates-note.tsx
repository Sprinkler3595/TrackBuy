import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { AlertTriangle, Check } from "lucide-react"
import * as api from "@/lib/tauri"

/// Ce que le canton choisi change, dit à l'endroit où on le choisit.
///
/// Le canton du siège pilote deux retenues qui figurent bel et bien sur la
/// fiche du salarié : la cotisation SALARIÉE aux allocations familiales
/// (Vaud, Valais) et l'assurance maternité cantonale (Genève). Elles sont
/// enregistrées une fois par année dans Paramètres → Barèmes, puis appliquées
/// d'elles-mêmes à chaque bulletin — c'est tout l'intérêt d'avoir choisi un
/// canton.
///
/// Sans ce panneau, ce mécanisme est invisible. Choisir « GE » ne produit
/// aucun signe à l'écran, et si les taux genevois de l'année manquent, la
/// retenue vaut zéro EN SILENCE. Un net trop élevé présenté comme une
/// certitude est le pire des résultats : le dire ici est la moitié du travail.
///
/// Le composant n'écrit rien. Il lit les taux de l'année et raconte ce qui
/// s'appliquera.

/// Les cantons qui prélèvent quelque chose au salarié. Ailleurs, seul
/// l'employeur cotise : l'absence de taux y est la normale, pas un oubli, et
/// il ne faut donc pas alarmer.
const LEVYING = new Set(["VD", "VS", "GE"])

const pct = (v: number) => `${String(v).replace(".", ",")} %`

export function CantonalRatesNote({
  canton,
  year,
  className,
}: {
  canton: string | null | undefined
  year: number
  className?: string
}) {
  const [rates, setRates] = useState<api.CantonalRates | null>(null)
  const [loaded, setLoaded] = useState(false)

  const code = (canton ?? "").trim().toUpperCase()

  useEffect(() => {
    if (code.length !== 2) {
      setRates(null)
      setLoaded(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const all = await api.getCantonalRates(year)
        if (cancelled) return
        setRates(all.find((r) => r.canton === code) ?? null)
        setLoaded(true)
      } catch {
        // Coffre verrouillé ou lecture impossible : mieux vaut ne rien dire
        // que d'annoncer à tort « aucun taux enregistré ».
        if (!cancelled) setLoaded(false)
      }
    })()
    return () => { cancelled = true }
  }, [code, year])

  if (code.length !== 2 || !loaded) return null

  const lines: string[] = []
  if (rates?.family_allowance_employee_pct != null) {
    lines.push(`allocations familiales ${pct(rates.family_allowance_employee_pct)}`)
  }
  if (rates?.maternity_employee_pct != null) {
    lines.push(`assurance maternité ${pct(rates.maternity_employee_pct)}`)
  }

  if (lines.length > 0) {
    return (
      <p className={className ?? "flex gap-2 text-xs text-muted-foreground"}>
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span>
          {code} {year} — {lines.join(", ")}. Retenu automatiquement sur chaque
          bulletin : rien à saisir sur le contrat.
        </span>
      </p>
    )
  }

  if (LEVYING.has(code)) {
    return (
      <p className={className ?? "flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs"}>
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span>
          Aucun taux enregistré pour {code} en {year}, alors que ce canton
          prélève une retenue au salarié. Elle vaudra <strong>zéro</strong> et
          le net calculé sera trop élevé.{" "}
          <Link to="/settings/baremes" className="underline underline-offset-2">
            Renseignez-la une fois dans Paramètres → Barèmes
          </Link>{" "}
          — elle servira ensuite pour tous vos bulletins de l'année.
        </span>
      </p>
    )
  }

  return (
    <p className={className ?? "text-xs text-muted-foreground"}>
      {code} ne prélève aucune retenue cantonale au salarié — seul l'employeur
      cotise. Rien à renseigner.
    </p>
  )
}
