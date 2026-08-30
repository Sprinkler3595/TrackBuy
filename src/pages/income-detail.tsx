import { useContext, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft, Plus, Trash2, ListChecks, History, Paperclip, Briefcase,
  Pencil, AlertTriangle, CheckCircle2, Upload, Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ErrorPanel } from "@/components/ui/error-panel"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { EmploymentContractForm } from "@/components/features/employment-contract-form"
import { GrossToNetPanel } from "@/components/features/gross-to-net-panel"
import { LppPlanEditor } from "@/components/features/lpp-plan-editor"
import { SupplementRates } from "@/components/features/supplement-rates"
import { PayslipForm } from "@/components/features/payslip-form"
import { PayslipConfirm } from "@/components/features/payslip-confirm"
import { SupplementYearSummary } from "@/components/features/supplement-year-summary"
import { PayslipBatchImport } from "@/components/features/payslip-batch-import"
import {
  emptyPayslipForm,
  receiptToForm,
  type PayslipFormState,
} from "@/components/features/payslip-form-state"
import { PayslipCheckPanel } from "@/components/features/payslip-check-panel"
import { ReceiptBreakdown } from "@/components/features/receipt-breakdown"
import { formatDate, daysUntil, cn } from "@/lib/utils"
import { monthlyEquivalent, receiptYear } from "@/lib/finance"
import { MaskedAmount, VisibilityToggle, useAmountsVisible } from "@/components/features/amount-masked"
import { I18nContext, type TranslationKeys } from "@/lib/i18n"
import * as api from "@/lib/tauri"

const today = () => new Date().toISOString().slice(0, 10)

