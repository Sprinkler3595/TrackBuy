import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Wallet } from "lucide-react"
import { Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatPrice } from "@/lib/utils"
import { MaskedAmount } from "@/components/features/amount-masked"
import * as api from "@/lib/tauri"

/// Consolidation fiscale de l'année : base imposable reconstituée depuis les
/// bulletins et certificats, et frais professionnels déductibles.
///
/// Le calcul est **du ménage**, pas d'un revenu : il additionne tous les
/// salaires. Sa place est donc sur la liste des revenus, pas sur la fiche
/// d'un employeur.
///
/// Les deux branches du calcul des frais — forfait de 3 % et frais effectifs
/// plafonnés — sont montrées ensemble : c'est au contribuable de retenir la
/// plus favorable, et il ne peut le décider qu'en les voyant côte à côte.
export function IncomeTaxSummaryPanel({
  amountsVisible,
}: {
  amountsVisible: boolean
}) {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [summary, setSummary] = useState<api.IncomeTaxSummary | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .getIncomeTaxSummary(year)
      // Le volet est un complément : son échec ne doit pas gêner la liste
      // des revenus au-dessus de laquelle il s'affiche.
      .then((s) => { if (!cancelled) setSummary(s) })
      .catch(() => { if (!cancelled) setSummary(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [year])

  if (loading || !summary) return null

  const nothingYet =
    summary.gross_total === 0 && summary.other_income_by_type.length === 0
  if (nothingYet) return null

  const pe = summary.professional_expenses
  const years = Array.from(
    new Set([...summary.params.known_years, new Date().getFullYear()]),
  ).sort((a, b) => b - a)

  const money = (v: number) => (
    <MaskedAmount amount={v} currency="CHF" visible={amountsVisible} />
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <button
            type="button"
            className="flex items-start gap-3 text-left"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? (
              <ChevronDown className="h-4 w-4 mt-1 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 mt-1 shrink-0" />
            )}
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                Synthèse fiscale {summary.year}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Reconstituée depuis vos bulletins et certificats de salaire.
              </p>
            </div>
          </button>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10))}
            aria-label="Année fiscale"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Brut total (ch. 8)</p>
            <p className="text-xl font-semibold">{money(summary.gross_total)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cotisations (ch. 9 + 10)</p>
            <p className="text-xl font-semibold">
              {money(summary.social_contributions + summary.lpp_contributions)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Salaire net (ch. 11)</p>
            <p className="text-xl font-semibold">{money(summary.net_salary)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Frais déductibles</p>
            <p className="text-xl font-semibold">{money(pe.total)}</p>
          </div>
        </div>

        {open && (
          <div className="space-y-4 border-t pt-4">
            {summary.salary_sources.length > 0 && (
              <div>
                <p className="text-xs uppercase text-muted-foreground mb-2">Salaires</p>
                <table className="w-full text-sm">
                  <tbody>
                    {summary.salary_sources.map((s) => (
                      <tr key={s.income_id} className="border-t">
                        <td className="py-2 text-xs">
                          <Link to={`/incomes/${s.income_id}`} className="hover:underline">
                            {s.employer_name ?? s.name}
                          </Link>
                          {s.has_declared_certificate ? (
                            <Badge variant="success" className="ml-2 text-[10px]">
                              certificat reçu
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              {s.receipt_count} bulletin{s.receipt_count > 1 ? "s" : ""}
                            </Badge>
                          )}
                          {!s.has_contract && (
                            <Badge variant="warning" className="ml-2 text-[10px]">
                              contrat manquant
                            </Badge>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums">
                          {money(s.net_salary)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {summary.other_income_by_type.length > 0 && (
              <div>
                <p className="text-xs uppercase text-muted-foreground mb-2">Autres revenus</p>
                <table className="w-full text-sm">
                  <tbody>
                    {summary.other_income_by_type.map((o) => (
                      <tr key={o.income_type} className="border-t">
                        <td className="py-2 text-xs">
                          {o.income_type}
                          <span className="ml-2 text-muted-foreground">
                            ({o.count} versement{o.count > 1 ? "s" : ""})
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums">
                          {money(o.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <p className="text-xs uppercase text-muted-foreground mb-2">
                Frais professionnels (impôt fédéral direct)
              </p>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-t">
                    <td className="py-2 text-xs">
                      Autres frais — forfait {summary.params.pro_lump_sum_pct} % du salaire net
                      <span className="ml-1 text-muted-foreground">
                        (min. {formatPrice(summary.params.pro_lump_sum_min, "CHF")}, max.{" "}
                        {formatPrice(summary.params.pro_lump_sum_max, "CHF")})
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums">
                      {money(pe.lump_sum_other_expenses)}
                    </td>
                  </tr>
                  <tr className="border-t">
                    <td className="py-2 text-xs">
                      Déplacements domicile-travail
                      {pe.commute_claimed > pe.commute_capped && (
                        <span className="ml-1 text-amber-600 dark:text-amber-400">
                          (ramenés de {formatPrice(pe.commute_claimed, "CHF")} au plafond)
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums">
                      {money(pe.commute_capped)}
                    </td>
                  </tr>
                  <tr className="border-t">
                    <td className="py-2 text-xs">
                      Repas hors du domicile
                      {pe.meals_reduced_by_employer && (
                        <span className="ml-1 text-muted-foreground">
                          (réduit : cantine subventionnée)
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums">
                      {money(pe.meals)}
                    </td>
                  </tr>
                  <tr className="border-t bg-muted/40 font-medium">
                    <td className="py-2 text-xs">Total</td>
                    <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums">
                      {money(pe.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
              {pe.notes.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {pe.notes.map((n, idx) => (
                    <li key={idx} className="text-xs text-muted-foreground">• {n}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
              <p>
                <strong>Plafond 3ᵉ pilier {summary.params.effective_year} :</strong>{" "}
                {formatPrice(summary.pillar3a_cap, "CHF")}{" "}
                {summary.affiliated_to_lpp
                  ? "(affilié à une caisse de pension)"
                  : "(aucune cotisation LPP constatée sur l'année)"}
              </p>
              {summary.params.estimated && (
                <p className="text-amber-600 dark:text-amber-400">
                  Aucun barème publié pour {summary.params.year} : les valeurs{" "}
                  {summary.params.effective_year} sont appliquées.
                </p>
              )}
              <p className="text-muted-foreground">
                Barèmes {summary.params.effective_year} — {summary.params.source}. Ces
                montants sont indicatifs et ne remplacent pas l'avis d'une fiduciaire.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
