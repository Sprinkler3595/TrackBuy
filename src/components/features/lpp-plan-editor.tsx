import { useEffect, useState } from "react"
import { CalendarClock, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import {
  LEGAL_MINIMUM_PLAN,
  bracketForAge,
  employerPct,
  lppAge,
  nextBracket,
} from "@/lib/lpp-plan"
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
  birthDate,
  flatRate,
  onChanged,
}: {
  contractId: string
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
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({ age_from: "", age_to: "", total: "", employee: "" })

  const year = new Date().getFullYear()
  const age = lppAge(birthDate, year)
  const current = bracketForAge(plan, age)
  const next = nextBracket(plan, age, year)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const list = await api.getLppPlan(contractId)
        if (!cancelled) setPlan(list)
      } catch {
        if (!cancelled) setPlan([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [contractId])

  const save = async (b: api.LppPlanBracket) => {
    try {
      setPlan(await api.upsertLppPlanBracket(b))
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
    await save({ id: "", contract_id: contractId, age_from: from, age_to: to, total_pct: total, employee_pct: employee })
    setDraft({ age_from: "", age_to: "", total: "", employee: "" })
  }

  const seedLegalMinimum = async () => {
    for (const b of LEGAL_MINIMUM_PLAN) {
      if (plan.some((p) => p.age_from === b.age_from)) continue
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
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Ce qui s'applique aujourd'hui, et ce qui viendra ensuite. C'est la
            réponse à « est-ce que ça va vraiment changer tout seul ? ». */}
        {plan.length > 0 && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            {age == null ? (
              <p className="text-amber-700 dark:text-amber-500">
                Renseignez votre date de naissance ci-dessus : sans elle, aucune tranche ne
                peut être choisie et c'est le taux fixe qui s'applique.
              </p>
            ) : current ? (
              <>
                <p>
                  <span className="font-medium">
                    {age} ans au sens LPP en {year}
                  </span>{" "}
                  → tranche {current.age_from}–{current.age_to} ans :{" "}
                  {pct(current.total_pct)} au total, dont{" "}
                  <span className="font-medium">{pct(current.employee_pct)} à votre charge</span>{" "}
                  et {pct(employerPct(current))} pour l'employeur.
                </p>
                {next && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                    Le 1ᵉʳ janvier {next.year}, vous passerez à la tranche{" "}
                    {next.bracket.age_from}–{next.bracket.age_to} ans :{" "}
                    {pct(next.bracket.employee_pct)} à votre charge. Rien à faire.
                  </p>
                )}
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
            <Button type="button" variant="outline" size="sm" onClick={seedLegalMinimum}>
              <Plus className="mr-1.5 h-4 w-4" />
              Partir du minimum légal
            </Button>
            <p className="text-xs text-muted-foreground">
              7 / 10 / 15 / 18 % selon l'âge (art. 16 LPP), partagés par moitié. Beaucoup
              d'entreprises cotisent davantage : corrigez ensuite avec votre règlement de caisse.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
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
                  const active = current?.id === b.id
                  return (
                    <tr key={b.id} className={active ? "bg-primary/5" : undefined}>
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
                        {pct(employerPct(b))}
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

        <p className="text-xs text-muted-foreground">
          Votre part ne peut pas dépasser la moitié du total : l'employeur doit financer au
          moins autant que vous (art. 66 al. 1 LPP). Les âges s'entendent au sens LPP — année
          civile moins année de naissance — d'où un changement au 1ᵉʳ janvier.
        </p>
      </CardContent>
    </Card>
  )
}
