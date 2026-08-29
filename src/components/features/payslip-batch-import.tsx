import { useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileText,
  Pause,
  Play,
  Upload,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { useModalKeyboard } from "@/hooks/use-modal-keyboard"
import {
  DEDUCTION_FIELDS,
  EXPENSE_FIELDS,
  GROSS_FIELDS,
  applyExtractionToForm,
  emptyPayslipForm,
  formToReceipt,
  parseMoney,
  type PayslipFormState,
} from "@/components/features/payslip-form-state"
import { documentToText } from "@/lib/document-scan"
import { tessdataAvailable } from "@/lib/ocr"
import { getAiSettings } from "@/lib/ai-settings"
import { formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// Import en lot de fiches de paie et de certificats de salaire.
///
/// Reprendre quinze ans de carrière, c'est deux cents documents. Trois
/// contraintes en découlent, et elles dictent toute l'ergonomie de cet écran :
///
///  - **chaque fichier coûte un appel à l'IA**, jusqu'à deux minutes. La file
///    est donc limitée à deux extractions simultanées, interruptible, et
///    reprenable : un fichier déjà lu ne l'est jamais deux fois ;
///  - **rien n'est enregistré sans relecture.** L'IA lit bien, pas
///    parfaitement, et un chiffre faux importé deux cents fois est un
///    historique faux pour toujours ;
///  - **un doublon n'est jamais écrasé en silence.** Un import en plusieurs
///    sessions est la norme, pas l'exception.

/// Deux extractions en vol. Au-delà, on sature le fournisseur sans gagner de
/// temps ; en dessous, deux cents fiches prennent une éternité.
const CONCURRENCY = 2

type Kind = "payslip" | "certificate"

type RowStatus = "queued" | "working" | "ready" | "failed"

interface Row {
  path: string
  name: string
  kind: Kind
  status: RowStatus
  error?: string
  include: boolean
  expanded: boolean
  form: PayslipFormState
  /// Rubriques lues sur un certificat de salaire annuel.
  certificate?: api.ExtractedSalaryCertificate
  /// Identifiant du bulletin déjà enregistré pour la même période.
  duplicateOf?: string
  filled: number
}

const base64ToBytes = (b64: string): Uint8Array => {
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

const mimeOf = (name: string): string => {
  const ext = name.toLowerCase().split(".").pop() ?? ""
  if (ext === "pdf") return "application/pdf"
  if (ext === "png") return "image/png"
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  return "application/octet-stream"
}

/// Un certificat de salaire annuel se reconnaît à ses intitulés. Le distinguer
/// vaut la peine : un certificat remplace douze bulletins, donc douze appels à
/// l'IA, pour le même total annuel de cotisations.
const looksLikeCertificate = (text: string): boolean => {
  const t = text.toLowerCase()
  return (
    t.includes("certificat de salaire") ||
    t.includes("lohnausweis") ||
    t.includes("certificato di salario")
  )
}

/// Période couverte par une ligne, telle que la base la comparera.
const periodKeyOf = (f: PayslipFormState): string =>
  f.period_end || f.period_start || f.received_on

/// Écart entre le net déclaré et le net recalculé depuis les postes lus.
/// C'est le filet contre une erreur de lecture : sur un bulletin correctement
/// lu, les deux se rejoignent au centime.
function coherenceGap(f: PayslipFormState): number | null {
  const net = parseMoney(f.amount)
  const gross = parseMoney(f.gross_amount)
  if (net == null || gross == null) return null
  const deductions = DEDUCTION_FIELDS.reduce((a, d) => a + (parseMoney(f[d.key]) ?? 0), 0)
  const expenses = EXPENSE_FIELDS.reduce((a, d) => a + (parseMoney(f[d.key]) ?? 0), 0)
  return net - (gross - deductions + expenses)
}

export function PayslipBatchImport({
  income,
  existingReceipts,
  onClose,
  onImported,
}: {
  income: api.Income
  existingReceipts: api.IncomeReceipt[]
  onClose: () => void
  onImported: () => void
}) {
  const { toast } = useToast()
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ocrReady, setOcrReady] = useState<boolean | null>(null)
  /// Une interruption doit être vue par les boucles déjà en vol, pas au
  /// prochain rendu : d'où la référence plutôt que l'état.
  const stopped = useRef(false)

  useModalKeyboard(!running && !saving, onClose)

  useEffect(() => {
    void tessdataAvailable().then(setOcrReady)
  }, [])

  const aiEnabled = getAiSettings().enabled

  /// Périodes déjà enregistrées : le doublon se voit AVANT l'import, pas
  /// après. La règle est celle de la base — la fin de période prime.
  const knownPeriods = new Map(
    existingReceipts.map((r) => [r.period_end || r.period_start || r.received_on, r.id]),
  )

  const pickFiles = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const picked = await open({
        multiple: true,
        title: "Choisir les fiches de salaire à importer",
        filters: [{ name: "Documents", extensions: ["pdf", "png", "jpg", "jpeg"] }],
      })
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
      if (paths.length === 0) return
      setRows((prev) => {
        const already = new Set(prev.map((r) => r.path))
        const added = paths
          .filter((p) => !already.has(p))
          .map<Row>((p) => ({
            path: p,
            name: p.split(/[/\\]/).pop() ?? p,
            kind: "payslip",
            status: "queued",
            include: true,
            expanded: false,
            form: emptyPayslipForm(),
            filled: 0,
          }))
        return [...prev, ...added]
      })
    } catch (e) {
      toast(`Sélection impossible : ${e}`, "error")
    }
  }

  const patch = (path: string, changes: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.path === path ? { ...r, ...changes } : r)))

  const patchForm = (path: string, key: keyof PayslipFormState, value: string) =>
    setRows((prev) =>
      prev.map((r) => (r.path === path ? { ...r, form: { ...r.form, [key]: value } } : r)),
    )

  /// Lit et extrait un fichier. Isolé pour qu'un échec ne fasse jamais tomber
  /// le reste du lot : la ligne passe en « à saisir à la main ».
  const processOne = async (row: Row) => {
    patch(row.path, { status: "working", error: undefined })
    try {
      const b64 = await api.readBinaryFileBase64(row.path)
      const text = await documentToText(base64ToBytes(b64), mimeOf(row.name), row.name)
      if (!text || text.trim().length < 40) {
        throw new Error(
          "Aucun texte lisible. Document scanné sans couche texte : l'OCR n'a rien rendu.",
        )
      }

      const settings = getAiSettings()
      if (looksLikeCertificate(text)) {
        const cert = await api.aiExtractSalaryCertificate(text, settings)
        patch(row.path, {
          kind: "certificate",
          certificate: cert,
          status: "ready",
          filled: Object.values(cert).filter((v) => v != null).length,
        })
        return
      }

      const extracted = await api.aiExtractPayslip(text, settings)
      const applied = applyExtractionToForm(emptyPayslipForm(), extracted)
      const duplicateOf = knownPeriods.get(periodKeyOf(applied.form))
      patch(row.path, {
        kind: "payslip",
        form: applied.form,
        filled: applied.filled.length,
        status: "ready",
        // Un doublon reste visible mais décoché : à l'utilisateur de décider,
        // jamais à l'import de trancher tout seul.
        duplicateOf,
        include: duplicateOf == null,
      })
    } catch (e) {
      patch(row.path, { status: "failed", error: String(e), include: false })
    }
  }

  /// Vide la file, deux fichiers à la fois. Ne reprend que les lignes encore
  /// en attente : relancer après une interruption ne relit rien.
  const runQueue = async () => {
    if (!aiEnabled) {
      toast("Activez l'assistant IA dans Paramètres → Général pour lire les documents.", "error")
      return
    }
    stopped.current = false
    setRunning(true)
    try {
      let pending = rows.filter((r) => r.status === "queued")
      while (pending.length > 0 && !stopped.current) {
        const slice = pending.slice(0, CONCURRENCY)
        await Promise.all(slice.map(processOne))
        pending = pending.slice(CONCURRENCY)
      }
    } finally {
      setRunning(false)
    }
  }

  const save = async () => {
    const payslips = rows.filter((r) => r.include && r.status === "ready" && r.kind === "payslip")
    const certificates = rows.filter(
      (r) => r.include && r.status === "ready" && r.kind === "certificate",
    )
    if (payslips.length === 0 && certificates.length === 0) {
      toast("Rien à importer : aucune ligne cochée.", "error")
      return
    }

    setSaving(true)
    try {
      let created = 0
      let skipped = 0

      if (payslips.length > 0) {
        const results = await api.logIncomeReceiptsBulk(
          payslips.map((r) => formToReceipt(r.form, income.id, income.currency)),
          // Une ligne cochée malgré son doublon est un remplacement voulu.
          payslips.some((r) => r.duplicateOf != null),
        )
        for (const res of results) {
          if (res.status === "duplicate" || res.status === "rejected") {
            skipped += 1
            continue
          }
          created += 1
          // Le PDF se range sur le BULLETIN, pas sur le revenu : c'est lui
          // qui justifie la ligne, et c'est là qu'on le rouvrira.
          const row = payslips[res.index]
          if (res.receipt_id && row) {
            try {
              await api.addIncomeReceiptAttachment(res.receipt_id, row.path, row.name, "payslip")
            } catch {
              // Le bulletin est enregistré ; l'absence de pièce jointe ne
              // justifie pas de perdre le lot.
            }
          }
        }
      }

      for (const row of certificates) {
        const c = row.certificate
        if (!c?.fiscal_year) {
          skipped += 1
          continue
        }
        await api.upsertSalaryCertificate({
          id: "",
          income_id: income.id,
          fiscal_year: c.fiscal_year,
          r1_salary: c.r1_salary,
          r2_1_benefits_in_kind: c.r2_1_benefits_in_kind,
          r2_2_company_car: c.r2_2_company_car,
          r2_3_other_benefits: c.r2_3_other_benefits,
          r3_irregular: c.r3_irregular,
          r4_capital_shares: c.r4_capital_shares,
          r5_board_fees: c.r5_board_fees,
          r6_other_benefits: c.r6_other_benefits,
          r7_other_payments: c.r7_other_payments,
          r8_gross_total: c.r8_gross_total,
          r9_social_contributions: c.r9_social_contributions,
          r10_1_lpp_ordinary: c.r10_1_lpp_ordinary,
          r10_2_lpp_buyback: c.r10_2_lpp_buyback,
          r11_net_salary: c.r11_net_salary,
          r12_tax_at_source: c.r12_tax_at_source,
          r13_1_effective_expenses: c.r13_1_effective_expenses,
          r13_2_lump_sum_expenses: c.r13_2_lump_sum_expenses,
          r14_other_disclosures: c.r14_other_disclosures,
          r15_remarks: c.r15_remarks,
          box_f_employer_transport: c.box_f_employer_transport ?? false,
          box_g_free_meals: c.box_g_free_meals ?? false,
          received_on: null,
          origin: "ai_scan",
          notes: null,
          created_at: "",
          updated_at: "",
        })
        created += 1
      }

      toast(
        skipped > 0
          ? `${created} document(s) importé(s), ${skipped} ignoré(s).`
          : `${created} document(s) importé(s).`,
        "success",
      )
      onImported()
      onClose()
    } catch (e) {
      toast(`Import interrompu : ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const queued = rows.filter((r) => r.status === "queued").length
  const ready = rows.filter((r) => r.status === "ready").length
  const failed = rows.filter((r) => r.status === "failed").length
  const selected = rows.filter((r) => r.include && r.status === "ready").length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-6">
          <div>
            <h2 className="text-lg font-semibold">Importer des fiches de salaire</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {income.name} · les documents sont lus, vous relisez, puis vous validez.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={running || saving}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {!aiEnabled && (
            <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <span>
                L'assistant IA est désactivé. Activez-le dans Paramètres → Général pour que les
                documents soient lus automatiquement.
              </span>
            </p>
          )}

          {ocrReady === false && (
            <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <span>
                Les données de reconnaissance de texte ne sont pas installées. Les PDF qui
                contiennent déjà du texte passeront, mais les <strong>documents scannés</strong> —
                fréquents avant 2015 — ne pourront pas être lus. Lancez{" "}
                <code className="rounded bg-muted px-1">npm run fetch-tessdata</code> avant un gros
                lot.
              </span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={pickFiles} disabled={running || saving}>
              <Upload className="mr-1.5 h-4 w-4" />
              Choisir des fichiers
            </Button>
            {queued > 0 && !running && (
              <Button onClick={runQueue} disabled={saving}>
                <Play className="mr-1.5 h-4 w-4" />
                Lire {queued} document{queued > 1 ? "s" : ""}
              </Button>
            )}
            {running && (
              <Button variant="outline" onClick={() => { stopped.current = true }}>
                <Pause className="mr-1.5 h-4 w-4" />
                Interrompre
              </Button>
            )}
            {rows.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {ready} lu{ready > 1 ? "s" : ""} · {queued} en attente
                {failed > 0 && ` · ${failed} en échec`}
              </span>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                Sélectionnez vos fiches de salaire, ou vos certificats de salaire annuels.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Un certificat annuel remplace douze fiches : pour les années les plus anciennes,
                c'est douze fois moins de lecture pour le même total de cotisations.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => {
                const gap = coherenceGap(row.form)
                const incoherent = gap != null && Math.abs(gap) > 1
                return (
                  <li key={row.path} className="rounded-lg border">
                    <div className="flex items-center gap-3 p-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 rounded border-input accent-primary"
                        checked={row.include}
                        disabled={row.status !== "ready"}
                        onChange={(e) => patch(row.path, { include: e.target.checked })}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {row.status === "queued" && <span>en attente</span>}
                          {row.status === "working" && <span>lecture en cours…</span>}
                          {row.status === "failed" && (
                            <span className="text-destructive">{row.error}</span>
                          )}
                          {row.status === "ready" && row.kind === "certificate" && (
                            <>
                              <Badge variant="secondary">certificat annuel</Badge>
                              <span>année {row.certificate?.fiscal_year ?? "?"}</span>
                            </>
                          )}
                          {row.status === "ready" && row.kind === "payslip" && (
                            <>
                              <span>{row.form.period_end || row.form.received_on || "période ?"}</span>
                              <span>
                                brut{" "}
                                {formatPrice(parseMoney(row.form.gross_amount) ?? 0, income.currency)}
                              </span>
                              <span>
                                net {formatPrice(parseMoney(row.form.amount) ?? 0, income.currency)}
                              </span>
                              <span>{row.filled} champs lus</span>
                            </>
                          )}
                          {row.duplicateOf && (
                            <Badge variant="warning">déjà enregistré</Badge>
                          )}
                          {incoherent && (
                            <Badge variant="destructive">
                              écart de {formatPrice(Math.abs(gap), income.currency)}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {row.status === "ready" && row.kind === "payslip" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => patch(row.path, { expanded: !row.expanded })}
                        >
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${row.expanded ? "rotate-180" : ""}`}
                          />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRows((p) => p.filter((r) => r.path !== row.path))}
                        disabled={running || saving}
                        aria-label={`Retirer ${row.name}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {row.expanded && row.kind === "payslip" && (
                      <div className="space-y-4 border-t bg-muted/20 p-4">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field label="Début de période">
                            <Input
                              type="date"
                              value={row.form.period_start}
                              onChange={(e) => patchForm(row.path, "period_start", e.target.value)}
                            />
                          </Field>
                          <Field label="Fin de période">
                            <Input
                              type="date"
                              value={row.form.period_end}
                              onChange={(e) => patchForm(row.path, "period_end", e.target.value)}
                            />
                          </Field>
                          <Field label="Versé le">
                            <Input
                              type="date"
                              value={row.form.received_on}
                              onChange={(e) => patchForm(row.path, "received_on", e.target.value)}
                            />
                          </Field>
                          <Field label="Net versé">
                            <Input
                              type="number"
                              step="0.01"
                              value={row.form.amount}
                              onChange={(e) => patchForm(row.path, "amount", e.target.value)}
                            />
                          </Field>
                          <Field label="Brut total">
                            <Input
                              type="number"
                              step="0.01"
                              value={row.form.gross_amount}
                              onChange={(e) => patchForm(row.path, "gross_amount", e.target.value)}
                            />
                          </Field>
                          <Field label="Allocations familiales">
                            <Input
                              type="number"
                              step="0.01"
                              value={row.form.family_allowance_amount}
                              onChange={(e) =>
                                patchForm(row.path, "family_allowance_amount", e.target.value)
                              }
                            />
                          </Field>
                        </div>

                        <FieldGroup title="Éléments du brut" fields={GROSS_FIELDS} row={row} onChange={patchForm} />
                        <FieldGroup title="Retenues" fields={DEDUCTION_FIELDS} row={row} onChange={patchForm} />
                        <FieldGroup title="Frais" fields={EXPENSE_FIELDS} row={row} onChange={patchForm} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t p-4">
          <p className="text-xs text-muted-foreground">
            {selected} document{selected > 1 ? "s" : ""} sera{selected > 1 ? "ont" : ""} importé
            {selected > 1 ? "s" : ""}.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={running || saving}>
              Annuler
            </Button>
            <Button onClick={save} disabled={saving || running || selected === 0}>
              <Check className="mr-1.5 h-4 w-4" />
              {saving ? "Import en cours…" : "Importer"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function FieldGroup({
  title,
  fields,
  row,
  onChange,
}: {
  title: string
  fields: readonly { key: keyof PayslipFormState; label: string }[]
  row: Row
  onChange: (path: string, key: keyof PayslipFormState, value: string) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">{title}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
            <Input
              type="number"
              step="0.01"
              value={row.form[f.key]}
              onChange={(e) => onChange(row.path, f.key, e.target.value)}
            />
          </Field>
        ))}
      </div>
    </div>
  )
}