/// Pas d'onglet fiscal ici. Le certificat de salaire et la synthèse d'impôt
/// répondent à une question posée une fois l'an ; les faire cohabiter avec le
/// suivi des cotisations obligeait à trancher chaque mois entre deux univers.
/// Les données et les commandes restent en place — seul l'écran disparaît.
type Tab = "overview" | "contract" | "receipts" | "attachments"

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
  /// Toutes les versions du contrat : le formulaire de bulletin y prend le
  /// barème de suppléments en vigueur à la date de la fiche.
  const [contractVersions, setContractVersions] = useState<api.EmploymentContract[]>([])
  /// Incrémenté à chaque rechargement : les panneaux qui interrogent la base
  /// eux-mêmes (le décompte annuel des suppléments) s'y raccrochent.
  const [dataVersion, setDataVersion] = useState(0)
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

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const [inc, recs, ctr, versions] = await Promise.all([
        api.getIncome(id),
        api.getIncomeReceipts(id),
        api.getEmploymentContract(id),
        api.getEmploymentContractVersions(id),
      ])
      setIncome(inc)
      setReceipts(recs)
      setContract(ctr)
      setContractVersions(versions)
      setDataVersion((v) => v + 1)
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

  /// Année dépliée dans l'onglet des bulletins. Sur une carrière reprise, les
  /// bulletins se comptent par centaines : les afficher à plat, et surtout
  /// tous les contrôler, rendait l'onglet inutilisable.
  const [openReceiptYear, setOpenReceiptYear] = useState<number | null>(null)

  // Les contrôles sont chargés quand l'onglet des bulletins s'ouvre, et
  // rechargés après chaque écriture : un bulletin ajouté change le cumul
  // annuel, donc le contrôle AC des bulletins suivants. Seule l'année dépliée
  // est contrôlée, en UN aller-retour.
  useEffect(() => {
    if (tab !== "receipts" || receipts.length === 0) return
    let cancelled = false
    const run = async () => {
      try {
        const year = openReceiptYear ?? [...new Set(receipts.map(receiptYear))].sort((a, b) => b - a)[0]
        if (year == null) return
        const reports = await api.checkIncomeReceipts(id as string, year)
        if (!cancelled) setChecks((prev) => ({ ...prev, ...reports }))
      } catch {
        // Le contrôle est un confort : son échec ne doit pas vider la liste.
      }
    }
    void run()
    return () => { cancelled = true }
  }, [tab, receipts, openReceiptYear, id])

  /// Import en lot : c'est le chemin d'une reprise d'historique, distinct
  /// de la saisie d'un bulletin du mois.
  const [batchOpen, setBatchOpen] = useState(false)

  /// « J'ai reçu mon salaire » : le geste mensuel, celui qui doit être court.
  const [confirmOpen, setConfirmOpen] = useState(false)

  /// Date proposée pour clore l'emploi : le dernier versement connu, sinon
  /// aujourd'hui. Sur un employeur quitté il y a des années, proposer la date
  /// du jour obligerait à la corriger à chaque fois.
  const [closeDate, setCloseDate] = useState("")
  const [closing, setClosing] = useState(false)

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

  /// Année montrée par la carte de cumul. Pour un emploi en cours c'est
  /// l'année courante ; pour un employeur quitté en 2019, l'année courante ne
  /// contient rien et la carte afficherait 0. On retombe alors sur la dernière
  /// année réellement cotisée — la seule qui ait un sens à afficher.
  const summaryYear = (() => {
    const thisYear = new Date().getFullYear()
    const years = receipts.map(receiptYear).filter((y) => !Number.isNaN(y))
    if (years.includes(thisYear)) return thisYear
    return years.length > 0 ? Math.max(...years) : thisYear
  })()

  /// Bulletins regroupés par année, de la plus récente à la plus ancienne.
  const receiptYears = [...new Set(receipts.map(receiptYear))].sort((a, b) => b - a)
  const shownYear = openReceiptYear ?? receiptYears[0] ?? null

  const yearReceipts = receipts.filter((r) => receiptYear(r) === summaryYear)
  const totalYTD = yearReceipts.reduce((acc, r) => acc + r.amount, 0)
  const grossYTD = yearReceipts.reduce((acc, r) => acc + (r.gross_amount ?? 0), 0)

  const anomalies = Object.values(checks).filter((c) =>
    c.findings.some((f) => f.severity === "error"),
  ).length

  const openClose = () => {
    const last = receipts
      .map((r) => r.period_end || r.received_on)
      .sort()
      .pop()
    setCloseDate(last ?? new Date().toISOString().slice(0, 10))
  }

  const handleClose = async () => {
    if (!i || !closeDate) return
    setClosing(true)
    try {
      await api.updateIncome({ ...i, status: "ended", ended_on: closeDate })
      toast(t("incomes.updated"), "success")
      setCloseDate("")
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    } finally {
      setClosing(false)
    }
  }

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

  const submitReceipt = async (
    receipt: api.IncomeReceipt,
    supplements: api.ReceiptSupplement[],
  ) => {
    setSubmitting(true)
    try {
      // L'identifiant du bulletin est ce qui rattache les quantités : à la
      // création il n'existe qu'une fois la ligne écrite, d'où le second appel.
      let receiptId = receipt.id
      if (receipt.id) {
        await api.updateIncomeReceipt(receipt)
        toast(t("incomes.receiptUpdated"), "success")
      } else {
        const created = await api.logIncomeReceipt({
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
          net_addition_amount: receipt.net_addition_amount,
          notes: receipt.notes,
        })
        receiptId = created.id
        toast(t("incomes.receiptSaved"), "success")
      }
      // Toujours appelé, y compris à vide : c'est ce qui efface les quantités
      // d'un bulletin dont on vient de retirer les astreintes.
      if (receiptId && isSalary) {
        await api.setReceiptSupplements(receiptId, supplements)
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
          {i.status === "active" && (
            <Button variant="outline" size="sm" onClick={openClose}>
              {t("incomes.closeIncome")}
            </Button>
          )}
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
            <CardHeader><CardTitle className="text-lg">{t("incomes.totalYTD")} {summaryYear}</CardTitle></CardHeader>
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
        <div className="space-y-6">
          {/* En tête d'onglet : c'est la question que l'utilisateur se pose en
              arrivant ici — « combien me restera-t-il ? » — et les taux qui y
              répondent sont juste en dessous. */}
          <GrossToNetPanel income={i} contract={contract} onAmountUpdated={load} />
          <EmploymentContractForm
            incomeId={i.id}
            defaultEmployerName={i.source_name}
            onSaved={(c) => {
              setContract(c)
              // Les taux du contrat changent les montants attendus : les
              // contrôles déjà calculés sont périmés.
              setChecks({})
              // Un avenant ajoute une version, et avec elle un barème de
              // suppléments : le formulaire de bulletin doit le voir.
              api.getEmploymentContractVersions(i.id).then(setContractVersions).catch(() => {})
            }}
          />
          {/* Deux barèmes rattachés à la VERSION de contrat, donc affichés
              seulement une fois qu'elle existe. Ils vivent sous le formulaire
              parce qu'ils se remplissent une fois, contrairement aux taux
              au-dessus qu'on relit à chaque augmentation. */}
          {contract && (
            <>
              <LppPlanEditor
                contractId={contract.id}
                currency={i.currency}
                birthDate={contract.birth_date}
                flatRate={contract.lpp_employee_share_pct}
                onChanged={() => setChecks({})}
              />
              <SupplementRates
                contractId={contract.id}
                currency={i.currency}
                onChanged={() => setChecks({})}
              />
            </>
          )}
        </div>
      )}

      {tab === "receipts" && (
        <div className="space-y-3">
          {/* Confirmer le salaire du mois est le geste courant : il mérite le
              bouton principal. Le formulaire détaillé reste accessible pour les
              bulletins qui sortent de l'ordinaire, et l'import en lot pour la
              reprise d'un historique. */}
          <div className="flex flex-wrap justify-end gap-2">
            {isSalary && (
              <Button size="sm" variant="outline" onClick={() => setBatchOpen(true)}>
                <Upload className="h-4 w-4" />
                Importer un lot
              </Button>
            )}
            <Button
              size="sm"
              variant={isSalary ? "outline" : "default"}
              onClick={() => (showForm ? setShowForm(false) : openNewForm())}
            >
              <Plus className="h-4 w-4" />
              {isSalary ? "Saisir en détail" : t("incomes.logReceipt")}
            </Button>
            {isSalary && (
              <Button size="sm" onClick={() => setConfirmOpen(true)}>
                <Check className="h-4 w-4" />
                J'ai reçu mon salaire
              </Button>
            )}
          </div>

          {showForm && formState && (
            <PayslipForm
              incomeId={i.id}
              currency={i.currency}
              contracts={contractVersions}
              initial={formState}
              onSubmit={submitReceipt}
              onCancel={() => { setShowForm(false); setFormState(null) }}
              submitting={submitting}
            />
          )}

          {receipts.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">{t("incomes.noReceipts")}</CardContent></Card>
          ) : (
          <>
          {/* Une carrière reprise se compte en centaines de bulletins : les
              grouper par année évite une liste à plat interminable, et surtout
              ne contrôle que l'année ouverte. */}
          {receiptYears.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {receiptYears.map((y) => (
                <Button
                  key={y}
                  variant={y === shownYear ? "default" : "outline"}
                  size="sm"
                  onClick={() => setOpenReceiptYear(y)}
                >
                  {y}
                  <span className="ml-1.5 text-xs opacity-70">
                    {receipts.filter((r) => receiptYear(r) === y).length}
                  </span>
                </Button>
              ))}
            </div>
          )}
          {isSalary && shownYear != null && (
            <SupplementYearSummary
              incomeId={i.id}
              year={shownYear}
              currency={i.currency}
              reloadKey={dataVersion}
            />
          )}
          {receipts.filter((r) => receiptYear(r) === shownYear).map((r) => {
            const report = checks[r.id]
            const severity = worstSeverity(report)
            const expanded = expandedCheck === r.id
            return (
              <Card key={r.id}>
                <CardContent className="p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    {/* Toute la ligne ouvre le détail : chercher le petit
                        bouton « voir le contrôle » pour savoir d'où sort un
                        montant n'était pas un réflexe naturel. */}
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setExpandedCheck(expanded ? null : r.id)}
                    >
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{formatDate(r.received_on)}</span>
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
                      </span>
                      {r.gross_amount != null && (
                        <span className="block text-xs text-muted-foreground mt-1">
                          {t("incomes.grossAmount")}{" "}
                          <MaskedAmount amount={r.gross_amount} currency={r.currency} visible={amountsVisible} />
                        </span>
                      )}
                      {r.notes && <span className="block text-xs text-muted-foreground mt-1">{r.notes}</span>}
                    </button>
                    <p className="font-semibold shrink-0">
                      <MaskedAmount amount={r.amount} currency={r.currency} visible={amountsVisible} />
                    </p>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedCheck(expanded ? null : r.id)}
                      >
                        {expanded ? t("incomes.hideCheck") : t("incomes.showCheck")}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEditForm(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteReceiptTarget(r.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="space-y-3">
                      {/* D'abord le décompte : c'est la question qu'on se pose
                          en rouvrant un mois — d'où vient ce chiffre. Le
                          contrôle vient après, il commente ce décompte. */}
                      <ReceiptBreakdown receipt={r} />
                      {report && <PayslipCheckPanel report={report} currency={r.currency} />}
                      {/* Le PDF du bulletin se consulte ici, à côté du contrôle
                          qu'il justifie — pas dans une pile commune au revenu où
                          plus rien ne dit quel mois il documente. */}
                      <AttachmentsPanel
                        incomeReceiptId={r.id}
                        itemDescription={`${i.name} — ${r.period_label ?? formatDate(r.received_on)}`}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
          </>
          )}
        </div>
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

      {confirmOpen && (
        <PayslipConfirm
          income={i}
          contracts={contractVersions}
          onClose={() => setConfirmOpen(false)}
          onSaved={load}
        />
      )}

      {batchOpen && (
        <PayslipBatchImport
          income={i}
          existingReceipts={receipts}
          onClose={() => setBatchOpen(false)}
          onImported={load}
        />
      )}

      {/* Clore demande une DATE, pas une confirmation : c'est elle qui situe
          l'emploi dans la carrière, et `ConfirmDialog` ne sait pas la saisir. */}
      {closeDate !== "" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-semibold">{t("incomes.closeIncome")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("incomes.endedOnHint")}
            </p>
            <div className="mt-4 space-y-2">
              <label className="text-sm font-medium">{t("incomes.endedOn")}</label>
              <Input
                type="date"
                value={closeDate}
                onChange={(e) => setCloseDate(e.target.value)}
                autoFocus
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCloseDate("")} disabled={closing}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleClose} disabled={closing || !closeDate}>
                {t("incomes.closeIncome")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
