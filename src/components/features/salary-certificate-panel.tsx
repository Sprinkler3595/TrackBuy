import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, FileText, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ErrorPanel } from "@/components/ui/error-panel"
import { AiScanPanel } from "@/components/features/ai-scan-panel"
import { getAiSettings } from "@/lib/ai-settings"
import { cn, formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// Rubriques saisissables du certificat de salaire (formulaire 11), dans
/// l'ordre du document papier. Les rubriques 8 et 11 sont des totaux : elles
/// figurent sur le formulaire mais l'employeur les calcule, donc on les
/// affiche sans les mettre en saisie libre parmi les autres.
const RUBRICS: ReadonlyArray<{
  key: RubricKey
  num: string
  label: string
  /// Total calculé par l'employeur à partir des rubriques précédentes.
  total?: boolean
}> = [
  { key: "r1_salary", num: "1", label: "Salaire brut / rente" },
  { key: "r2_1_benefits_in_kind", num: "2.1", label: "Prestations en nature" },
  { key: "r2_2_company_car", num: "2.2", label: "Part privée du véhicule de service" },
  { key: "r2_3_other_benefits", num: "2.3", label: "Autres prestations accessoires" },
  { key: "r3_irregular", num: "3", label: "Prestations non périodiques" },
  { key: "r4_capital_shares", num: "4", label: "Participations de collaborateur" },
  { key: "r5_board_fees", num: "5", label: "Indemnités des membres de l'administration" },
  { key: "r6_other_benefits", num: "6", label: "Autres prestations" },
  { key: "r7_other_payments", num: "7", label: "Prestations en capital" },
  { key: "r8_gross_total", num: "8", label: "Salaire brut total", total: true },
  { key: "r9_social_contributions", num: "9", label: "Cotisations AVS/AI/APG/AC/AANP" },
  { key: "r10_1_lpp_ordinary", num: "10.1", label: "Cotisations LPP ordinaires" },
  { key: "r10_2_lpp_buyback", num: "10.2", label: "Cotisations LPP, rachats" },
  { key: "r11_net_salary", num: "11", label: "Salaire net", total: true },
  { key: "r12_tax_at_source", num: "12", label: "Impôt à la source retenu" },
  { key: "r13_1_effective_expenses", num: "13.1", label: "Frais effectifs" },
  { key: "r13_2_lump_sum_expenses", num: "13.2", label: "Frais forfaitaires" },
  { key: "r14_other_disclosures", num: "14", label: "Autres prestations de l'employeur" },
]

/// Clés numériques du certificat : toutes les rubriques sauf les observations
/// (texte) et les cases à cocher.
type RubricKey = Exclude<
  {
    [K in keyof api.SalaryCertificate]: api.SalaryCertificate[K] extends number | null
      ? K
      : never
  }[keyof api.SalaryCertificate],
  "fiscal_year"
>

const money = (v: number | null | undefined, currency: string) =>
  v == null ? "—" : formatPrice(v, currency)

function emptyCertificate(incomeId: string, year: number): api.SalaryCertificate {
  const zeros = Object.fromEntries(RUBRICS.map((r) => [r.key, null])) as Record<
    RubricKey,
    number | null
  >
  return {
    ...zeros,
    id: "",
    income_id: incomeId,
    fiscal_year: year,
    r15_remarks: null,
    box_f_employer_transport: false,
    box_g_free_meals: false,
    received_on: null,
    origin: "manual",
    notes: null,
    created_at: "",
    updated_at: "",
  }
}

export function SalaryCertificatePanel({
  incomeId,
  currency,
  year,
  onYearChange,
}: {
  incomeId: string
  currency: string
  year: number
  onYearChange: (y: number) => void
}) {
  const { toast } = useToast()
  const [reconciliation, setReconciliation] = useState<api.CertificateReconciliation | null>(null)
  const [params, setParams] = useState<api.PayrollParams | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const [rec, p] = await Promise.all([
          api.reconcileSalaryCertificate(incomeId, year),
          api.getPayrollParams(year),
        ])
        if (cancelled) return
        setReconciliation(rec)
        setParams(p)
        setEditing(false)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [incomeId, year, reloadKey])

  /// Pré-remplit la saisie avec le certificat déjà enregistré, ou à défaut
  /// avec les chiffres reconstitués depuis les bulletins — l'utilisateur n'a
  /// alors qu'à corriger les rubriques où l'employeur diverge.
  const startEditing = useCallback(
    (from: "declared" | "computed") => {
      if (!reconciliation) return
      const src =
        from === "declared" && reconciliation.declared
          ? reconciliation.declared
          : reconciliation.computed
      const next: Record<string, string> = {}
      for (const r of RUBRICS) {
        const v = src[r.key]
        next[r.key] = v == null ? "" : String(v)
      }
      next.r15_remarks = src.r15_remarks ?? ""
      next.received_on = src.received_on ?? ""
      next.box_f_employer_transport = src.box_f_employer_transport ? "1" : ""
      next.box_g_free_meals = src.box_g_free_meals ? "1" : ""
      setDraft(next)
      setEditing(true)
    },
    [reconciliation],
  )

  /// Pré-remplit la saisie depuis un certificat scanné, puis bascule en mode
  /// édition sans rien enregistrer. Le certificat de l'employeur pèse lourd
  /// (c'est lui que l'administration recevra) : il passe par une relecture,
  /// comme les autres extractions de l'application.
  const applyExtraction = (x: api.ExtractedSalaryCertificate): string => {
    const filled: string[] = []
    const next: Record<string, string> = {}
    for (const r of RUBRICS) {
      const v = x[r.key as keyof api.ExtractedSalaryCertificate]
      if (typeof v === "number") {
        next[r.key] = String(v)
        filled.push(r.num)
      } else {
        next[r.key] = ""
      }
    }
    next.r15_remarks = x.r15_remarks ?? ""
    next.received_on = reconciliation?.declared?.received_on ?? ""
    next.box_f_employer_transport = x.box_f_employer_transport ? "1" : ""
    next.box_g_free_meals = x.box_g_free_meals ? "1" : ""
    setDraft(next)
    setEditing(true)

    if (x.fiscal_year && x.fiscal_year !== year) {
      // Le certificat scanné porte une autre année : suivre le document plutôt
      // que d'écrire ses chiffres sur l'exercice affiché.
      toast(
        `Ce certificat porte sur ${x.fiscal_year} — bascule sur cette année.`,
        "success",
      )
      onYearChange(x.fiscal_year)
    }
    return filled.length ? `rubriques ${filled.slice(0, 8).join(", ")}…` : ""
  }

  const save = async () => {
    if (!reconciliation) return
    const num = (k: string): number | null => {
      const raw = (draft[k] ?? "").trim()
      if (!raw) return null
      const n = parseFloat(raw)
      return Number.isNaN(n) ? null : n
    }
    const base = emptyCertificate(incomeId, year)
    const values = Object.fromEntries(RUBRICS.map((r) => [r.key, num(r.key)]))
    setSaving(true)
    try {
      await api.upsertSalaryCertificate({
        ...base,
        ...(values as Record<RubricKey, number | null>),
        id: reconciliation.declared?.id ?? "",
        r15_remarks: draft.r15_remarks || null,
        received_on: draft.received_on || null,
        box_f_employer_transport: draft.box_f_employer_transport === "1",
        box_g_free_meals: draft.box_g_free_meals === "1",
        origin: "manual",
      })
      toast("Certificat enregistré", "success")
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }
  if (error || !reconciliation) {
    return (
      <ErrorPanel
        error={error ?? "Certificat indisponible"}
        onRetry={() => { setError(null); setReloadKey((k) => k + 1) }}
      />
    )
  }

  const { computed, declared, diffs, receipt_count } = reconciliation
  const mismatches = diffs.filter((d) => d.mismatch)
  const currentYear = new Date().getFullYear()
  const years = params?.known_years?.length
    ? Array.from(new Set([...params.known_years, currentYear])).sort((a, b) => b - a)
    : [currentYear]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Année fiscale</label>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={year}
            onChange={(e) => onYearChange(parseInt(e.target.value, 10))}
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Badge variant="secondary">
            {receipt_count} bulletin{receipt_count > 1 ? "s" : ""}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => startEditing("computed")}
                title="Pré-remplir avec les chiffres reconstitués depuis les bulletins"
              >
                Reprendre le calcul
              </Button>
              <Button size="sm" onClick={() => startEditing("declared")}>
                <FileText className="h-4 w-4" />
                {declared ? "Modifier le certificat reçu" : "Saisir le certificat reçu"}
              </Button>
            </>
          )}
          {editing && (
            <>
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                <Save className="h-4 w-4" />
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                Annuler
              </Button>
            </>
          )}
        </div>
      </div>

      <AiScanPanel
        fr
        title="Scanner le certificat de salaire"
        subtitle="PDF ou photo du formulaire 11. Les rubriques sont pré-remplies puis confrontées à vos bulletins."
        onExtract={async (text) =>
          applyExtraction(await api.aiExtractSalaryCertificate(text, getAiSettings()))
        }
      />

      {receipt_count === 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium">Aucun bulletin pour {year}</p>
          <p className="text-muted-foreground mt-1">
            La colonne « calculé » est donc vide : il n'y a rien à confronter au
            certificat de votre employeur. Saisissez les bulletins de l'année
            pour que la comparaison ait un sens.
          </p>
        </div>
      )}

      {declared && mismatches.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            {mismatches.length} rubrique{mismatches.length > 1 ? "s divergent" : " diverge"} de vos bulletins
          </p>
          <p className="text-muted-foreground mt-1">
            Un écart n'est pas forcément une erreur de l'employeur : un bulletin
            manquant dans l'application produit le même effet. Vérifiez d'abord
            que les {receipt_count} bulletins saisis couvrent bien toute l'année.
          </p>
        </div>
      )}

      {declared && mismatches.length === 0 && receipt_count > 0 && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
          <span>Le certificat reçu concorde avec vos {receipt_count} bulletins.</span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Certificat de salaire {year}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Votre employeur doit l'établir même sans que vous le demandiez
            (art. 127 LIFD). La colonne « calculé » reconstitue chaque rubrique
            depuis vos bulletins.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left font-medium p-3 w-16">N°</th>
                  <th className="text-left font-medium p-3">Rubrique</th>
                  <th className="text-right font-medium p-3">Calculé</th>
                  <th className="text-right font-medium p-3">
                    {editing ? "Certificat reçu (saisie)" : "Certificat reçu"}
                  </th>
                  <th className="text-right font-medium p-3">Écart</th>
                </tr>
              </thead>
              <tbody>
                {RUBRICS.map((r) => {
                  const diff = diffs.find((d) => d.rubric === r.num)
                  const declaredValue = declared?.[r.key] ?? null
                  return (
                    <tr
                      key={r.key}
                      className={cn(
                        "border-b last:border-0",
                        r.total && "bg-muted/40 font-medium",
                        diff?.mismatch && "bg-destructive/5",
                      )}
                    >
                      <td className="p-3 text-muted-foreground tabular-nums">{r.num}</td>
                      <td className="p-3">{r.label}</td>
                      <td className="p-3 text-right tabular-nums">
                        {money(computed[r.key], currency)}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {editing ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="h-8 text-right"
                            value={draft[r.key] ?? ""}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, [r.key]: e.target.value }))
                            }
                          />
                        ) : (
                          money(declaredValue, currency)
                        )}
                      </td>
                      <td
                        className={cn(
                          "p-3 text-right tabular-nums",
                          diff?.mismatch
                            ? "text-destructive font-medium"
                            : "text-muted-foreground",
                        )}
                      >
                        {diff?.difference == null
                          ? "—"
                          : formatPrice(diff.difference, currency)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {editing && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cases et observations</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reçu le</label>
              <Input
                type="date"
                value={draft.received_on ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, received_on: e.target.value }))}
              />
            </div>
            <div className="space-y-3 pt-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-primary"
                  checked={draft.box_f_employer_transport === "1"}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      box_f_employer_transport: e.target.checked ? "1" : "",
                    }))
                  }
                />
                <span>
                  Case F — transport domicile-travail payé par l'employeur
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-primary"
                  checked={draft.box_g_free_meals === "1"}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, box_g_free_meals: e.target.checked ? "1" : "" }))
                  }
                />
                <span>Case G — repas gratuits (réduit le forfait repas déductible)</span>
              </label>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium">15. Observations</label>
              <textarea
                className="w-full min-h-[70px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={draft.r15_remarks ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, r15_remarks: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
