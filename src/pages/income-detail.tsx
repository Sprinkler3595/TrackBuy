import { useContext, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft, Plus, Trash2, ListChecks, History, Paperclip, Briefcase,
  Pencil, AlertTriangle, CheckCircle2, FileText,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ErrorPanel } from "@/components/ui/error-panel"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { EmploymentContractForm } from "@/components/features/employment-contract-form"
import { PayslipForm } from "@/components/features/payslip-form"
import {
  emptyPayslipForm,
  receiptToForm,
  type PayslipFormState,
} from "@/components/features/payslip-form-state"
import { PayslipCheckPanel } from "@/components/features/payslip-check-panel"
import { SalaryCertificatePanel } from "@/components/features/salary-certificate-panel"
import { formatDate, daysUntil, cn } from "@/lib/utils"
import { monthlyEquivalent } from "@/lib/finance"
import { MaskedAmount, VisibilityToggle, useAmountsVisible } from "@/components/features/amount-masked"
import { I18nContext, type TranslationKeys } from "@/lib/i18n"
import * as api from "@/lib/tauri"

const today = () => new Date().toISOString().slice(0, 10)

type Tab = "overview" | "contract" | "receipts" | "fiscal" | "attachments"

/// Gravité la plus élevée parmi les constats d'un bulletin — c'est elle qui
/// décide de la pastille affichée sur la ligne.
function worstSeverity(report?: api.PayslipReport): api.FindingSeverity | null {
  if (!report) return null
  if (report.findings.some((f) => f.severity === "error")) return "error"
  if (report.findings.some((f) => f.severity === "warn")) return "warn"
  return "ok"
}

