import { Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { emptyClaimDraft, type ClaimDraft } from "@/lib/health-claims"
import type * as api from "@/lib/tauri"

/// Benefit-statement lines being reviewed before they are saved — typed by
/// hand, or read from a statement (scanned now, or already filed in the
/// health documents). Nothing is written until "Ajouter".

const CLAIM_AMOUNTS: { key: keyof ClaimDraft; fr: string; en: string }[] = [
  { key: "invoiced", fr: "Montant facturé", en: "Invoiced" },
  { key: "insurer_paid", fr: "Pris en charge par la caisse", en: "Paid by insurer" },
  { key: "franchise", fr: "Dont franchise", en: "Of which deductible" },
  { key: "quote_part", fr: "Dont quote-part", en: "Of which co-payment" },
  { key: "hospital", fr: "Contribution hospitalière", en: "Hospital contribution" },
  { key: "not_covered", fr: "Non couvert", en: "Not covered" },
]

const fieldCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"

export function ClaimsReview({ fr, drafts, setDrafts, mode, setMode, saving, onAdd, onCancel, policies, policyId, setPolicyId }: {
  fr: boolean
  drafts: ClaimDraft[]
  setDrafts: (d: ClaimDraft[]) => void
  mode: api.HealthBillingMode | ""
  setMode: (m: api.HealthBillingMode | "") => void
  saving: boolean
  onAdd: () => void
  onCancel: () => void
  /// When the statement may concern several people: the basic policy to
  /// book it on.
  policies?: { id: string; label: string }[]
  policyId?: string
  setPolicyId?: (id: string) => void
}) {
  const setDraft = (i: number, patch: Partial<ClaimDraft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  return (
    <div className="space-y-3 rounded-md border p-3">
      {policies && setPolicyId && (
        <div className="space-y-1">
          <label className="text-xs font-medium">{fr ? "Personne (assurance de base)" : "Person (basic cover)"}</label>
          <select className={fieldCls} value={policyId ?? ""} onChange={(e) => setPolicyId(e.target.value)}>
            {policies.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
      )}
      <div className="space-y-1">
        <label className="text-xs font-medium">{fr ? "Qui a payé le prestataire ?" : "Who paid the provider?"}</label>
        <select className={fieldCls} value={mode} onChange={(e) => setMode(e.target.value as api.HealthBillingMode | "")}>
          <option value="">—</option>
          <option value="tiers_garant">{fr ? "Moi — la caisse me rembourse (tiers garant)" : "Me — the insurer reimburses (tiers garant)"}</option>
          <option value="tiers_payant">{fr ? "La caisse — elle me facture ma part (tiers payant)" : "The insurer — it bills my share (tiers payant)"}</option>
        </select>
        {mode === "tiers_garant" && (
          <p className="text-xs text-muted-foreground">{fr ? "Le montant pris en charge sera ajouté aux Remboursements en attente." : "The covered amount will be added to pending reimbursements."}</p>
        )}
      </div>
      {drafts.map((d, i) => (
        <div key={i} className="grid gap-2 rounded-md bg-muted/30 p-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium">{fr ? "Date du traitement" : "Treatment date"}</label>
            <Input type="date" value={d.treatment_date} onChange={(e) => setDraft(i, { treatment_date: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">{fr ? "Date du décompte" : "Statement date"}</label>
            <Input type="date" value={d.statement_date} onChange={(e) => setDraft(i, { statement_date: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-medium">{fr ? "Prestataire" : "Provider"}</label>
            <div className="flex gap-2">
              <Input value={d.provider} onChange={(e) => setDraft(i, { provider: e.target.value })} placeholder={fr ? "Médecin, pharmacie, hôpital…" : "Doctor, pharmacy…"} />
              {drafts.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              )}
            </div>
          </div>
          {CLAIM_AMOUNTS.map((a) => (
            <div key={a.key} className="space-y-1">
              <label className="text-xs font-medium">{fr ? a.fr : a.en}</label>
              <Input type="number" min="0" step="0.05" value={d[a.key]} onChange={(e) => setDraft(i, { [a.key]: e.target.value })} />
            </div>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onAdd} disabled={saving || drafts.length === 0 || (!!policies && !policyId)}>
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{fr ? `Ajouter ${drafts.length > 1 ? `${drafts.length} lignes` : ""}` : "Add"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDrafts([...drafts, emptyClaimDraft()])}>{fr ? "+ ligne" : "+ line"}</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>{fr ? "Annuler" : "Cancel"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {fr ? "Vérifiez chaque montant avec le décompte de la caisse avant d'ajouter." : "Check every amount against the statement."}
      </p>
    </div>
  )
}
