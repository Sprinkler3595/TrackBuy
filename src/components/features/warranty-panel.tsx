import { useEffect, useState } from "react"
import { Plus, Trash2, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatDate, daysUntil } from "@/lib/utils"
import * as api from "@/lib/tauri"

interface WarrantyPanelProps {
  itemId: string
  itemDescription: string
  purchaseDate: string
  cardWarrantyMonths?: number
}

export function WarrantyPanel({ itemId, itemDescription, purchaseDate, cardWarrantyMonths }: WarrantyPanelProps) {
  const [warranties, setWarranties] = useState<api.Warranty[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [form, setForm] = useState({ duration_months: "12", notes: "" })
  const { toast } = useToast()

  const load = async () => {
    try { setWarranties(await api.getWarranties(itemId)) } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [itemId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.createWarranty({
        item_id: itemId,
        start_date: purchaseDate,
        duration_months: parseInt(form.duration_months) || 12,
        notes: form.notes || undefined,
      })
      toast("Garantie ajoutée", "success")
      setShowForm(false)
      setForm({ duration_months: "12", notes: "" })
      await load()
    } catch (e) { toast(`Erreur: ${e}`, "error") }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteWarranty(deleteTarget)
      toast("Garantie supprimée", "success")
      setDeleteTarget(null)
      await load()
    } catch (e) { toast(`Erreur: ${e}`, "error") }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-20"><div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Garanties — {itemDescription}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
            <Plus className="h-3 w-3" />
            Ajouter
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {cardWarrantyMonths != null && cardWarrantyMonths > 0 && (
          <div className="rounded-lg border border-dashed border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-3">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-300">
              Bonus carte de crédit : +{cardWarrantyMonths} mois de garantie étendue
            </p>
          </div>
        )}

        {showForm && (
          <form onSubmit={handleSubmit} className="rounded-lg border p-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Date de départ : <span className="font-medium text-foreground">{formatDate(purchaseDate)}</span> (date d'achat)
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium">Durée (mois)</label>
                <Input type="number" min="1" value={form.duration_months} onChange={(e) => setForm({ ...form, duration_months: e.target.value })} required />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Notes</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Fabricant, étendue..." />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm">Ajouter</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>Annuler</Button>
            </div>
          </form>
        )}

        {warranties.length === 0 && !showForm ? (
          <p className="text-sm text-muted-foreground text-center py-4">Aucune garantie enregistrée</p>
        ) : (
          warranties.map((w) => {
            const days = w.end_date ? daysUntil(w.end_date) : null
            return (
              <div key={w.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">
                    {formatDate(w.start_date)} &rarr; {w.end_date ? formatDate(w.end_date) : "?"} ({w.duration_months} mois)
                  </p>
                  {w.notes && <p className="text-xs text-muted-foreground">{w.notes}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {days !== null && (
                    <Badge variant={days < 0 ? "destructive" : days <= 7 ? "destructive" : days <= 30 ? "warning" : "success"}>
                      {days < 0 ? "Expirée" : `${days}j`}
                    </Badge>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(w.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            )
          })
        )}

        <ConfirmDialog
          open={deleteTarget !== null}
          title="Supprimer la garantie"
          message="Cette garantie sera supprimée définitivement."
          confirmLabel="Supprimer"
          variant="destructive"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </CardContent>
    </Card>
  )
}
