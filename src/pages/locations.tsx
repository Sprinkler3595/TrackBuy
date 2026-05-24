import { useEffect, useState } from "react"
import { Plus, Trash2, Edit, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import * as api from "@/lib/tauri"

export function LocationsPage() {
  const [locations, setLocations] = useState<api.Location[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<api.Location | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", icon: "home" })
  const { toast } = useToast()

  const load = async () => {
    try { setLocations(await api.getLocations()) } catch (e) { console.error(e) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const resetForm = () => { setForm({ name: "", icon: "home" }); setEditing(null); setShowForm(false) }

  const handleEdit = (l: api.Location) => { setForm({ name: l.name, icon: l.icon }); setEditing(l); setShowForm(true) }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editing) { await api.updateLocation({ ...editing, name: form.name, icon: form.icon }); toast("Lieu modifié", "success") }
      else { await api.createLocation({ name: form.name, icon: form.icon }); toast("Lieu ajouté", "success") }
      resetForm(); await load()
    } catch (e) { toast(`Erreur: ${e}`, "error") }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try { await api.deleteLocation(deleteTarget); toast("Lieu supprimé", "success"); setDeleteTarget(null); await load() } catch (e) { toast(`Erreur: ${e}`, "error") }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-3xl font-bold tracking-tight">Lieux</h2><p className="text-muted-foreground">{locations.length} lieu(x)</p></div>
        <Button onClick={() => { resetForm(); setShowForm(true) }}><Plus className="h-4 w-4" />Nouveau lieu</Button>
      </div>

      {showForm && (
        <Card><CardHeader><CardTitle className="text-lg">{editing ? "Modifier" : "Nouveau lieu"}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex gap-4 items-end">
              <div className="flex-1 space-y-2"><label className="text-sm font-medium">Nom *</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus /></div>
              <Button type="submit">{editing ? "Modifier" : "Ajouter"}</Button>
              <Button type="button" variant="outline" onClick={resetForm}>Annuler</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {locations.length === 0 ? (
          <Card className="sm:col-span-2 lg:col-span-3"><CardContent className="flex flex-col items-center py-12 text-muted-foreground"><MapPin className="h-12 w-12 mb-4 opacity-20" /><p>Aucun lieu</p></CardContent></Card>
        ) : locations.map((l) => (
          <Card key={l.id} className="hover:shadow-md transition-shadow">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <MapPin className="h-5 w-5 text-muted-foreground" />
                <p className="font-medium">{l.name}</p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => handleEdit(l)}><Edit className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(l.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer le lieu"
        message="Ce lieu sera supprimé définitivement."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
