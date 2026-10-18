import { formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// Benefit-statement lines as typed or read, before they become claims.

const today = () => new Date().toISOString().slice(0, 10)

export type ClaimDraft = {
  treatment_date: string; statement_date: string; provider: string; invoiced: string; insurer_paid: string
  franchise: string; quote_part: string; hospital: string; not_covered: string
}

export const emptyClaimDraft = (): ClaimDraft => ({
  treatment_date: "", statement_date: today(), provider: "", invoiced: "", insurer_paid: "",
  franchise: "", quote_part: "", hospital: "", not_covered: "",
})

export function draftsFromExtraction(x: api.ExtractedHealthClaims): ClaimDraft[] {
  const str = (v: number) => (v > 0 ? String(v) : "")
  return x.lines.map((l) => ({
    treatment_date: l.treatment_date ?? "", statement_date: x.statement_date ?? today(), provider: l.provider ?? "",
    invoiced: str(l.invoiced), insurer_paid: str(l.insurer_paid), franchise: str(l.franchise),
    quote_part: str(l.quote_part), hospital: str(l.hospital), not_covered: str(l.not_covered),
  }))
}

/// Saves the lines on one basic policy, for the year of each statement (the
/// deductible is yearly: a December treatment stated in January still counts
/// for the year it was given). Returns the toast to show.
export async function saveClaimDrafts(engagementId: string, fallbackYear: number, drafts: ClaimDraft[], mode: api.HealthBillingMode | "", fr: boolean): Promise<string> {
  const n = (v: string) => {
    const x = parseFloat(v)
    return v.trim() && !Number.isNaN(x) ? x : 0
  }
  const yearOf = (d: ClaimDraft) => Number((d.treatment_date || d.statement_date).slice(0, 4)) || fallbackYear
  const saved = await api.addHealthClaims(drafts.map((d) => ({
    engagement_id: engagementId, year: yearOf(d),
    statement_date: d.statement_date || null, treatment_date: d.treatment_date || null,
    provider: d.provider.trim() || null,
    invoiced: n(d.invoiced), insurer_paid: n(d.insurer_paid), franchise: n(d.franchise),
    quote_part: n(d.quote_part), hospital: n(d.hospital), not_covered: n(d.not_covered), notes: null,
    billing_mode: mode || null,
  })))
  const refunds = saved.filter((c) => c.reimbursement_id)
  const due = refunds.reduce((sum, c) => sum + c.insurer_paid, 0)
  return refunds.length > 0
    ? (fr ? `${saved.length} ligne(s) ajoutée(s). Remboursement attendu de ${formatPrice(due)} ajouté aux Remboursements.` : `${saved.length} line(s) added; ${formatPrice(due)} reimbursement expected.`)
    : (fr ? `${saved.length} ligne(s) ajoutée(s).` : `${saved.length} line(s) added.`)
}

