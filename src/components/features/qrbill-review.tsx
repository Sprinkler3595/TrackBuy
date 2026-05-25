import { useEffect, useState } from "react"
import { Link2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatPrice } from "@/lib/utils"
import { useToast } from "@/components/ui/toast"
import * as api from "@/lib/tauri"

/// Modal that opens after the user has decoded a QR-bill payload elsewhere.
/// Picks up the decoded payload from sessionStorage (set by the inbox), so
/// it can be re-used from any page without prop-drilling.
export function QrBillReview() {
  const { toast } = useToast()
  const [decoded, setDecoded] = useState<api.QrBillDecoded | null>(null)
  const [creditors, setCreditors] = useState<api.Creditor[]>([])
  const [engagements, setEngagements] = useState<api.Engagement[]>([])
  const [selectedEngagement, setSelectedEngagement] = useState<string>("")
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    function pick() {
      const raw = sessionStorage.getItem("qrbill-pending")
      if (!raw) return
      sessionStorage.removeItem("qrbill-pending")
      try {
        const d = JSON.parse(raw) as api.QrBillDecoded
        setDecoded(d)
        setSelectedEngagement(d.suggested_engagement_id ?? "")
        Promise.all([api.getCreditors(), api.getEngagements({ status: "active" })])
          .then(([c, e]) => {
            setCreditors(c)
            setEngagements(e)
          })
          .catch(() => undefined)
      } catch {
        // ignore parsing errors
      }
    }
    pick()
    window.addEventListener("qrbill-decoded", pick)
    return () => window.removeEventListener("qrbill-decoded", pick)
  }, [])

  if (!decoded) return null

  const matchedEngagement = engagements.find((e) => e.id === selectedEngagement)
  const matchedCreditor = creditors.find((c) => c.id === decoded.suggested_creditor_id)

  async function linkToEngagement() {
    if (!decoded || !selectedEngagement) return
    setCreating(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      await api.addEngagementCharge({
        engagement_id: selectedEngagement,
        due_date: today,
        amount: decoded.amount ?? 0,
        currency: decoded.currency,
        status: "scheduled",
        reference_number: decoded.reference,
        notes: decoded.unstructured_message || null,
      })
      toast("Facture ajoutée à l'engagement", "success")
      setDecoded(null)
    } catch (e) {
      toast(String(e), "error")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">QR-facture décodée</h2>
          <Button variant="ghost" size="sm" onClick={() => setDecoded(null)}>
            ✕
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-3 p-4 text-sm">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Bénéficiaire</div>
                <div className="font-medium">{decoded.creditor.name}</div>
                <div className="text-xs text-muted-foreground">
                  {decoded.creditor.postal_code} {decoded.creditor.city},{" "}
                  {decoded.creditor.country}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">IBAN</div>
                <div className="font-mono text-xs">{decoded.iban}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Montant</div>
                <div className="text-lg font-semibold tabular-nums">
                  {decoded.amount != null
                    ? formatPrice(decoded.amount, decoded.currency)
                    : "—"}
                </div>
              </div>
              {decoded.reference && (
                <div>
                  <div className="text-xs uppercase text-muted-foreground">
                    Référence ({decoded.reference_type})
                  </div>
                  <div className="break-all font-mono text-xs">{decoded.reference}</div>
                </div>
              )}
              {decoded.unstructured_message && (
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Communication</div>
                  <div className="text-xs">{decoded.unstructured_message}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-3">
            <div className="rounded-lg border p-3 text-sm">
              <div className="mb-2 flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                <span className="font-medium">Rapprochement</span>
              </div>
              {matchedCreditor ? (
                <p className="text-xs text-muted-foreground">
                  Créancier reconnu : <strong>{matchedCreditor.name}</strong>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Aucun créancier connu pour cet IBAN. Vous pouvez le créer depuis
                  Réglages → Créanciers.
                </p>
              )}

              <label className="mt-3 block text-xs font-medium">Engagement</label>
              <select
                className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                value={selectedEngagement}
                onChange={(e) => setSelectedEngagement(e.target.value)}
              >
                <option value="">— Sélectionner un engagement —</option>
                {engagements
                  .filter((e) => !matchedCreditor || e.creditor_id === matchedCreditor.id)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                <option disabled>──────────</option>
                {engagements
                  .filter((e) => matchedCreditor && e.creditor_id !== matchedCreditor.id)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
              {matchedEngagement && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Sera ajoutée comme charge programmée à{" "}
                  <strong>{matchedEngagement.name}</strong>.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Button
                onClick={linkToEngagement}
                disabled={!selectedEngagement || creating}
                className="w-full"
              >
                <Link2 className="mr-2 h-4 w-4" />
                Lier à l'engagement
              </Button>
              <a
                href="/engagements"
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                <Plus className="h-4 w-4" />
                Créer un nouvel engagement
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
