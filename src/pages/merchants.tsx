import { useEffect, useState } from "react"
import { Plus, Trash2, Edit, Store } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import * as api from "@/lib/tauri"

export function MerchantsPage() {
  const [merchants, setMerchants] = useState<api.Merchant[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<api.Merchant | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", contact_email: "", contact_phone: "", address: "" })
  const { toast } = useToast()

  const load = async () => {
    try { setMerchants(await api.getMerchants()) } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const resetForm = () => { setForm({ name: "", contact_email: "", contact_phone: "", address: "" }); setEditing(null); setShowForm(false) }

  const handleEdit = (m: api.Merchant) => {
    setForm({ name: m.name, contact_email: m.contact_email || "", contact_phone: m.contact_phone || "", address: m.address || "" })
    setEditing(m); setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editing) {
        await api.updateMerchant({ ...editing, name: form.name, contact_email: form.contact_email || null, contact_phone: form.contact_phone || null, address: form.address || null })
        toast("Marchand modifié", "success")
      } else {
        await api.createMerchant({ name: form.name, contact_email: form.contact_email || undefined, contact_phone: form.contact_phone || undefined, address: form.address || undefined })
        toast("Marchand ajouté", "success")
      }
      resetForm(); await load()
    } catch (e) { toast(`Erreur: ${e}`, "error") }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try { await api.deleteMerchant(deleteTarget); toast("Marchand supprimé", "success"); setDeleteTarget(null); await load() } catch (e) { toast(`Erreur: ${e}`, "error") }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-3xl font-bold tracking-tight">Marchands</h2><p className="text-muted-foreground">{merchants.length} marchand(s)</p></div>
        <Button onClick={() => { resetForm(); setShowForm(true) }}><Plus className="h-4 w-4" />Nouveau marchand</Button>
      </div>

      {showForm && (
        <Card><CardHeader><CardTitle className="text-lg">{editing ? "Modifier" : "Nouveau marchand"}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><label className="text-sm font-medium">Nom *</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus /></div>
              <div className="space-y-2"><label className="text-sm font-medium">Email</label><Input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
              <div className="space-y-2"><label className="text-sm font-medium">Téléphone</label><Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></div>
              <div className="space-y-2"><label className="text-sm font-medium">Adresse</label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="flex gap-2 sm:col-span-2"><Button type="submit">{editing ? "Modifier" : "Ajouter"}</Button><Button type="button" variant="outline" onClick={resetForm}>Annuler</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {merchants.length === 0 ? (
          <Card className="sm:col-span-2 lg:col-span-3"><CardContent className="flex flex-col items-center py-12 text-muted-foreground"><Store className="h-12 w-12 mb-4 opacity-20" /><p>Aucun marchand</p></CardContent></Card>
        ) : merchants.map((m) => (
          <Card key={m.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div><p className="font-medium">{m.name}</p>
                  {m.contact_email && <p className="text-xs text-muted-foreground">{m.contact_email}</p>}
                  {m.contact_phone && <p className="text-xs text-muted-foreground">{m.contact_phone}</p>}
                  {m.address && <p className="text-xs text-muted-foreground mt-1">{m.address}</p>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(m)}><Edit className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(m.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer le marchand"
        message="Ce marchand sera supprimé définitivement."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
