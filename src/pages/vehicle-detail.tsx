import { useContext, useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Car, Edit, Trash2, FileText, Link2, Unlink, Plus, ShieldCheck, Wallet, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ErrorPanel } from "@/components/ui/error-panel"
import { I18nContext, type TranslationKeys } from "@/lib/i18n"
import { formatPrice, formatDate } from "@/lib/utils"
import { energyLabel, categoryLabel } from "@/lib/vehicle"
import { EnergyIcon } from "@/pages/vehicles"
import { VehicleExpenses } from "@/components/features/vehicle-expenses"
import * as api from "@/lib/tauri"

type Tab = "overview" | "contracts" | "expenses"

export function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()

  const [vehicle, setVehicle] = useState<api.Vehicle | null>(null)
  const [engagements, setEngagements] = useState<api.VehicleEngagementSummary[]>([])
  const [linkable, setLinkable] = useState<api.VehicleEngagementSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("overview")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [showLinkPicker, setShowLinkPicker] = useState(false)

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const [v, eng, link] = await Promise.all([
        api.getVehicle(id),
        api.getVehicleEngagements(id),
        api.getLinkableVehicleEngagements(),
      ])
      setVehicle(v)
      setEngagements(eng)
      setLinkable(link)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [id])

  const typeKey = (typ: api.EngagementType): keyof TranslationKeys =>
    `engagements.type.${typ}` as keyof TranslationKeys

  const link = async (engagementId: string) => {
    if (!vehicle) return
    try {
      await api.setEngagementVehicle(engagementId, vehicle.id)
      toast(fr ? "Contrat rattaché" : "Contract linked", "success")
      await load()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }
  const unlink = async (engagementId: string) => {
    try {
      await api.setEngagementVehicle(engagementId, null)
      toast(fr ? "Contrat détaché" : "Contract unlinked", "success")
      await load()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }

  const handleDelete = async () => {
    if (!vehicle) return
    try {
      await api.deleteVehicle(vehicle.id)
      toast(fr ? "Véhicule supprimé" : "Vehicle deleted", "success")
      navigate("/vehicules")
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }
  if (error || !vehicle) {
    return <ErrorPanel error={error ?? (fr ? "Véhicule introuvable" : "Vehicle not found")} onRetry={() => { void load() }} />
  }

  const v = vehicle

  // Sum of active recurring contracts as a rough monthly-ish indicator (kept
  // simple: we just total the current amounts of active linked engagements).
  const activeContracts = engagements.filter((e) => e.status === "active")

  const detail = (label: string, value: React.ReactNode) => (
    value ? (
      <div className="space-y-0.5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm font-medium">{value}</div>
      </div>
    ) : null
  )

  // Charging by default for electric/hybrid, fuel otherwise — the most common
  // first expense for each drivetrain.
  const defaultExpenseCategory: api.VehicleExpenseCategory =
    v.energy_type === "electric" || v.energy_type === "phev" || v.energy_type === "hybrid" ? "charging" : "fuel"

  const tabs: { key: Tab; label: string; icon: typeof Car }[] = [
    { key: "overview", label: fr ? "Aperçu" : "Overview", icon: Car },
    { key: "contracts", label: fr ? `Contrats (${engagements.length})` : `Contracts (${engagements.length})`, icon: FileText },
    { key: "expenses", label: fr ? "Dépenses" : "Expenses", icon: Receipt },
  ]

  return (
    <div className="space-y-6">
      <Link to="/vehicules" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />{fr ? "Véhicules" : "Vehicles"}
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="rounded-lg bg-primary/10 p-3 text-primary shrink-0"><Car className="h-6 w-6" /></span>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight truncate">{v.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {[v.make, v.model].filter(Boolean).length > 0 && (
                <span className="text-muted-foreground">{[v.make, v.model].filter(Boolean).join(" ")}</span>
              )}
              {v.plate && <Badge variant="secondary" className="font-mono">{v.plate}</Badge>}
              {v.energy_type && <Badge variant="outline" className="gap-1"><EnergyIcon type={v.energy_type} className="h-3 w-3" />{energyLabel(v.energy_type, fr)}</Badge>}
              {v.canton && <Badge variant="outline">{v.canton}</Badge>}
              {v.status !== "active" && <Badge variant="secondary">{v.status === "sold" ? (fr ? "Vendu" : "Sold") : (fr ? "Hors circulation" : "Scrapped")}</Badge>}
            </div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => navigate("/vehicules", { state: { edit: v.id } })}>
            <Edit className="h-4 w-4" />{fr ? "Modifier" : "Edit"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{fr ? "Identité" : "Identity"}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {detail(fr ? "Marque" : "Make", v.make)}
              {detail(fr ? "Modèle" : "Model", v.model)}
              {detail(fr ? "Genre" : "Category", categoryLabel(v.category, fr))}
              {detail(fr ? "Motorisation" : "Energy", v.energy_type ? energyLabel(v.energy_type, fr) : null)}
              {detail(fr ? "Plaque" : "Plate", v.plate)}
              {detail(fr ? "Canton" : "Canton", v.canton)}
              {detail("VIN", v.vin)}
              {detail(fr ? "N° matricule" : "Registration no.", v.registration_number)}
              {detail(fr ? "1re mise en circulation" : "First registration", v.first_registration ? formatDate(v.first_registration) : null)}
              {detail(fr ? "Puissance" : "Power", v.power_kw ? `${v.power_kw} kW` : null)}
              {detail(fr ? "Batterie" : "Battery", v.battery_kwh ? `${v.battery_kwh} kWh` : null)}
              {detail(fr ? "Couleur" : "Color", v.color)}
              {detail(fr ? "Km actuel" : "Odometer", v.odometer_km != null ? `${v.odometer_km.toLocaleString("fr-CH")} km` : null)}
              {detail(fr ? "Date d'achat" : "Purchase date", v.purchase_date ? formatDate(v.purchase_date) : null)}
              {detail(fr ? "Prix d'achat" : "Purchase price", v.purchase_price != null ? formatPrice(v.purchase_price) : null)}
            </CardContent>
          </Card>

          {v.notes && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">{fr ? "Notes" : "Notes"}</CardTitle></CardHeader>
              <CardContent><p className="whitespace-pre-wrap text-sm">{v.notes}</p></CardContent>
            </Card>
          )}

          <Card className="border-dashed">
            <CardContent className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
              <Wallet className="h-5 w-5 shrink-0" />
              <span>
                {fr
                  ? "Suivez toutes vos dépenses (recharge kWh, carburant, pneus, entretien…) dans l'onglet Dépenses. Bientôt : taxe automobile et documents du véhicule."
                  : "Track every expense (kWh charging, fuel, tires, maintenance…) in the Expenses tab. Coming soon: vehicle tax and documents."}
              </span>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "expenses" && (
        <VehicleExpenses vehicleId={v.id} defaultCategory={defaultExpenseCategory} />
      )}

      {tab === "contracts" && (
        <div className="space-y-4">
          {activeContracts.length > 0 && (
            <div className="text-sm text-muted-foreground">
              {fr ? "Contrats actifs rattachés : " : "Active linked contracts: "}
              <span className="font-medium text-foreground">{activeContracts.length}</span>
            </div>
          )}

          {engagements.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
                <ShieldCheck className="h-10 w-10 opacity-20" />
                <p>{fr ? "Aucun contrat rattaché (leasing, assurance, taxe…)." : "No contract linked yet (leasing, insurance, tax…)."}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {engagements.map((e) => (
                <Card key={e.id}>
                  <CardContent className="flex items-center justify-between gap-3 p-3">
                    <Link to={`/engagements/${e.id}`} className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate hover:underline">{e.name}</span>
                        <Badge variant="secondary">{t(typeKey(e.engagement_type))}</Badge>
                        {e.status !== "active" && <Badge variant="outline">{e.status}</Badge>}
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        {e.current_amount != null && <span>{formatPrice(e.current_amount, e.currency)}</span>}
                        {e.next_due_date && <span>· {fr ? "échéance" : "due"} {formatDate(e.next_due_date)}</span>}
                        {e.contract_end_date && <span>· {fr ? "fin" : "end"} {formatDate(e.contract_end_date)}</span>}
                      </div>
                    </Link>
                    <Button variant="ghost" size="sm" onClick={() => unlink(e.id)} title={fr ? "Détacher" : "Unlink"}>
                      <Unlink className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowLinkPicker((s) => !s)}>
              <Link2 className="h-4 w-4" />{fr ? "Rattacher un contrat existant" : "Link an existing contract"}
            </Button>
          </div>

          {showLinkPicker && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{fr ? "Contrats véhicule non rattachés" : "Unlinked vehicle contracts"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {linkable.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {fr
                      ? "Aucun contrat disponible. Créez un leasing ou une assurance depuis « Engagements », puis rattachez-le ici."
                      : "No contract available. Create a leasing or insurance from “Engagements”, then link it here."}
                  </p>
                ) : (
                  linkable.map((e) => {
                    const plateMatch = !!v.plate && !!e.vehicle_plate &&
                      e.vehicle_plate.replace(/\s+/g, "").toLowerCase() === v.plate.replace(/\s+/g, "").toLowerCase()
                    return (
                      <div key={e.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">{e.name}</span>
                            <Badge variant="secondary">{t(typeKey(e.engagement_type))}</Badge>
                            {plateMatch && <Badge variant="success">{fr ? "Même plaque" : "Same plate"}</Badge>}
                          </div>
                          {e.vehicle_plate && <div className="mt-0.5 text-xs text-muted-foreground font-mono">{e.vehicle_plate}</div>}
                        </div>
                        <Button size="sm" onClick={() => link(e.id)}>
                          <Plus className="h-4 w-4" />{fr ? "Rattacher" : "Link"}
                        </Button>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title={fr ? "Supprimer le véhicule" : "Delete vehicle"}
        message={fr ? "Le véhicule sera supprimé. Ses contrats sont conservés mais détachés." : "The vehicle will be deleted. Its contracts are kept but unlinked."}
        confirmLabel={fr ? "Supprimer" : "Delete"}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  )
}