export function IncomeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useContext(I18nContext)
  const { toast } = useToast()

  const [income, setIncome] = useState<api.Income | null>(null)
  const [receipts, setReceipts] = useState<api.IncomeReceipt[]>([])
  const [contract, setContract] = useState<api.EmploymentContract | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("overview")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteReceiptTarget, setDeleteReceiptTarget] = useState<string | null>(null)
  const [amountsVisible, setAmountsVisible] = useAmountsVisible()

  const [showForm, setShowForm] = useState(false)
  const [formState, setFormState] = useState<PayslipFormState | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /// Contrôles par bulletin, chargés à l'ouverture de l'onglet. Ils vivent à
  /// part des versements pour que la liste s'affiche sans attendre.
  const [checks, setChecks] = useState<Record<string, api.PayslipReport>>({})
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null)
  const [fiscalYear, setFiscalYear] = useState(() => new Date().getFullYear())

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const [inc, recs, ctr] = await Promise.all([
        api.getIncome(id),
        api.getIncomeReceipts(id),
        api.getEmploymentContract(id),
      ])
      setIncome(inc)
      setReceipts(recs)
      setContract(ctr)
      setError(null)
    } catch (err) {
      const msg = String(err)
      setError(msg)
      toast(`Erreur: ${msg}`, "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [id])

  // Les contrôles sont chargés quand l'onglet des bulletins s'ouvre, et
  // rechargés après chaque écriture : un bulletin ajouté change le cumul
  // annuel, donc le contrôle AC des bulletins suivants.
  useEffect(() => {
    if (tab !== "receipts" || receipts.length === 0) return
    let cancelled = false
    const run = async () => {
      const entries = await Promise.all(
        receipts.map(async (r) => {
          try {
            return [r.id, await api.checkIncomeReceipt(r.id)] as const
          } catch {
            return null
          }
        }),
      )
      if (cancelled) return
      setChecks(Object.fromEntries(entries.filter((e) => e !== null)))
    }
    void run()
    return () => { cancelled = true }
  }, [tab, receipts])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }
  if (error || !income) {
    return <ErrorPanel error={error ?? t("incomes.notFound")} onRetry={() => { void load() }} />
  }

  const i = income
  const isSalary = i.income_type === "salary"
  const typeKey = `incomes.type.${i.income_type}` as keyof TranslationKeys
  const cycleKey = (
    i.billing_cycle === "monthly"   ? "engagements.cycleMonthly" :
    i.billing_cycle === "quarterly" ? "engagements.cycleQuarterly" :
    i.billing_cycle === "yearly"    ? "engagements.cycleYearly" :
    i.billing_cycle === "one_shot"  ? "engagements.cycleOneShot" :
                                       "engagements.cycleCustom"
  ) as keyof TranslationKeys

  const monthly = i.current_amount != null && i.billing_cycle !== "one_shot"
    ? monthlyEquivalent(i.current_amount, i.billing_cycle, i.cycle_interval)
    : 0
  const yearly = monthly * 12

  const days = i.next_expected_date ? daysUntil(i.next_expected_date) : null
  const dueColor =
    days == null ? "" :
    days < 0 ? "text-destructive" :
    days <= 7 ? "text-amber-600 dark:text-amber-500" :
    "text-muted-foreground"

  const currentYear = today().slice(0, 4)
  const yearReceipts = receipts.filter(
    (r) => String(r.fiscal_year ?? r.received_on.slice(0, 4)) === currentYear,
  )
  const totalYTD = yearReceipts.reduce((acc, r) => acc + r.amount, 0)
  const grossYTD = yearReceipts.reduce((acc, r) => acc + (r.gross_amount ?? 0), 0)

  const anomalies = Object.values(checks).filter((c) =>
    c.findings.some((f) => f.severity === "error"),
  ).length

  const handleDelete = async () => {
    try {
      await api.deleteIncome(i.id)
      toast(t("incomes.deleted"), "success")
      navigate("/incomes")
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const openNewForm = () => {
    setFormState(emptyPayslipForm(i.current_amount?.toString() ?? ""))
    setShowForm(true)
  }

  const openEditForm = (r: api.IncomeReceipt) => {
    setFormState(receiptToForm(r))
    setShowForm(true)
  }

  const submitReceipt = async (receipt: api.IncomeReceipt) => {
    setSubmitting(true)
    try {
      if (receipt.id) {
        await api.updateIncomeReceipt(receipt)
        toast(t("incomes.receiptUpdated"), "success")
      } else {
        await api.logIncomeReceipt({
          income_id: i.id,
          received_on: receipt.received_on,
          amount: receipt.amount,
          currency: i.currency,
          period_label: receipt.period_label,
          period_start: receipt.period_start,
          period_end: receipt.period_end,
          fiscal_year: receipt.fiscal_year,
          gross_amount: receipt.gross_amount,
          base_salary_amount: receipt.base_salary_amount,
          thirteenth_amount: receipt.thirteenth_amount,
          overtime_amount: receipt.overtime_amount,
          overtime_hours: receipt.overtime_hours,
          holiday_pay_amount: receipt.holiday_pay_amount,
          bonus_amount: receipt.bonus_amount,
          benefits_in_kind_amount: receipt.benefits_in_kind_amount,
          company_car_private_amount: receipt.company_car_private_amount,
          family_allowance_amount: receipt.family_allowance_amount,
          other_gross_amount: receipt.other_gross_amount,
          social_charges_amount: receipt.social_charges_amount,
          ac_amount: receipt.ac_amount,
          ac_solidarity_amount: receipt.ac_solidarity_amount,
          pension_amount: receipt.pension_amount,
          laa_nonoccupational_amount: receipt.laa_nonoccupational_amount,
          ijm_amount: receipt.ijm_amount,
          tax_at_source_amount: receipt.tax_at_source_amount,
          other_deductions_amount: receipt.other_deductions_amount,
          expense_reimbursement_amount: receipt.expense_reimbursement_amount,
          expense_lump_sum_amount: receipt.expense_lump_sum_amount,
          notes: receipt.notes,
        })
        toast(t("incomes.receiptSaved"), "success")
      }
      setShowForm(false)
      setFormState(null)
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteReceipt = async () => {
    if (!deleteReceiptTarget) return
    try {
      await api.deleteIncomeReceipt(deleteReceiptTarget)
      toast(t("incomes.receiptDeleted"), "success")
      setDeleteReceiptTarget(null)
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const tabs: Array<[Tab, typeof ListChecks, string]> = [
    ["overview", ListChecks, t("engagements.tabOverview")],
    ...(isSalary ? [["contract", Briefcase, t("incomes.tabContract")] as [Tab, typeof ListChecks, string]] : []),
    ["receipts", History, `${isSalary ? t("incomes.payslips") : t("incomes.receipts")} (${receipts.length})`],
    ...(isSalary ? [["fiscal", FileText, t("incomes.tabFiscalYear")] as [Tab, typeof ListChecks, string]] : []),
    ["attachments", Paperclip, t("incomes.attachments")],
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/incomes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl font-bold truncate">{i.name}</h2>
              <Badge variant={i.status === "active" ? "success" : "secondary"}>
                {i.status === "active" ? t("incomes.statusActive") : t("incomes.statusEnded")}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t(typeKey)}
              {contract?.employer_name
                ? ` · ${contract.employer_name}`
                : i.source_name ? ` · ${i.source_name}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VisibilityToggle
            visible={amountsVisible}
            onChange={setAmountsVisible}
            labelShow={t("incomes.showAmounts")}
            labelHide={t("incomes.hideAmounts")}
          />
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" />{t("common.delete")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map(([key, Icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {key === "receipts" && anomalies > 0 && (
              <span className="ml-1 rounded-full bg-destructive px-1.5 text-xs text-white">
                {anomalies}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-lg">{t("incomes.currentAmount")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {i.current_amount != null && (
                <div className="grid sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("incomes.currentAmount")}</p>
                    <p className="text-2xl font-semibold">
                      <MaskedAmount amount={i.current_amount} currency={i.currency} visible={amountsVisible} />
                    </p>
                    <p className="text-xs text-muted-foreground">{t(cycleKey)}{i.cycle_interval > 1 ? ` ×${i.cycle_interval}` : ""}</p>
                  </div>
                  {i.billing_cycle !== "one_shot" && (
                    <>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("incomes.monthlyEquivalent")}</p>
                        <p className="text-2xl font-semibold">
                          <MaskedAmount amount={monthly} currency={i.currency} visible={amountsVisible} />
                        </p>
                        <p className="text-xs text-muted-foreground">{t("incomes.perMonth")}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("incomes.yearlyEquivalent")}</p>
                        <p className="text-2xl font-semibold">
                          <MaskedAmount amount={yearly} currency={i.currency} visible={amountsVisible} />
                        </p>
                        <p className="text-xs text-muted-foreground">{t("incomes.perYear")}</p>
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3 text-sm pt-2">
                {i.next_expected_date && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("incomes.nextExpected")}</p>
                    <p className={cn("font-medium", dueColor)}>
                      {formatDate(i.next_expected_date)}{" "}
                      {days != null && (days < 0
                        ? `(${t("incomes.lateBy")} ${-days}j)`
                        : `(${t("incomes.inDays")} ${days}j)`)}
                    </p>
                  </div>
                )}
                {i.card_name && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("incomes.card")}</p>
                    <p className="font-medium">{i.card_name}</p>
                  </div>
                )}
                {i.started_on && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("incomes.startedOn")}</p>
                    <p className="font-medium">{formatDate(i.started_on)}</p>
                  </div>
                )}
                {i.ended_on && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("incomes.endedOn")}</p>
                    <p className="font-medium">{formatDate(i.ended_on)}</p>
                  </div>
                )}
              </div>
              {i.notes && (
                <div className="pt-2 border-t text-sm">
                  <p className="text-xs text-muted-foreground">{t("incomes.notes")}</p>
                  <p className="whitespace-pre-wrap">{i.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">{t("incomes.totalYTD")} {currentYear}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-3xl font-bold">
                <MaskedAmount amount={totalYTD} currency={i.currency} visible={amountsVisible} />
              </p>
              {grossYTD > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("incomes.grossAmount")} :{" "}
                  <MaskedAmount amount={grossYTD} currency={i.currency} visible={amountsVisible} />
                </p>
              )}
              <p className="text-xs text-muted-foreground pt-2">
                {yearReceipts.length} {yearReceipts.length > 1
                  ? t("incomes.receiptsLogged")
                  : t("incomes.receiptLogged")}
              </p>
              {isSalary && !contract && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs mt-3">
                  <p className="font-medium">{t("incomes.noContractTitle")}</p>
                  <p className="text-muted-foreground mt-1">{t("incomes.noContractHint")}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => setTab("contract")}
                  >
                    {t("incomes.fillContract")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "contract" && (
        <EmploymentContractForm
          incomeId={i.id}
          onSaved={(c) => {
            setContract(c)
            // Les taux du contrat changent les montants attendus : les
            // contrôles déjà calculés sont périmés.
            setChecks({})
          }}
        />
      )}

      {tab === "receipts" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => (showForm ? setShowForm(false) : openNewForm())}
            >
              <Plus className="h-4 w-4" />
              {isSalary ? t("incomes.logPayslip") : t("incomes.logReceipt")}
            </Button>
          </div>

          {showForm && formState && (
            <PayslipForm
              incomeId={i.id}
              currency={i.currency}
              initial={formState}
              onSubmit={submitReceipt}
              onCancel={() => { setShowForm(false); setFormState(null) }}
              submitting={submitting}
            />
          )}

          {receipts.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">{t("incomes.noReceipts")}</CardContent></Card>
          ) : receipts.map((r) => {
            const report = checks[r.id]
            const severity = worstSeverity(report)
            const expanded = expandedCheck === r.id
            return (
              <Card key={r.id}>
                <CardContent className="p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{formatDate(r.received_on)}</p>
                        {r.period_label && <Badge variant="secondary">{r.period_label}</Badge>}
                        {severity === "error" && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {report.findings.filter((f) => f.severity === "error").length}
                          </Badge>
                        )}
                        {severity === "warn" && (
                          <Badge variant="warning" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {report.findings.filter((f) => f.severity === "warn").length}
                          </Badge>
                        )}
                        {severity === "ok" && (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {t("incomes.compliant")}
                          </Badge>
                        )}
                      </div>
                      {r.gross_amount != null && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("incomes.grossAmount")}{" "}
                          <MaskedAmount amount={r.gross_amount} currency={r.currency} visible={amountsVisible} />
                        </p>
                      )}
                      {r.notes && <p className="text-xs text-muted-foreground mt-1">{r.notes}</p>}
                    </div>
                    <p className="font-semibold shrink-0">
                      <MaskedAmount amount={r.amount} currency={r.currency} visible={amountsVisible} />
                    </p>
                    <div className="flex gap-1 shrink-0">
                      {report && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedCheck(expanded ? null : r.id)}
                        >
                          {expanded ? t("incomes.hideCheck") : t("incomes.showCheck")}
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => openEditForm(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteReceiptTarget(r.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {expanded && report && (
                    <PayslipCheckPanel report={report} currency={r.currency} />
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {tab === "fiscal" && (
        <SalaryCertificatePanel
          incomeId={i.id}
          currency={i.currency}
          year={fiscalYear}
          onYearChange={setFiscalYear}
        />
      )}

      {tab === "attachments" && (
        <AttachmentsPanel
          incomeId={i.id}
          itemDescription={i.name}
          templateContext={{
            merchant: contract?.employer_name ?? i.source_name ?? undefined,
            description: i.name,
            date: today(),
          }}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        title={t("incomes.deleteTitle")}
        message={t("incomes.deleteConfirm")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
      <ConfirmDialog
        open={deleteReceiptTarget !== null}
        title={t("incomes.deleteReceiptTitle")}
        message={t("incomes.deleteReceiptConfirm")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDeleteReceipt}
        onCancel={() => setDeleteReceiptTarget(null)}
      />
    </div>
  )
}
