import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ChevronDown, Download, Info, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ErrorPanel } from "@/components/ui/error-panel"
import { useToast } from "@/components/ui/toast"
import { MaskedAmount, useAmountsVisible } from "@/components/features/amount-masked"
import { CONTRIBUTION_SERIES, groupByYear, historyToCsv, toYearRows } from "@/lib/career"
import { downloadExport } from "@/lib/export"
import { formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// Historique de carrière : ce qui a été prélevé sur le salaire, année par
/// année et employeur par employeur, employeurs quittés compris.
///
/// Deux niveaux de lecture, et c'est délibéré. Le graphique empile la
/// ventilation GROSSIÈRE — net, cotisations sociales, LPP, impôt, autres —
/// parce qu'elle est la seule que les deux sources partagent : douze bulletins
/// donnent le détail cotisation par cotisation, un certificat de salaire ne
/// publie qu'un total. Le tableau descend au détail et affiche « — » là où il
/// n'existe pas, plutôt qu'un zéro qui se sommerait en silence.

const CHART_HEIGHT = 320

function StatTile({
  label,
  value,
  hint,
  partial,
  visible,
}: {
  label: string
  value: number
  hint?: string
  partial?: boolean
  visible: boolean
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        <MaskedAmount amount={value} currency="CHF" visible={visible} />
        {partial && <span className="ml-1 text-base text-amber-600 dark:text-amber-500">+</span>}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function CareerPage() {
  const { toast } = useToast()
  const [amountsVisible, setAmountsVisible] = useAmountsVisible()
  const [history, setHistory] = useState<api.ContributionsHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [openYear, setOpenYear] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const h = await api.getContributionsHistory()
        if (cancelled) return
        setHistory(h)
        setError(null)
        // Ouvrir l'année la plus récente : arriver sur un tableau entièrement
        // replié oblige à un clic pour voir quoi que ce soit.
        setOpenYear(h.rows[0]?.year ?? null)
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [reloadKey])

  if (error) {
    return <ErrorPanel error={error} onRetry={() => setReloadKey((k) => k + 1)} />
  }
  if (loading || !history) {
    return <p className="p-4 text-sm text-muted-foreground">Chargement…</p>
  }

  const { totals } = history
  const chartRows = toYearRows(history)
  const grouped = groupByYear(history)
  const partialAvs = totals.partial_fields.includes("avs_ai_apg")

  if (chartRows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aucune cotisation enregistrée</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Cet écran se remplit à partir de vos bulletins de salaire et de vos certificats
            annuels. Ajoutez-les depuis la fiche d'un revenu, onglet « Bulletins ».
          </p>
          <p>
            Pour les années les plus anciennes, un certificat de salaire annuel suffit : il
            porte le brut, les cotisations sociales et le 2ᵉ pilier de l'année entière.
          </p>
        </CardContent>
      </Card>
    )
  }

  const exportCsv = async () => {
    const ok = await downloadExport(
      historyToCsv(history),
      `cotisations-carriere-${new Date().toISOString().slice(0, 10)}.csv`,
      "Exporter l'historique des cotisations",
    )
    if (ok) toast("Historique exporté.", "success")
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Historique des cotisations</h3>
          <p className="text-sm text-muted-foreground">
            {history.first_year === history.last_year
              ? `Année ${history.last_year}`
              : `De ${history.first_year} à ${history.last_year}`}{" "}
            · {totals.years_covered} année{totals.years_covered > 1 ? "s" : ""} ·{" "}
            {totals.receipt_count} bulletin{totals.receipt_count > 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="mr-1.5 h-4 w-4" />
          Exporter en CSV
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Brut cumulé" value={totals.gross_total} visible={amountsVisible} />
        <StatTile
          label="Cotisations sociales"
          value={totals.social_total}
          hint="AVS/AI/APG, chômage, LAA"
          visible={amountsVisible}
        />
        <StatTile label="2ᵉ pilier (LPP)" value={totals.lpp} visible={amountsVisible} />
        <StatTile
          label="Dont AVS/AI/APG"
          value={totals.avs_ai_apg}
          partial={partialAvs}
          hint={partialAvs ? "Au moins une année n'en connaît que le total" : undefined}
          visible={amountsVisible}
        />
      </div>

      {partialAvs && (
        <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
          <span>
            Certaines années ne sont connues que par leur certificat de salaire, qui publie un
            total de cotisations sans le détail. Le total AVS affiché est donc un minimum —
            d'où le <strong>+</strong>. Importez les bulletins de ces années pour l'affiner.
          </span>
        </p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Où est passé votre brut</CardTitle>
          <p className="text-xs text-muted-foreground">
            Chaque barre vaut le brut de l'année : ce qui vous est resté, et ce qui a été
            prélevé.
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="year" className="fill-muted-foreground text-xs" />
              <YAxis
                className="fill-muted-foreground text-xs"
                tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
              />
              <Tooltip
                formatter={(v, name) => [formatPrice(Number(v), "CHF"), name]}
                labelFormatter={(y) => `Année ${y}`}
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                }}
              />
              <Legend />
              {CONTRIBUTION_SERIES.map((serie, index) => (
                <Bar
                  key={serie.key}
                  dataKey={serie.key}
                  name={serie.label}
                  stackId="gross"
                  fill={serie.color}
                  // Un liseré de la couleur du fond sépare les segments : sans
                  // lui, deux teintes voisines se touchent et la frontière
                  // devient illisible, surtout en vision daltonienne.
                  stroke="var(--color-card)"
                  strokeWidth={1}
                  radius={index === CONTRIBUTION_SERIES.length - 1 ? [4, 4, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Détail par année</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {grouped.map(({ year, rows }) => {
            const open = openYear === year
            const gross = rows.reduce((a, r) => a + r.gross_total, 0)
            const social = rows.reduce((a, r) => a + r.social_total, 0)
            return (
              <div key={year} className="rounded-lg border">
                <button
                  type="button"
                  onClick={() => setOpenYear(open ? null : year)}
                  className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-accent/40"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">{year}</span>
                    <span className="text-xs text-muted-foreground">
                      {rows.length} employeur{rows.length > 1 ? "s" : ""}
                    </span>
                    {rows.some((r) => r.certificate_gap != null) && (
                      <Badge variant="warning">bulletin manquant</Badge>
                    )}
                  </span>
                  <span className="flex items-center gap-3 text-sm">
                    <span className="tabular-nums">
                      <MaskedAmount amount={gross} currency="CHF" visible={amountsVisible} /> brut
                    </span>
                    <span className="hidden tabular-nums text-muted-foreground sm:inline">
                      −<MaskedAmount amount={social} currency="CHF" visible={amountsVisible} /> de
                      cotisations
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                {open && (
                  <div className="overflow-x-auto border-t">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="p-2 text-left font-medium">Employeur</th>
                          <th className="p-2 text-right font-medium">Brut</th>
                          <th className="p-2 text-right font-medium">AVS/AI/APG</th>
                          <th className="p-2 text-right font-medium">AC</th>
                          <th className="p-2 text-right font-medium">LAA</th>
                          <th className="p-2 text-right font-medium">LPP</th>
                          <th className="p-2 text-right font-medium">IJM</th>
                          <th className="p-2 text-right font-medium">Impôt source</th>
                          <th className="p-2 text-right font-medium">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={`${r.income_id}-${r.year}`} className="border-b last:border-0">
                            <td className="p-2">
                              <Link
                                to={`/incomes/${r.income_id}`}
                                className="font-medium hover:underline"
                              >
                                {r.employer_name ?? r.income_name}
                              </Link>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {r.source === "certificate"
                                  ? "certificat annuel"
                                  : `${r.receipt_count} bulletin${r.receipt_count > 1 ? "s" : ""}`}
                              </span>
                              {r.certificate_gap != null && (
                                <span className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                                  <TriangleAlert className="h-3 w-3 shrink-0" />
                                  {formatPrice(Math.abs(r.certificate_gap), "CHF")} d'écart avec le
                                  certificat
                                </span>
                              )}
                            </td>
                            <Money v={r.gross_total} visible={amountsVisible} />
                            <Money v={r.avs_ai_apg} visible={amountsVisible} />
                            <Money v={r.ac} visible={amountsVisible} />
                            <Money v={r.laa_nonoccupational} visible={amountsVisible} />
                            <Money v={r.lpp} visible={amountsVisible} />
                            <Money v={r.ijm} visible={amountsVisible} />
                            <Money v={r.tax_at_source} visible={amountsVisible} />
                            <Money v={r.net} visible={amountsVisible} />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAmountsVisible(!amountsVisible)}
        >
          {amountsVisible ? "Masquer les montants" : "Afficher les montants"}
        </Button>
      </div>
    </div>
  )
}

/// Une cellule monétaire. `null` s'affiche « — » : le poste est inconnu, pas
/// nul, et un zéro se sommerait en silence dans la tête du lecteur.
function Money({ v, visible }: { v: number | null; visible: boolean }) {
  return (
    <td className="p-2 text-right tabular-nums">
      {v == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <MaskedAmount amount={v} currency="CHF" visible={visible} />
      )}
    </td>
  )
}
