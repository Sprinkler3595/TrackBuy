import { useEffect, useState } from "react"
import { Plus, Trash2, Tag, Save, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import * as api from "@/lib/tauri"

type Draft = { needle: string; merchant: string; category: string; tax_category: string }

const emptyDraft = (): Draft => ({ needle: "", merchant: "", category: "", tax_category: "" })

/**
 * Règles de classification marchand définies par l'utilisateur. Elles
 * complètent et surchargent la table suisse-centrée intégrée à classify.rs :
 * lors du rapprochement bancaire, un libellé contenant le « motif » prend le
 * nom, la catégorie et la rubrique fiscale indiqués ici (vérifiés en premier).
 */
export function MerchantRulesSettings() {
  const { toast } = useToast()
  const [rules, setRules] = useState<api.MerchantRule[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft())
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      setRules(await api.listMerchantRules())
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const toInput = (d: Draft): api.MerchantRuleInput => ({
    needle: d.needle.trim(),
    merchant: d.merchant.trim(),
    category: d.category.trim() || null,
    tax_category: d.tax_category.trim() || null,
  })

  const add = async () => {
    if (!draft.needle.trim() || !draft.merchant.trim()) {
      toast("Le motif et le marchand sont obligatoires.", "error")
      return
    }
    try {
      await api.createMerchantRule(toInput(draft))
      setDraft(emptyDraft())
      await load()
      toast("Règle ajoutée", "success")
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const startEdit = (r: api.MerchantRule) => {
    setEditingId(r.id)
    setEditDraft({
      needle: r.needle,
      merchant: r.merchant,
      category: r.category ?? "",
      tax_category: r.tax_category ?? "",
    })
  }

  const saveEdit = async () => {
    if (!editingId) return
    if (!editDraft.needle.trim() || !editDraft.merchant.trim()) {
      toast("Le motif et le marchand sont obligatoires.", "error")
      return
    }
    try {
      await api.updateMerchantRule(editingId, toInput(editDraft))
      setEditingId(null)
      await load()
      toast("Règle mise à jour", "success")
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteMerchantRule(deleteTarget)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Règles marchand
          </CardTitle>
          <CardDescription>
            Complètent la classification automatique des transactions bancaires.
            Si un libellé contient le « motif » (insensible à la casse), il sera
            étiqueté avec le marchand, la catégorie et la rubrique fiscale
            indiqués. Tes règles ont priorité sur la table intégrée.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add form */}
          <div className="grid gap-2 sm:grid-cols-4">
            <Input
              placeholder="Motif (ex. BOULANGERIE X)"
              value={draft.needle}
              onChange={(e) => setDraft({ ...draft, needle: e.target.value })}
            />
            <Input
              placeholder="Marchand"
              value={draft.merchant}
              onChange={(e) => setDraft({ ...draft, merchant: e.target.value })}
            />
            <Input
              placeholder="Catégorie (optionnel)"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
            <div className="flex gap-2">
              <Input
                placeholder="Rubrique fiscale (opt.)"
                value={draft.tax_category}
                onChange={(e) => setDraft({ ...draft, tax_category: e.target.value })}
              />
              <Button onClick={add} title="Ajouter">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* List */}
          {loading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune règle. Ajoute-en une pour reconnaître tes marchands habituels.
            </p>
          ) : (
            <div className="space-y-2">
              {rules.map((r) => (
                <div key={r.id} className="rounded-md border p-2">
                  {editingId === r.id ? (
                    <div className="grid gap-2 sm:grid-cols-4">
                      <Input value={editDraft.needle} onChange={(e) => setEditDraft({ ...editDraft, needle: e.target.value })} />
                      <Input value={editDraft.merchant} onChange={(e) => setEditDraft({ ...editDraft, merchant: e.target.value })} />
                      <Input value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })} />
                      <div className="flex gap-2">
                        <Input value={editDraft.tax_category} onChange={(e) => setEditDraft({ ...editDraft, tax_category: e.target.value })} />
                        <Button size="icon" onClick={saveEdit} title="Enregistrer"><Save className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditingId(null)} title="Annuler"><X className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {r.merchant} <span className="text-muted-foreground">← {r.needle}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.category || "—"}{r.tax_category ? ` · fiscal : ${r.tax_category}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Modifier</Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(r.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer la règle"
        message="Cette règle de classification sera supprimée."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="destructive"
        onConfirm={remove}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
