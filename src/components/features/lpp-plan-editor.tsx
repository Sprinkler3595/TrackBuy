import { useEffect, useState } from "react"
import { CalendarClock, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import {
  AXA_COLUMNA_STANDARD,
  LEGAL_MINIMUM_PLAN,
  LPP_BASES,
  basisLabel,
  bracketForAge,
  employerPct,
  lppAge,
  nextBracket,
} from "@/lib/lpp-plan"
import { formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// Le plan de prévoyance de l'entreprise, tranche d'âge par tranche d'âge.
///
/// Un taux unique ne décrit aucun plan suisse réel : la cotisation monte par
/// paliers, et chaque palier a sa répartition — 8 % dont 4 à votre charge entre
/// 18 et 25 ans, 10 % dont 5 ensuite, et rien n'oblige un employeur à s'en
/// tenir à moitié-moitié. Avec un scalaire, la retenue projetée restait figée à
/// vie et il fallait la corriger à la main le 1ᵉʳ janvier suivant chaque
/// anniversaire de palier — un rendez-vous qu'on manque forcément.
///
/// Deux choses sont donc affichées en permanence : la tranche EN VIGUEUR, pour
/// qu'on voie ce qui s'applique, et la DATE du prochain palier, pour qu'on
/// sache que le changement se fera tout seul. L'âge retenu est l'âge LPP —
/// `année − année de naissance` — d'où un basculement au 1ᵉʳ janvier.

const pct = (n: number) => `${Math.round(n * 1000) / 1000} %`

export function LppPlanEditor({
  contractId,
  currency = "CHF",
  birthDate,
  flatRate,
  onChanged,
}: {
  contractId: string
  currency?: string
  /// Sans elle, aucun âge n'est calculable : le plan se saisit quand même,
  /// mais rien ne peut dire quelle tranche s'applique.
  birthDate: string | null
  /// Le taux fixe du contrat, qui reste le repli quand aucune tranche ne
  /// couvre l'âge.
  flatRate: number | null
  onChanged?: () => void
}) {
  const { toast } = useToast()
  const [plan, setPlan] = useState<api.LppPlanBracket[]>([])
  /// Le plan traduit en francs par le moteur. Recalculé après chaque écriture :
  /// changer un taux sans voir bouger le montant serait un aveu d'impuissance.
  const [preview, setPreview] = useState<api.LppPlanPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({
    age_from: "",
    age_to: "",
    total: "",
    employee: "",
    basis: "coordinated",
  })

  const year = new Date().getFullYear()
  const age = lppAge(birthDate, year)
  /// Une tranche en vigueur PAR assiette : un plan qui empile l'épargne sur le
  /// salaire coordonné et un taux fixe sur la part au-delà en a deux à la
  /// fois, et n'en montrer qu'une cacherait la moitié de la retenue.
  const currentByBasis = LPP_BASES.map((b) => ({
    basis: b.value as string,
    bracket: bracketForAge(plan.filter((p) => p.basis === b.value), age),
  })).filter((x) => x.bracket != null)
  const current = currentByBasis[0]?.bracket ?? null
  const next = nextBracket(
    plan.filter((p) => p.basis === "coordinated"),
    age,
    year,
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [list, p] = await Promise.all([
          api.getLppPlan(contractId),
          api.previewLppPlan(contractId, new Date().getFullYear()).catch(() => null),
        ])
        if (!cancelled) {
          setPlan(list)
          setPreview(p)
        }
      } catch {
        if (!cancelled) setPlan([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [contractId])

  const refreshPreview = () =>
    api
      .previewLppPlan(contractId, new Date().getFullYear())
      .then(setPreview)
      .catch(() => setPreview(null))

  const save = async (b: api.LppPlanBracket) => {
    try {
      setPlan(await api.upsertLppPlanBracket(b))
      void refreshPreview()
      onChanged?.()
    } catch (e) {
      toast(`${e}`, "error")
      // Le refus vient du backend (art. 66 al. 1 LPP, bornes inversées) : on
      // recharge pour que l'écran cesse d'afficher une valeur qui n'a pas pris.
      try {
        setPlan(await api.getLppPlan(contractId))
      } catch {
        /* le message d'erreur suffit */
      }
    }
  }

  const remove = async (id: string) => {
    try {
      await api.deleteLppPlanBracket(id)
      setPlan(await api.getLppPlan(contractId))
      void refreshPreview()
      onChanged?.()
    } catch (e) {
      toast(`Erreur : ${e}`, "error")
    }
  }

  const addDraft = async () => {
    const from = parseInt(draft.age_from, 10)
    const to = parseInt(draft.age_to, 10)
    const total = parseFloat(draft.total)
    const employee = parseFloat(draft.employee)
    if ([from, to].some(Number.isNaN) || [total, employee].some(Number.isNaN)) {
      toast("Complétez les quatre champs de la tranche.", "error")
      return
    }
    await save({
      id: "",
      contract_id: contractId,
      age_from: from,
      age_to: to,
      total_pct: total,
      employee_pct: employee,
      basis: draft.basis,
    })
    setDraft({ age_from: "", age_to: "", total: "", employee: "", basis: "coordinated" })
  }

  const seed = async (preset: typeof LEGAL_MINIMUM_PLAN) => {
    for (const b of preset) {
      if (plan.some((p) => p.age_from === b.age_from && p.basis === b.basis)) continue
      await save({ id: "", contract_id: contractId, ...b })
    }
  }

  const patch = (id: string, field: keyof api.LppPlanBracket, value: number) =>
    setPlan((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Votre plan de prévoyance</CardTitle>
        <p className="text-xs text-muted-foreground">
          La cotisation au 2ᵉ pilier monte par paliers d'âge, et chaque palier a sa
          répartition entre vous et l'employeur. Saisissez-la une fois : le passage d'un
          palier se fera tout seul, au 1ᵉʳ janvier.
        </p>
        <p className="text-xs text-muted-foreground">
          Ce plan et le « taux unique de repli » de la carte précédente répondent à la même
          question — ils ne s'additionnent pas. Dès qu'une tranche couvre votre âge, c'est
          elle qui s'applique et le taux unique est ignoré.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Ce qui s'applique aujourd'hui, et ce qui viendra ensuite. C'est la
            réponse à « est-ce que ça va vraiment changer tout seul ? ». */}
        {plan.length > 0 && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            {age == null ? (
              <p className="text-amber-700 dark:text-amber-500">
                Renseignez votre date de naissance ci-dessus : sans elle, aucun âge n'est
                calculable, donc aucune tranche ne peut être choisie.{" "}
                {flatRate != null
                  ? `En attendant, c'est le « taux unique de repli » du contrat (${pct(flatRate)}) qui s'applique, et ce plan reste sans effet.`
                  : "En attendant, aucune retenue LPP ne peut être calculée."}
              </p>
            ) : current ? (
              <>
                <p className="font-medium">
                  {age} ans au sens LPP en {year}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {currentByBasis.map(({ basis, bracket }) => (
                    <li key={basis}>
                      {basisLabel(basis)} · tranche {bracket!.age_from}–{bracket!.age_to} ans :{" "}
                      {pct(bracket!.total_pct)} au total, dont{" "}
                      <span className="font-medium">
                        {pct(bracket!.employee_pct)} à votre charge
                      </span>{" "}
                      et {pct(employerPct(bracket!))} pour l'employeur.
                    </li>
                  ))}
                </ul>
                {next && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                    Le 1ᵉʳ janvier {next.year}, vous passerez à la tranche{" "}
                    {next.bracket.age_from}–{next.bracket.age_to} ans :{" "}
                    {pct(next.bracket.employee_pct)} à votre charge. Rien à faire.
                  </p>
                )}
                {/* Deux champs répondent à la même question, sur deux cartes.
                    Dire lequel gagne vaut mieux que laisser deviner. */}
                {flatRate != null && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Le « taux unique de repli » du contrat ({pct(flatRate)}) n'est donc pas
                    utilisé : c'est ce plan qui s'applique.
                  </p>
                )}
                <PlanInFrancs preview={preview} currency={currency} />
              </>
            ) : (
              <p className="text-amber-700 dark:text-amber-500">
                À {age} ans, aucune tranche de votre plan ne s'applique.{" "}
                {flatRate != null
                  ? `Le taux fixe du contrat (${pct(flatRate)}) est utilisé à la place.`
                  : "Aucune retenue LPP ne peut donc être calculée."}
              </p>
            )}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : plan.length === 0 ? (
          <div className="space-y-3 rounded-md border border-dashed p-4">
            <p className="text-sm text-muted-foreground">
              Aucune tranche. Sans plan, c'est le taux fixe du contrat qui s'applique à tout
              âge — correct tant que votre caisse n'a qu'un seul taux.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => seed(LEGAL_MINIMUM_PLAN)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Minimum légal
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => seed(AXA_COLUMNA_STANDARD)}>
                <Plus className="mr-1.5 h-4 w-4" />
                AXA Columna « Standard »
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Le <strong>minimum légal</strong> : 7 / 10 / 15 / 18 % selon l'âge (art. 16 LPP),
              partagés par moitié. Beaucoup d'entreprises cotisent davantage.
            </p>
            <p className="text-xs text-muted-foreground">
              <strong>AXA Columna « Standard »</strong> : 8 / 11 / 16 / 19 % dès 20 ans sur le
              salaire coordonné, dont 40 % à votre charge, plus 4 % sur la part au-delà de la
              limite LPP. Ce sont les chiffres d'un contrat précis — AXA propose plusieurs
              variantes et chaque entreprise négocie les siennes. Vérifiez sur votre propre
              document, puis corrigez ici.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Assiette</th>
                  <th className="pb-2 font-medium">De</th>
                  <th className="pb-2 font-medium">À (inclus)</th>
                  <th className="pb-2 font-medium">Total %</th>
                  <th className="pb-2 font-medium">Votre part %</th>
                  <th className="pb-2 font-medium">Employeur</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {plan.map((b) => {
                  // Une tranche est en vigueur par assiette : marquer la
                  // seule première laisserait croire que l'autre dort.
                  const active = currentByBasis.some((x) => x.bracket?.id === b.id)
                  return (
                    <tr key={b.id} className={active ? "bg-primary/5" : undefined}>
                      <td className="py-2 pr-2">
                        <select
                          className="h-9 w-48 rounded-md border border-input bg-background px-2 text-sm"
                          value={b.basis}
                          onChange={(e) =>
                            save({ ...b, basis: e.target.value })
                          }
                        >
                          {LPP_BASES.map((x) => (
                            <option key={x.value} value={x.value}>{x.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          type="number" min="0" max="99" className="h-9 w-20"
                          value={String(b.age_from)}
                          onChange={(e) => patch(b.id, "age_from", parseInt(e.target.value, 10) || 0)}
                          onBlur={() => save(b)}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          type="number" min="0" max="99" className="h-9 w-20"
                          value={String(b.age_to)}
                          onChange={(e) => patch(b.id, "age_to", parseInt(e.target.value, 10) || 0)}
                          onBlur={() => save(b)}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          type="number" min="0" step="0.1" className="h-9 w-24"
                          value={String(b.total_pct)}
                          onChange={(e) => patch(b.id, "total_pct", parseFloat(e.target.value) || 0)}
                          onBlur={() => save(b)}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          type="number" min="0" step="0.1" className="h-9 w-24"
                          value={String(b.employee_pct)}
                          onChange={(e) => patch(b.id, "employee_pct", parseFloat(e.target.value) || 0)}
                          onBlur={() => save(b)}
                        />
                      </td>
                      <td className="py-2 pr-2 tabular-nums text-muted-foreground">
                        {employerPct(b) < b.employee_pct ? (
                          <span
                            className="text-amber-700 dark:text-amber-500"
                            title="Votre part dépasse la moitié du total sur cette composante. L'art. 66 al. 1 LPP porte sur le TOTAL des cotisations — épargne, risque et frais réunis — donc ce n'est pas forcément irrégulier ; vérifiez sur votre règlement de caisse."
                          >
                            {pct(employerPct(b))} ⚠
                          </span>
                        ) : (
                          pct(employerPct(b))
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <span className="flex items-center justify-end gap-1">
                          {active && <Badge variant="success">en vigueur</Badge>}
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => remove(b.id)}
                            aria-label={`Supprimer la tranche ${b.age_from}–${b.age_to} ans`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {plan.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Assiette</label>
              <select
                className="h-10 w-48 rounded-md border border-input bg-background px-2 text-sm"
                value={draft.basis}
                onChange={(e) => setDraft((d) => ({ ...d, basis: e.target.value }))}
              >
                {LPP_BASES.map((x) => (
                  <option key={x.value} value={x.value}>{x.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">De</label>
              <Input type="number" min="0" max="99" className="w-20" value={draft.age_from}
                onChange={(e) => setDraft((d) => ({ ...d, age_from: e.target.value }))} placeholder="25" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">À</label>
              <Input type="number" min="0" max="99" className="w-20" value={draft.age_to}
                onChange={(e) => setDraft((d) => ({ ...d, age_to: e.target.value }))} placeholder="34" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Total %</label>
              <Input type="number" min="0" step="0.1" className="w-24" value={draft.total}
                onChange={(e) => setDraft((d) => ({ ...d, total: e.target.value }))} placeholder="10" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Votre part %</label>
              <Input type="number" min="0" step="0.1" className="w-24" value={draft.employee}
                onChange={(e) => setDraft((d) => ({ ...d, employee: e.target.value }))} placeholder="5" />
            </div>
            <Button type="button" variant="outline" onClick={addDraft}>
              <Plus className="mr-1.5 h-4 w-4" />
              Ajouter
            </Button>
          </div>
        )}

        <div className="space-y-2 border-t pt-4 text-xs text-muted-foreground">
          <p>
            L'employeur doit financer au moins autant que l'ensemble des salariés
            (art. 66 al. 1 LPP). Attention : cette règle porte sur le <strong>total</strong> des
            cotisations — épargne, primes de risque et frais réunis — pas sur chaque composante
            prise à part. Une part majoritaire sur la seule épargne est donc signalée ici, mais
            pas refusée : elle peut être parfaitement régulière si l'employeur reprend la main
            sur le reste.
          </p>
          <p>
            Les âges s'entendent au sens LPP — année civile moins année de naissance — d'où un
            changement au 1ᵉʳ janvier. L'épargne obligatoire ne démarre qu'à 25 ans
            (art. 7 LPP) ; avant cela, seuls les risques décès et invalidité sont couverts,
            dès 18 ans.
          </p>
          <p>
            Un plan peut empiler des cotisations sur plusieurs assiettes : c'est ce que fait
            AXA, qui prélève selon l'âge sur le salaire coordonné <em>et</em> un taux fixe sur
            la part au-delà de la limite LPP.
          </p>
          <ul className="space-y-1 pl-4">
            {LPP_BASES.map((b) => (
              <li key={b.value} className="list-disc">
                <strong>{b.label}</strong> — {b.hint}
              </li>
            ))}
          </ul>
          <p>
            Les cotisations de <strong>risque et de frais</strong> ne figurent pas ici : les
            plans en donnent la clé de répartition, pas le taux, qui vit sur la facture
            annuelle de la caisse. Votre retenue réelle peut donc être un peu supérieure à
            l'épargne calculée — ajoutez-la comme une tranche si vous connaissez son taux.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/// Le plan traduit en francs. C'est la question que tout le monde se pose et
/// qu'aucun pourcentage ne résout : « ça me coûte combien, et c'est quelle part
/// de mon brut ? » Ne pas y répondre, c'est laisser quelqu'un taper 50 dans un
/// champ de taux parce que sa caisse lui a dit « 50/50 ».
///
/// Le minimum légal est donné à côté, pour situer — pas comme un plafond. La
/// loi ne plafonne PAS la cotisation totale : elle impose un minimum d'épargne
/// (art. 16 LPP) et un partage (art. 66 al. 1). Un plan plus généreux fait donc
/// légitimement monter les deux parts.
function PlanInFrancs({
  preview,
  currency,
}: {
  preview: api.LppPlanPreview | null
  currency: string
}) {
  if (!preview || preview.annual_salary == null || preview.employee_annual == null) {
    return null
  }
  const { employee_annual, employee_pct_of_gross, coordinated_salary } = preview
  return (
    <div className="mt-3 space-y-1.5 border-t pt-3 text-xs">
      <p className="text-sm">
        Sur un brut de {formatPrice(preview.annual_salary, currency)}, votre salaire coordonné
        vaut {formatPrice(coordinated_salary, currency)} et votre part du 2ᵉ pilier{" "}
        <span className="font-medium">{formatPrice(employee_annual, currency)} par an</span>
        {employee_pct_of_gross != null && (
          <> — soit <span className="font-medium">{employee_pct_of_gross.toFixed(2)} % de votre brut</span></>
        )}
        .
      </p>
      {preview.legal_credit_pct > 0 && preview.legal_min_employee_pct_of_gross != null && (
        <p className="text-muted-foreground">
          À titre de repère : un plan s'en tenant au minimum légal cotiserait{" "}
          {pct(preview.legal_credit_pct)} du salaire coordonné (art. 16 LPP), dont au plus la
          moitié à votre charge —{" "}
          {formatPrice(preview.legal_min_employee_annual, currency)} par an, soit{" "}
          {preview.legal_min_employee_pct_of_gross.toFixed(2)} % du brut. La loi ne plafonne
          pas la cotisation totale : un plan plus généreux fait monter les deux parts.
        </p>
      )}
      {preview.legal_credit_pct === 0 && preview.age != null && preview.age < 25 && (
        <p className="text-muted-foreground">
          À {preview.age} ans, la loi n'impose encore aucune épargne vieillesse — elle ne
          couvre que les risques décès et invalidité, dès 18 ans. Ce que votre caisse
          prélève au-delà est un choix de votre employeur.
        </p>
      )}
    </div>
  )
}
