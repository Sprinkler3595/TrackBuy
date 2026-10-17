import { useContext, useEffect, useRef, useState } from "react"
import { Check, Loader2, Mail, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { I18nContext } from "@/lib/i18n"
import { getAiSettings } from "@/lib/ai-settings"
import { documentToText } from "@/lib/document-scan"
import { formatPrice, cn } from "@/lib/utils"
import { decisionLabel } from "@/lib/health"
import * as api from "@/lib/tauri"

/// The autumn premium notice, entered for the whole household at once.
///
/// The insurer sends ONE letter for the family: every person, base and
/// supplementary covers, sometimes the new subsidy. Opening one tab per
/// policy to copy it out was the slowest part of the season — this screen
/// lists every active policy as a row, and the letter can be scanned to fill
/// them. Matching an extracted person to a row is done here, by first name,
/// and shown, never silently guessed: an unmatched person is listed.

const BASIC_DECISIONS: api.HealthDecision[] = ["pending", "keep", "change_franchise", "change_model", "switch_insurer"]
const LCA_DECISIONS: api.HealthDecision[] = ["pending", "keep", "switch_insurer"]

type Row = {
  premium: string
  franchise: string
  subsidy: string
  decision: api.HealthDecision
}

const numOrNull = (s: string): number | null => {
  const v = parseFloat(s)
  return s.trim() && !Number.isNaN(v) ? v : null
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()

/// Does the extracted name designate this insured person? First names are
/// what households share least, so a match on the first word is enough.
function samePerson(extracted: string, label: string | null): boolean {
  if (!label) return false
  const a = norm(extracted)
  const first = norm(label).split(/\s+/)[0]
  return first.length > 1 && (a.split(/\s+/).includes(first) || a.startsWith(first))
}

export function HealthNoticesModal({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()
  const [season, setSeason] = useState<api.HealthSeason | null>(null)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanReport, setScanReport] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.getHealthSeason().then((s) => {
      setSeason(s)
      const init: Record<string, Row> = {}
      for (const p of s.policies) {
        init[p.engagement_id] = {
          premium: p.notice?.monthly_premium?.toString() ?? "",
          franchise: (p.notice?.franchise ?? p.franchise)?.toString() ?? "",
          subsidy: (p.notice?.subsidy_monthly ?? p.subsidy_monthly)?.toString() ?? "",
          decision: p.notice?.decision ?? "pending",
        }
        if (p.notice?.received_on) setReceivedOn(p.notice.received_on)
      }
      setRows(init)
    }).catch((e) => toast(String(e), "error"))
  }, [toast])

  if (!season) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <Loader2 className="h-6 w-6 animate-spin text-white" />
      </div>
    )
  }

  const next = season.season_year + 1
  const set = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }))
  const isLca = (p: api.HealthSeasonPolicy) => p.kind === "supplementary" || (p.kind == null && !!p.parent_engagement_id)

  async function scan(file: File) {
    const ai = getAiSettings()
    if (!ai.enabled) {
      toast(fr ? "Activez l'IA dans Réglages → IA pour lire la lettre." : "Enable AI in Settings → AI.", "error")
      return
    }
    if (!season) return
    setScanning(true)
    setScanReport(null)
    try {
      const text = await documentToText(new Uint8Array(await file.arrayBuffer()), file.type, file.name)
      if (!text.trim()) throw new Error(fr ? "texte introuvable dans le document" : "no text found")
      const x = await api.aiExtractPremiumNotice(text, ai)
      const matched: string[] = []
      const unmatched: string[] = []
      for (const person of x.persons) {
        const name = person.insured_name ?? ""
        const basic = season.policies.find((p) => !isLca(p) && samePerson(name, p.insured_label))
        const lca = season.policies.find((p) => isLca(p) && (samePerson(name, p.insured_label) || (basic && p.parent_engagement_id === basic.engagement_id)))
        if (!basic && !lca) { unmatched.push(name || "?"); continue }
        if (basic) {
          set(basic.engagement_id, {
            ...(person.basic_monthly_premium != null ? { premium: String(person.basic_monthly_premium) } : {}),
            ...(person.franchise != null ? { franchise: String(person.franchise) } : {}),
            ...(person.subsidy_monthly != null ? { subsidy: String(person.subsidy_monthly) } : {}),
          })
        }
        if (lca && person.supplementary_monthly_premium != null) {
          set(lca.engagement_id, { premium: String(person.supplementary_monthly_premium) })
        }
        matched.push(basic?.insured_label ?? lca?.insured_label ?? name)
      }
      if (x.year != null && x.year !== next) {
        toast(fr ? `Attention : la lettre porte sur ${x.year}, pas ${next}.` : `Warning: the letter is for ${x.year}, not ${next}.`, "error")
      }
      setScanReport(
        (matched.length ? `${fr ? "Rempli" : "Filled"} : ${matched.join(", ")}` : "") +
        (unmatched.length ? ` · ${fr ? "non reconnu" : "not matched"} : ${unmatched.join(", ")}` : ""),
      )
    } catch (e) {
      toast(`${fr ? "Échec du scan" : "Scan failed"}: ${e}`, "error")
    } finally {
      setScanning(false)
    }
  }

  async function save() {
    if (!season) return
    setSaving(true)
    let count = 0
    try {
      for (const p of season.policies) {
        const r = rows[p.engagement_id]
        if (!r) continue
        const premium = numOrNull(r.premium)
        // Nothing typed, nothing decided: no notice to record for this row.
        if (premium == null && r.decision === "pending" && !p.notice) continue
        await api.saveHealthPremiumNotice({
          engagement_id: p.engagement_id,
          year: next,
          monthly_premium: premium,
          franchise: isLca(p) ? null : numOrNull(r.franchise),
          model: isLca(p) ? null : (p.notice?.model ?? p.model),
          accident_covered: p.notice?.accident_covered ?? null,
          received_on: receivedOn || null,
          decision: r.decision,
          notes: p.notice?.notes ?? null,
          subsidy_monthly: isLca(p) ? null : numOrNull(r.subsidy),
        })
        count += 1
      }
      toast(fr ? `${count} avis enregistré(s). Les échéances suivront au 1.1.${next}.` : `${count} notice(s) saved.`, "success")
      onSaved?.()
      onClose()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const avg = season.params.ofsp_average_change_pct
  const fieldCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><Mail className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-semibold">{fr ? `Avis de prime ${next} — toute la famille` : `${next} premium notices — whole household`}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {fr ? "Une ligne par police. Recopiez la lettre de la caisse, ou scannez-la." : "One row per policy. Copy the insurer's letter, or scan it."}
                {avg != null && <> {fr ? "Hausse moyenne OFSP" : "FOPH average"} : {avg >= 0 ? "+" : ""}{avg.toFixed(1)} %.</>}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={fr ? "Fermer" : "Close"}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="flex flex-wrap items-end gap-3">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void scan(f); e.target.value = "" }} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={scanning}>
              {scanning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
              {fr ? "Scanner la lettre" : "Scan the letter"}
            </Button>
            <div className="space-y-1">
              <label className="text-xs font-medium">{fr ? "Lettre reçue le" : "Letter received on"}</label>
              <Input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className="h-9" />
            </div>
            {scanReport && (
              <p className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400"><Check className="h-4 w-4" />{scanReport}</p>
            )}
          </div>

          {season.policies.length === 0 ? (
            <p className="text-sm text-muted-foreground">{fr ? "Aucune assurance maladie active." : "No active health insurance."}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 text-left font-normal">{fr ? "Personne · police" : "Person · policy"}</th>
                  <th className="py-2 text-right font-normal">{fr ? `Prime ${season.season_year}` : `${season.season_year} premium`}</th>
                  <th className="py-2 pl-3 text-left font-normal">{fr ? `Prime ${next} /mois` : `${next} premium /mo`}</th>
                  <th className="py-2 pl-3 text-left font-normal">Franchise</th>
                  <th className="py-2 pl-3 text-left font-normal">{fr ? "Subside /mois" : "Subsidy /mo"}</th>
                  <th className="py-2 pl-3 text-left font-normal">{fr ? "Décision" : "Decision"}</th>
                </tr>
              </thead>
              <tbody>
                {season.policies.map((p) => {
                  const r = rows[p.engagement_id]
                  if (!r) return null
                  const lca = isLca(p)
                  const premium = numOrNull(r.premium)
                  const change = premium != null && p.monthly_gross ? (premium - p.monthly_gross) / p.monthly_gross * 100 : null
                  return (
                    <tr key={p.engagement_id} className="border-b align-top">
                      <td className="py-2 pr-2">
                        <p className="font-medium">{p.insured_label ?? p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          <Badge variant="secondary" className="mr-1">{lca ? "LCA" : "LAMal"}</Badge>
                          {p.creditor_name ?? "—"}
                        </p>
                      </td>
                      <td className="py-2 text-right text-muted-foreground">{p.monthly_gross != null ? formatPrice(p.monthly_gross) : "—"}</td>
                      <td className="py-2 pl-3">
                        <Input type="number" min="0" step="0.05" className="h-9 w-28" value={r.premium}
                          onChange={(e) => set(p.engagement_id, { premium: e.target.value })} />
                        {change != null && (
                          <p className={cn("mt-1 text-xs", avg != null && change > avg + 1 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                            {change >= 0 ? "+" : ""}{change.toFixed(1)} %
                          </p>
                        )}
                      </td>
                      <td className="py-2 pl-3">
                        {lca ? <span className="text-muted-foreground">—</span> : (
                          <select className={cn(fieldCls, "w-28")} value={r.franchise} onChange={(e) => set(p.engagement_id, { franchise: e.target.value })}>
                            <option value="">—</option>
                            {p.next_year_franchises.map((f) => <option key={f} value={f}>{f.toLocaleString("fr-CH")}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="py-2 pl-3">
                        {lca ? <span className="text-muted-foreground">—</span> : (
                          <Input type="number" min="0" step="0.05" className="h-9 w-24" value={r.subsidy}
                            onChange={(e) => set(p.engagement_id, { subsidy: e.target.value })} />
                        )}
                      </td>
                      <td className="py-2 pl-3">
                        <select className={cn(fieldCls, "w-44")} value={r.decision} onChange={(e) => set(p.engagement_id, { decision: e.target.value as api.HealthDecision })}>
                          {(lca ? LCA_DECISIONS : BASIC_DECISIONS).map((d) => (
                            <option key={d} value={d}>{lca && d === "switch_insurer" ? (fr ? "Je résilie" : "I cancel") : decisionLabel(d, fr)}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted-foreground">
            {fr
              ? "« Je change de caisse » se termine dans l'onglet Santé de la personne : c'est là que la nouvelle police est créée et la lettre préparée."
              : "\"Switch insurer\" is completed in the person's Health tab, where the new policy is created and the letter drafted."}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t p-4">
          <Button variant="ghost" onClick={onClose} disabled={saving}>{fr ? "Annuler" : "Cancel"}</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{fr ? "Enregistrer les avis" : "Save notices"}
          </Button>
        </div>
      </div>
    </div>
  )
}
