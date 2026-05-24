import { useEffect, useState } from "react"
import { Plus, Trash2, Edit, CreditCard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import * as api from "@/lib/tauri"

export function CardsPage() {
  const [cards, setCards] = useState<api.PaymentCard[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<api.PaymentCard | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", is_credit_card: false, extended_warranty_months: "0", extended_warranty_description: "" })
  const { toast } = useToast()

  const load = async () => { try { setCards(await api.getCards()) } catch (e) { console.error(e) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])

  const resetForm = () => { setForm({ name: "", is_credit_card: false, extended_warranty_months: "0", extended_warranty_description: "" }); setEditing(null); setShowForm(false) }

  const handleEdit = (c: api.PaymentCard) => {
    setForm({ name: c.name, is_credit_card: c.is_credit_card, extended_warranty_months: String(c.extended_warranty_months), extended_warranty_description: c.extended_warranty_description || "" })
    setEditing(c); setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editing) {
        await api.updateCard({ ...editing, name: form.name, is_credit_card: form.is_credit_card, extended_warranty_months: parseInt(form.extended_warranty_months) || 0, extended_warranty_description: form.extended_warranty_description || null })
        toast("Carte modifiée", "success")
      } else {
        await api.createCard({ name: form.name, is_credit_card: form.is_credit_card, extended_warranty_months: parseInt(form.extended_warranty_months) || 0, extended_warranty_description: form.extended_warranty_description || undefined })
        toast("Carte ajoutée", "success")
      }
      resetForm(); await load()
    } catch (e) { toast(`Erreur: ${e}`, "error") }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try { await api.deleteCard(deleteTarget); toast("Carte supprimée", "success"); setDeleteTarget(null); await load() } catch (e) { toast(`Erreur: ${e}`, "error") }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-3xl font-bold tracking-tight">Cartes de paiement</h2><p className="text-muted-foreground">{cards.length} carte(s)</p></div>
        <Button onClick={() => { resetForm(); setShowForm(true) }}><Plus className="h-4 w-4" />Nouvelle carte</Button>
      </div>

      {showForm && (
        <Card><CardHeader><CardTitle className="text-lg">{editing ? "Modifier" : "Nouvelle carte"}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><label className="text-sm font-medium">Nom *</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus /></div>
              <div className="flex items-center gap-3 pt-6">
                <input type="checkbox" id="is_credit" checked={form.is_credit_card} onChange={(e) => setForm({ ...form, is_credit_card: e.target.checked })} className="h-4 w-4 rounded border" />
                <label htmlFor="is_credit" className="text-sm font-medium">Carte de crédit</label>
              </div>
              <div className="space-y-2"><label className="text-sm font-medium">Garantie étendue (mois)</label><Input type="number" min="0" value={form.extended_warranty_months} onChange={(e) => setForm({ ...form, extended_warranty_months: e.target.value })} /></div>
              <div className="space-y-2"><label className="text-sm font-medium">Description garantie</label><Input value={form.extended_warranty_description} onChange={(e) => setForm({ ...form, extended_warranty_description: e.target.value })} /></div>
              <div className="flex gap-2 sm:col-span-2"><Button type="submit">{editing ? "Modifier" : "Ajouter"}</Button><Button type="button" variant="outline" onClick={resetForm}>Annuler</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.length === 0 ? (
          <Card className="sm:col-span-2 lg:col-span-3"><CardContent className="flex flex-col items-center py-12 text-muted-foreground"><CreditCard className="h-12 w-12 mb-4 opacity-20" /><p>Aucune carte</p></CardContent></Card>
        ) : cards.map((c) => (
          <Card key={c.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{c.name}</p>
                    {c.is_credit_card && <Badge variant="outline" className="text-[10px]">Crédit</Badge>}
                  </div>
                  {c.extended_warranty_months > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">+{c.extended_warranty_months} mois de garantie</p>
                  )}
                  {c.extended_warranty_description && (
                    <p className="text-xs text-muted-foreground">{c.extended_warranty_description}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(c)}><Edit className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer la carte"
        message="Cette carte sera supprimée définitivement."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
