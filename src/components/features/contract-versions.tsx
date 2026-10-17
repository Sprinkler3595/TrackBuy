import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate, formatPrice } from "@/lib/utils"
import { changeLog } from "@/lib/contract-changes"
import type * as api from "@/lib/tauri"

/// La frise des avenants d'un contrat.
///
/// Deux principes d'ergonomie la gouvernent.
///
/// **Elle se tait quand il n'y a rien à dire.** Tant qu'un seul contrat existe,
/// ce composant n'affiche rien du tout : la grande majorité des gens n'a jamais
/// signé d'avenant, et leur imposer une liste à un élément serait du bruit. Le
/// bouton « Ajouter un avenant » vit dans le formulaire, là où on vient déjà.
///
/// **Une version passée reste modifiable.** Corriger une saisie de 2019 est
/// légitime ; ce qui ne doit pas arriver, c'est de la réécrire sans le vouloir
/// en croyant enregistrer les conditions d'aujourd'hui. D'où la sélection
/// explicite.

const periodLabel = (c: api.EmploymentContract): string => {
  // La borne basse technique ne veut rien dire pour un lecteur : un contrat
  // sans date d'effet couvre simplement tout ce qui précède.
  const from =
    c.started_on && c.started_on > "0002-01-01"
      ? `dès le ${formatDate(c.started_on)}`
      : "depuis toujours"
  return c.ended_on ? `${from}, jusqu'au ${formatDate(c.ended_on)}` : `${from}, en cours`
}

export function ContractVersions({
  versions,
  selectedId,
  onSelect,
  onAddAmendment,
  onDelete,
  currency = "CHF",
}: {
  versions: api.EmploymentContract[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAddAmendment: () => void
  onDelete: (id: string) => void
  currency?: string
}) {
  if (versions.length <= 1) return null

  // Chaque version accompagnée de ce que son arrivée a changé, de la plus
  // récente à la plus ancienne.
  const log = changeLog(versions)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Avenants</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Chaque bulletin est contrôlé avec les conditions en vigueur au moment où il a
              été versé.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onAddAmendment}>
            <Plus className="mr-1.5 h-4 w-4" />
            Ajouter un avenant
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {log.map(({ version: v, changes }) => {
          const active = v.id === selectedId
          const current = v.ended_on == null
          return (
            <div
              key={v.id}
              className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                active ? "border-primary bg-primary/5" : "hover:bg-accent/40"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(v.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {v.label || "Version sans nom"}
                  </span>
                  {current && <Badge variant="success">en vigueur</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {periodLabel(v)}
                  {v.annual_gross_agreed != null &&
                    ` · ${formatPrice(v.annual_gross_agreed, currency)} par an`}
                </span>
                {/* Ce que SON arrivée a changé. La liste nommait la version,
                    pas le changement — or c'est le changement qu'on vient
                    vérifier, et qui sert de preuve si une fiche est contestée. */}
                {changes.length > 0 && (
                  <span className="mt-1.5 block space-y-0.5">
                    {changes.map((c) => (
                      <span key={c.label} className="block text-xs">
                        <span className="text-muted-foreground">{c.label} : </span>
                        <span className="text-muted-foreground line-through">{c.before}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="font-medium">{c.after}</span>
                      </span>
                    ))}
                  </span>
                )}
              </button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(v.id)}
                aria-label={`Supprimer ${v.label || "cette version"}`}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
