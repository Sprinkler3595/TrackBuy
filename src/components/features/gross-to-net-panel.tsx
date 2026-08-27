import { useEffect, useState } from "react"
import { ArrowRight, Calculator } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import { GrossToNetSummary } from "@/components/features/gross-to-net-summary"
import { useNetFromGross } from "@/hooks/use-net-from-gross"
import { formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// « Du brut au net » sur la fiche d'un revenu existant.
///
/// C'est le chemin des augmentations et du 1er janvier : on change le brut ou
/// les taux, on voit le net que cela donne, et on décide de mettre à jour le
/// montant enregistré. Le bouton est indispensable : `current_amount` est ce
/// que « Ce mois » et les prévisions additionnent, et l'écraser en silence
/// ferait bouger des chiffres que l'utilisateur n'a pas demandé à changer.

const periodsOf = (contract: api.EmploymentContract | null): number =>
  contract?.salary_periods_per_year && contract.salary_periods_per_year > 0
    ? contract.salary_periods_per_year
    : 12

export function GrossToNetPanel({
  income,
  contract,
  onAmountUpdated,
}: {
  income: api.Income
  contract: api.EmploymentContract | null
  onAmountUpdated: () => void
}) {
  const { toast } = useToast()
  const [gross, setGross] = useState("")
  const [saving, setSaving] = useState(false)

  const periods = periodsOf(contract)

  // Le brut convenu au contrat est le point de départ naturel. Il se
  // réinitialise quand le contrat change, mais pas pendant que l'utilisateur
  // tape : d'où la dépendance sur le seul montant annuel.
  useEffect(() => {
    if (contract?.annual_gross_agreed) {
      setGross(String(Math.round((contract.annual_gross_agreed / periods) * 100) / 100))
    }
  }, [contract?.annual_gross_agreed, periods])

  const grossValue = parseFloat(gross)
  const grossValid = !Number.isNaN(grossValue) && grossValue > 0

  /// L'année du prochain versement, pas celle d'aujourd'hui : les barèmes
  /// changent au 1er janvier, et c'est bien la paie à venir qu'on projette.
  const year = parseInt(
    (income.next_expected_date ?? new Date().toISOString()).slice(0, 4),
    10,
  ) || new Date().getFullYear()

  const { result, loading, error } = useNetFromGross(
    grossValid
      ? {
          year,
          gross_per_period: grossValue,
          income_id: income.id,
          terms: {
            birth_date: contract?.birth_date ?? null,
            activity_rate_pct: contract?.activity_rate_pct ?? null,
            weekly_hours: contract?.weekly_hours ?? null,
            salary_periods_per_year: periods,
            thirteenth_salary: contract?.thirteenth_salary ?? false,
            lpp_employee_share_pct: contract?.lpp_employee_share_pct ?? null,
            laa_nonoccupational_pct: contract?.laa_nonoccupational_pct ?? null,
            ijm_employee_pct: contract?.ijm_employee_pct ?? null,
            tax_at_source: contract?.tax_at_source ?? false,
          },
          work_canton: contract?.work_canton ?? null,
          tax_at_source_scale: contract?.tax_at_source_scale ?? null,
          tax_at_source_rate_pct: contract?.tax_at_source_rate_pct ?? null,
        }
      : null,
  )

  // Pendant un recalcul, `result` porte encore le net du brut précédent :
  // le proposer à l'enregistrement sauverait un montant qui ne correspond
  // plus à ce qui est affiché.
  const computed = loading ? null : (result?.net_per_period ?? null)
  const stored = income.current_amount
  // Un écart d'arrondi n'est pas un changement : ne proposer la mise à jour
  // que lorsqu'elle change réellement quelque chose.
  const differs = computed != null && (stored == null || Math.abs(computed - stored) >= 0.01)

  const apply = async () => {
    if (computed == null) return
    setSaving(true)
    try {
      await api.updateIncome({ ...income, current_amount: computed })
      toast("Montant du revenu mis à jour.", "success")
      onAmountUpdated()
    } catch (e) {
      toast(`Erreur : ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="h-4 w-4" />
          Du brut au net
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Les retenues sont calculées avec les barèmes de {year} et les taux enregistrés
          ci-dessous. Modifiez le brut après une augmentation, ou les taux au 1ᵉʳ janvier, pour
          voir le net qui en découle.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Salaire brut ({periods === 13 ? "par paie, 13 paies" : `par paie, ${periods} paies`})
            </label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={gross}
              onChange={(e) => setGross(e.target.value)}
              placeholder="0.00"
            />
            {!contract && (
              <p className="text-xs text-muted-foreground">
                Aucun contrat enregistré : seules l'AVS et l'assurance-chômage peuvent être
                calculées. Complétez le contrat ci-dessous pour le 2ᵉ pilier, la LAA et les
                indemnités journalières.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Montant enregistré du revenu</label>
            <div className="flex h-10 items-center gap-2 text-sm">
              <span className="tabular-nums">
                {stored == null ? "—" : formatPrice(stored, income.currency)}
              </span>
              {differs && (
                <>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium tabular-nums">
                    {formatPrice(computed as number, income.currency)}
                  </span>
                </>
              )}
            </div>
            {differs && (
              <Button size="sm" variant="outline" onClick={apply} disabled={saving}>
                Mettre à jour le montant du revenu
              </Button>
            )}
          </div>
        </div>

        <GrossToNetSummary
          result={result}
          loading={loading}
          error={error}
          currency={income.currency}
        />
      </CardContent>
    </Card>
  )
}
