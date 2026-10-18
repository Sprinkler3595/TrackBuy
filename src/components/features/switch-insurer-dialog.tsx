import { useEffect, useState } from "react"
import { Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { InlineCreateSelect } from "@/components/ui/inline-create-select"
import { HEALTH_MODELS, healthModelLabel } from "@/lib/health"
import * as api from "@/lib/tauri"

type Toast = ReturnType<typeof useToast>["toast"]
const fieldCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
const numOrNull = (s: string): number | null => {
  const v = parseFloat(s)
  return s.trim() && !Number.isNaN(v) ? v : null
}

/// "Je change de caisse", carried to the end: the new insurer, its premium
/// and terms. The backend ends the old policy on 31 December, creates the new
/// one on 1 January and keeps the link that makes the affiliation confirmation
/// awaited.
export function SwitchInsurerDialog({ engagement, overview, year, fr, toast, onClose, onDone }: {
  engagement: api.Engagement; overview: api.HealthOverview; year: number; fr: boolean; toast: Toast
  onClose: () => void; onDone: (newId: string) => void
}) {
  const [creditors, setCreditors] = useState<api.Creditor[]>([])
  const [creditorId, setCreditorId] = useState("")
  const [policyNo, setPolicyNo] = useState("")
  const [premium, setPremium] = useState("")
  const [franchise, setFranchise] = useState(overview.notice_next_year?.franchise?.toString() ?? overview.policy?.franchise?.toString() ?? "")
  const [model, setModel] = useState<api.HealthModel>((overview.notice_next_year?.model ?? overview.policy?.model ?? "standard") as api.HealthModel)
  const [subsidy, setSubsidy] = useState(overview.notice_next_year?.subsidy_monthly?.toString() ?? overview.policy?.subsidy_monthly?.toString() ?? "")
  const [moveLca, setMoveLca] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { api.getCreditors().then((c) => setCreditors(c.filter((x) => x.id !== engagement.creditor_id))).catch(() => setCreditors([])) }, [engagement.creditor_id])

  async function createInsurer(name: string): Promise<api.Creditor | null> {
    try {
      const c = await api.createCreditor({ name, creditor_type: "insurer" })
      setCreditors((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
      return c
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
      return null
    }
  }

  const premiumValue = numOrNull(premium)
  async function submit() {
    if (premiumValue == null || premiumValue <= 0) return
    setSaving(true)
    try {
      const id = await api.switchHealthInsurer({
        engagement_id: engagement.id, year, creditor_id: creditorId || null, policy_number: policyNo.trim() || null,
        monthly_premium: premiumValue, franchise: numOrNull(franchise), model,
        accident_covered: overview.policy?.accident_covered ?? null, subsidy_monthly: numOrNull(subsidy),
        move_supplementary: moveLca,
      })
      toast(fr ? `Nouvelle police créée au 1.1.${year}. Pensez à envoyer la lettre à l'ancienne caisse.` : `New policy created for 1 Jan ${year}.`, "success")
      onDone(id)
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card shadow-lg">
        <div className="flex items-center justify-between border-b p-5">
          <h2 className="text-lg font-semibold">{fr ? `Nouvelle caisse au 1.1.${year}` : `New insurer on 1 Jan ${year}`}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-medium">{fr ? "Nouvelle caisse" : "New insurer"}</label>
            <InlineCreateSelect value={creditorId} onChange={setCreditorId} options={creditors} onCreate={createInsurer}
              placeholder={fr ? "Nom (ex : Helsana)" : "Name"} createTitle={fr ? "Nouvelle caisse" : "New insurer"} fr={fr} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">{fr ? "Prime mensuelle (CHF)" : "Monthly premium (CHF)"} *</label>
            <Input type="number" min="0" step="0.05" value={premium} onChange={(e) => setPremium(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">{fr ? "N° de police (si connu)" : "Policy no. (if known)"}</label>
            <Input value={policyNo} onChange={(e) => setPolicyNo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Franchise</label>
            <select className={fieldCls} value={franchise} onChange={(e) => setFranchise(e.target.value)}>
              {overview.allowed_franchises.map((f) => <option key={f} value={f}>{f.toLocaleString("fr-CH")}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">{fr ? "Modèle" : "Model"}</label>
            <select className={fieldCls} value={model} onChange={(e) => setModel(e.target.value as api.HealthModel)}>
              {HEALTH_MODELS.map((m) => <option key={m} value={m}>{healthModelLabel(m, fr)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">{fr ? "Subside (CHF/mois)" : "Subsidy (CHF/month)"}</label>
            <Input type="number" min="0" step="0.05" value={subsidy} onChange={(e) => setSubsidy(e.target.value)} />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={moveLca} onChange={(e) => setMoveLca(e.target.checked)} />
            {fr ? "Rattacher les complémentaires à la nouvelle police" : "Attach supplementary covers to the new policy"}
          </label>
          <p className="sm:col-span-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {fr
              ? `L'ancienne police s'arrête au 31.12.${year - 1}. Inscrivez-vous chez la nouvelle caisse : sa confirmation d'affiliation sera réclamée dans la nouvelle fiche jusqu'à réception. Les complémentaires ne sont pas résiliées par ce geste.`
              : `The old policy stops on 31 Dec ${year - 1}. Supplementary covers are not cancelled by this.`}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="ghost" onClick={onClose} disabled={saving}>{fr ? "Annuler" : "Cancel"}</Button>
          <Button onClick={submit} disabled={saving || premiumValue == null || premiumValue <= 0}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{fr ? "Créer la nouvelle police" : "Create new policy"}
          </Button>
        </div>
      </div>
    </div>
  )
}
