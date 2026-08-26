import { useContext, useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { Plus, Car, Trash2, Edit, Search, Zap, Fuel, BatteryCharging } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { I18nContext } from "@/lib/i18n"
import { AiScanPanel } from "@/components/features/ai-scan-panel"
import { getAiSettings } from "@/lib/ai-settings"
import { VEHICLE_CATEGORIES as CATEGORIES, VEHICLE_ENERGY_TYPES as ENERGY_TYPES, CANTONS, energyLabel, isElectric } from "@/lib/vehicle"
import * as api from "@/lib/tauri"

/// Energy-type icon as a component (selecting by reference, not by calling a
/// factory during render — keeps the linter happy and state stable).
export function EnergyIcon({ type, className }: { type: api.VehicleEnergyType | null; className?: string }) {
  const Icon = type === "electric" ? Zap : (type === "phev" || type === "hybrid") ? BatteryCharging : Fuel
  return <Icon className={className} />
}

type FormState = {
  name: string
  make: string
  model: string
  plate: string
  vin: string
  registration_number: string
  category: api.VehicleCategory | ""
  energy_type: api.VehicleEnergyType | ""
  first_registration: string
  canton: string
  color: string
  power_kw: string
  battery_kwh: string
  purchase_date: string
  purchase_price: string
  odometer_km: string
  notes: string
}

const emptyForm = (): FormState => ({
  name: "", make: "", model: "", plate: "", vin: "", registration_number: "",
  category: "passenger_car", energy_type: "", first_registration: "", canton: "",
  color: "", power_kw: "", battery_kwh: "", purchase_date: "", purchase_price: "",
  odometer_km: "", notes: "",
})

const numOrNull = (s: string): number | null => (s.trim() ? parseFloat(s) : null)
const intOrNull = (s: string): number | null => (s.trim() ? parseInt(s, 10) : null)

export function VehiclesPage() {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()

  const [vehicles, setVehicles] = useState<api.Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<api.Vehicle | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const location = useLocation()

  const load = async () => {
    try {
      setVehicles(await api.getVehicles())
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const resetForm = () => { setForm(emptyForm()); setEditing(null); setShowForm(false) }

  const openEdit = (v: api.Vehicle) => {
    setForm({
      name: v.name, make: v.make ?? "", model: v.model ?? "", plate: v.plate ?? "",
      vin: v.vin ?? "", registration_number: v.registration_number ?? "",
      category: v.category ?? "", energy_type: v.energy_type ?? "",
      first_registration: v.first_registration ?? "", canton: v.canton ?? "",
      color: v.color ?? "", power_kw: v.power_kw?.toString() ?? "",
      battery_kwh: v.battery_kwh?.toString() ?? "", purchase_date: v.purchase_date ?? "",
      purchase_price: v.purchase_price?.toString() ?? "", odometer_km: v.odometer_km?.toString() ?? "",
      notes: v.notes ?? "",
    })
    setEditing(v)
    setShowForm(true)
  }

  // Deep-link from the vehicle fiche's "Modifier" button: open the editor for
  // the requested vehicle once the list is loaded.
  useEffect(() => {
    const editId = (location.state as { edit?: string } | null)?.edit
    if (!editId || vehicles.length === 0) return
    const v = vehicles.find((x) => x.id === editId)
    if (v) openEdit(v)
    // Clear the state so re-renders don't reopen it.
    window.history.replaceState({}, "")
  }, [location.state, vehicles])

  // Pre-fill the form from a scanned registration document (permis de
  // circulation), read by the AI. Returns a summary of the filled fields.
  const applyVehicleExtraction = (x: api.ExtractedVehicle): string => {
    const filled: string[] = []
    const patch: Partial<FormState> = {}
    const composed = x.name || ([x.make, x.model].filter(Boolean).join(" ") + (x.plate ? ` ${x.plate}` : "")).trim()
    if (composed) { patch.name = composed; filled.push(fr ? "désignation" : "label") }
    if (x.make) { patch.make = x.make; filled.push(fr ? "marque" : "make") }
    if (x.model) { patch.model = x.model; filled.push(fr ? "modèle" : "model") }
    if (x.plate) { patch.plate = x.plate; filled.push(fr ? "plaque" : "plate") }
    if (x.vin) { patch.vin = x.vin; filled.push("VIN") }
    if (x.registration_number) { patch.registration_number = x.registration_number; filled.push(fr ? "matricule" : "reg. no.") }
    if (x.category) { patch.category = x.category; filled.push(fr ? "genre" : "category") }
    if (x.energy_type) { patch.energy_type = x.energy_type; filled.push(fr ? "motorisation" : "energy") }
    if (x.first_registration) { patch.first_registration = x.first_registration; filled.push(fr ? "1re immat." : "first reg.") }
    if (x.power_kw != null) { patch.power_kw = String(x.power_kw); filled.push(fr ? "puissance" : "power") }
    if (x.color) { patch.color = x.color; filled.push(fr ? "couleur" : "color") }
    if (x.canton) { patch.canton = x.canton; filled.push(fr ? "canton" : "canton") }
    setForm((f) => ({ ...f, ...patch }))
    return filled.join(" · ")
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!form.name.trim()) return
    const payload = {
      name: form.name.trim(),
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      plate: form.plate.trim() || null,
      vin: form.vin.trim() || null,
      registration_number: form.registration_number.trim() || null,
      category: form.category || null,
      energy_type: form.energy_type || null,
      first_registration: form.first_registration || null,
      canton: form.canton || null,
      color: form.color.trim() || null,
      power_kw: numOrNull(form.power_kw),
      battery_kwh: numOrNull(form.battery_kwh),
      purchase_date: form.purchase_date || null,
      purchase_price: numOrNull(form.purchase_price),
      odometer_km: intOrNull(form.odometer_km),
      notes: form.notes.trim() || null,
    }
    try {
      if (editing) {
        await api.updateVehicle({ ...editing, ...payload })
        toast(fr ? "Véhicule mis à jour" : "Vehicle updated", "success")
      } else {
        await api.createVehicle(payload)
        toast(fr ? "Véhicule créé" : "Vehicle created", "success")
      }
      resetForm()
      await load()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteVehicle(deleteTarget)
      toast(fr ? "Véhicule supprimé" : "Vehicle deleted", "success")
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }

  const filtered = vehicles.filter((v) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [v.name, v.make, v.model, v.plate, v.vin].some((f) => (f ?? "").toLowerCase().includes(q))
  })

  const fieldCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{fr ? "Véhicules" : "Vehicles"}</h2>
          <p className="text-muted-foreground">
            {vehicles.length} · {fr ? "leasing, assurance, taxe et dépenses réunis" : "leasing, insurance, tax and expenses in one place"}
          </p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true) }}>
          <Plus className="h-4 w-4" />{fr ? "Nouveau véhicule" : "New vehicle"}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={fr ? "Rechercher" : "Search"} className="pl-8 w-64" />
        </div>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{editing ? (fr ? "Modifier le véhicule" : "Edit vehicle") : (fr ? "Nouveau véhicule" : "New vehicle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-3">
                <AiScanPanel
                  fr={fr}
                  title={fr ? "Remplir depuis le permis de circulation (scan + IA)" : "Fill from the registration document (scan + AI)"}
                  subtitle={fr
                    ? "Scannez la carte grise / permis de circulation : l'IA remplit l'identité du véhicule."
                    : "Scan the registration document: the AI fills the vehicle identity."}
                  onExtract={async (text) => applyVehicleExtraction(await api.aiExtractVehicle(text, getAiSettings()))}
                />
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <label className="text-sm font-medium">{fr ? "Désignation" : "Label"} *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus placeholder={fr ? "Ex : VW Golf VD 123456" : "e.g. VW Golf VD 123456"} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Marque" : "Make"}</label>
                <Input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} placeholder={fr ? "Volkswagen" : "Volkswagen"} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Modèle" : "Model"}</label>
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="Golf" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Genre" : "Category"}</label>
                <select className={fieldCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as api.VehicleCategory | "" })}>
                  <option value="">—</option>
                  {CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{fr ? c.fr : c.en}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Motorisation" : "Energy"}</label>
                <select className={fieldCls} value={form.energy_type} onChange={(e) => setForm({ ...form, energy_type: e.target.value as api.VehicleEnergyType | "" })}>
                  <option value="">—</option>
                  {ENERGY_TYPES.map((c) => <option key={c.slug} value={c.slug}>{fr ? c.fr : c.en}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Plaque" : "Plate"}</label>
                <Input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} placeholder="VD 123456" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Canton" : "Canton"}</label>
                <select className={fieldCls} value={form.canton} onChange={(e) => setForm({ ...form, canton: e.target.value })}>
                  <option value="">—</option>
                  {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "N° de châssis (VIN)" : "VIN"}</label>
                <Input value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "N° de matricule" : "Registration no."}</label>
                <Input value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "1re mise en circulation" : "First registration"}</label>
                <Input type="date" value={form.first_registration} onChange={(e) => setForm({ ...form, first_registration: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Puissance (kW)" : "Power (kW)"}</label>
                <Input type="number" step="0.1" min="0" value={form.power_kw} onChange={(e) => setForm({ ...form, power_kw: e.target.value })} />
              </div>
              {isElectric(form.energy_type || null) && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{fr ? "Batterie (kWh)" : "Battery (kWh)"}</label>
                  <Input type="number" step="0.1" min="0" value={form.battery_kwh} onChange={(e) => setForm({ ...form, battery_kwh: e.target.value })} />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Couleur" : "Color"}</label>
                <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Km actuel" : "Odometer (km)"}</label>
                <Input type="number" min="0" value={form.odometer_km} onChange={(e) => setForm({ ...form, odometer_km: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Date d'achat" : "Purchase date"}</label>
                <Input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Prix d'achat (CHF)" : "Purchase price (CHF)"}</label>
                <Input type="number" step="0.01" min="0" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <label className="text-sm font-medium">{fr ? "Notes" : "Notes"}</label>
                <textarea className="w-full min-h-[70px] rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit">{editing ? (fr ? "Enregistrer" : "Save") : (fr ? "Créer" : "Create")}</Button>
                <Button type="button" variant="outline" onClick={resetForm}>{fr ? "Annuler" : "Cancel"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 ? (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
              <Car className="h-12 w-12 mb-4 opacity-20" />
              <p>{fr ? "Aucun véhicule. Créez-en un pour regrouper leasing, assurance, taxe et dépenses." : "No vehicle yet. Create one to group leasing, insurance, tax and expenses."}</p>
            </CardContent>
          </Card>
        ) : filtered.map((v) => {
          return (
            <Card key={v.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/vehicules/${v.id}`} className="flex items-start gap-3 min-w-0 flex-1">
                    <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0"><Car className="h-5 w-5" /></span>
                    <span className="min-w-0">
                      <span className="block font-medium truncate hover:underline">{v.name}</span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {[v.make, v.model].filter(Boolean).join(" ") || "—"}
                      </span>
                    </span>
                  </Link>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(v)}><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(v.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {v.plate && <Badge variant="secondary" className="font-mono">{v.plate}</Badge>}
                  {v.energy_type && <Badge variant="outline" className="gap-1"><EnergyIcon type={v.energy_type} className="h-3 w-3" />{energyLabel(v.energy_type, fr)}</Badge>}
                  {v.canton && <Badge variant="outline">{v.canton}</Badge>}
                  {v.status !== "active" && <Badge variant="secondary">{v.status === "sold" ? (fr ? "Vendu" : "Sold") : (fr ? "Hors circulation" : "Scrapped")}</Badge>}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={fr ? "Supprimer le véhicule" : "Delete vehicle"}
        message={fr ? "Le véhicule sera supprimé. Ses contrats (leasing, assurance…) sont conservés mais détachés." : "The vehicle will be deleted. Its contracts (leasing, insurance…) are kept but unlinked."}
        confirmLabel={fr ? "Supprimer" : "Delete"}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
