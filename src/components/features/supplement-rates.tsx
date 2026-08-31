import { useEffect, useState } from "react"
import { Lock, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import { SUPPLEMENT_UNITS } from "@/lib/supplements"
import { formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// Le barème de suppléments d'une entreprise : astreinte, samedi, dimanche.
///
/// Rattaché à une version de contrat, donc à une période. Le tarif du dimanche
/// peut changer avec un avenant, et l'historique doit pouvoir dire ce qu'il
/// valait en 2019 — sans quoi contrôler une vieille fiche n'aurait aucun sens.
///
/// Trois suggestions sont proposées d'un clic parce que ce sont, de loin, les
/// trois cas rencontrés. Rien n'oblige à les prendre.

const SUGGESTIONS = [
  { label: "Astreinte", unit: "week", amount: 500 },
  { label: "Samedi travaillé", unit: "day", amount: 0 },
  { label: "Dimanche travaillé", unit: "day", amount: 0 },
]

export function SupplementRates({
  contractId,
  currency = "CHF",
  readOnly = false,
  onChanged,
}: {
  contractId: string
  currency?: string
  /// Verrouillé quand cette version de contrat juge déjà des bulletins :
  /// changer un tarif ici modifierait le contrôle de fiches déjà validées.
  readOnly?: boolean
  onChanged?: () => void
}) {
  const { toast } = useToast()
  const [rates, setRates] = useState<api.SupplementRate[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({ label: "", unit: "day", amount: "" })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const list = await api.getSupplementRates(contractId)
        if (!cancelled) setRates(list)
      } catch {
        if (!cancelled) setRates([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [contractId])

  const save = async (rate: api.SupplementRate) => {
    try {
      setRates(await api.upsertSupplementRate(rate))
      onChanged?.()
    } catch (e) {
      toast(`Erreur : ${e}`, "error")
    }
  }

  const add = async (label: string, unit: string, amount: number) => {
    if (!label.trim()) {
      toast("Donnez un nom à ce supplément.", "error")
      return
    }
    await save({
      id: "",
      contract_id: contractId,
      code: "",
      label: label.trim(),
      unit,
      amount,
      sort_order: rates.length,
    })
    setDraft({ label: "", unit: "day", amount: "" })
  }

  const remove = async (id: string) => {
    try {
      await api.deleteSupplementRate(id)
      setRates(await api.getSupplementRates(contractId))
      onChanged?.()
    } catch (e) {
      toast(`Erreur : ${e}`, "error")
    }
  }

  const missing = SUGGESTIONS.filter(
    (s) => !rates.some((r) => r.label.toLowerCase() === s.label.toLowerCase()),
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Barème de votre entreprise</CardTitle>
        <p className="text-xs text-muted-foreground">
          Ce que vaut une semaine d'astreinte, un samedi ou un dimanche travaillé. Une fois
          saisi, il suffira d'indiquer combien vous en avez fait chaque mois — les montants
          se calculent, et l'application peut vérifier que votre employeur les a bien payés.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {readOnly && (
          <p className="flex gap-2 rounded-md border p-3 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Des bulletins sont déjà contrôlés avec cette version : son barème est verrouillé.
            Pour changer un tarif, annoncez un changement — le barème sera recopié sur la
            nouvelle version.
          </p>
        )}
        <fieldset disabled={readOnly} className="contents">
        {loading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : rates.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Aucun supplément. Si votre salaire ne comporte que le fixe, il n'y a rien à
            saisir ici.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rates.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
                <Input
                  className="min-w-40 flex-1"
                  value={r.label}
                  onChange={(e) =>
                    setRates((prev) =>
                      prev.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)),
                    )
                  }
                  onBlur={() => save(r)}
                />
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={r.unit}
                  onChange={(e) => save({ ...r, unit: e.target.value })}
                >
                  {SUPPLEMENT_UNITS.map((u) => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  className="w-32"
                  value={String(r.amount)}
                  onChange={(e) =>
                    setRates((prev) =>
                      prev.map((x) =>
                        x.id === r.id ? { ...x, amount: parseFloat(e.target.value) || 0 } : x,
                      ),
                    )
                  }
                  onBlur={() => save(r)}
                />
                <span className="text-xs text-muted-foreground">{currency}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(r.id)}
                  aria-label={`Supprimer ${r.label}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Nom</label>
            <Input
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder="Ex. Piquet de nuit"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Unité</label>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={draft.unit}
              onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
            >
              {SUPPLEMENT_UNITS.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Montant</label>
            <Input
              type="number"
              step="0.05"
              min="0"
              className="w-32"
              value={draft.amount}
              onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
              placeholder="0.00"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => add(draft.label, draft.unit, parseFloat(draft.amount) || 0)}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Ajouter
          </Button>
        </div>

        {missing.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Suggestions :</span>
            {missing.map((sug) => (
              <Button
                key={sug.label}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => add(sug.label, sug.unit, sug.amount)}
              >
                + {sug.label}
                {sug.amount > 0 && ` (${formatPrice(sug.amount, currency)})`}
              </Button>
            ))}
          </div>
        )}
        </fieldset>
      </CardContent>
    </Card>
  )
}
