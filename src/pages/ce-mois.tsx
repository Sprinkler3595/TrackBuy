import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Calendar,
  CheckCircle2,
  Inbox as InboxIcon,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { formatPrice, cn } from "@/lib/utils"
import * as api from "@/lib/tauri"

// French labels for the canonical engagement types.
const ENGAGEMENT_TYPE_LABEL: Record<string, string> = {
  insurance_health: "LAMal",
  insurance_household: "RC ménage",
  insurance_car: "Assurance auto",
  insurance_life: "Assurance vie",
  insurance_legal: "Protection juridique",
  insurance_other: "Assurance",
  rent: "Loyer",
  parking: "Parking",
  electricity: "Électricité",
  gas: "Gaz",
  water: "Eau",
  fuel: "Mazout",
  heating: "Chauffage",
  phone: "Téléphone",
  internet: "Internet",
  tv_radio: "Redevance TV/Radio",
  tax_federal: "Impôt fédéral",
  tax_cantonal: "Impôt cantonal",
  tax_communal: "Impôt communal",
  tax_other: "Autre taxe",
  fine: "Amende",
  fee: "Frais",
  membership: "Cotisation",
  leasing: "Leasing",
  mortgage: "Hypothèque",
  other: "Autre",
}

function ToPayRow({ line, onMarkPaid }: { line: api.ToPayLine; onMarkPaid: (id: string) => void }) {
  const urgent = line.days_until <= 7
  const overdue = line.days_until < 0
  const dueLabel =
    overdue
      ? `${Math.abs(line.days_until)} j de retard`
      : line.days_until === 0
        ? "Aujourd'hui"
        : line.days_until === 1
          ? "Demain"
          : `Dans ${line.days_until} j`

  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to={`/engagements/${line.engagement_id}`}
            className="truncate font-medium hover:underline"
          >
            {line.engagement_name}
          </Link>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {ENGAGEMENT_TYPE_LABEL[line.engagement_type] ?? line.engagement_type}
          </Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          {line.creditor_name && <span className="truncate">{line.creditor_name}</span>}
          {line.payment_method && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              {line.payment_method === "qr_bill"
                ? "QR-facture"
                : line.payment_method === "direct_debit"
                  ? "LSV"
                  : line.payment_method === "standing_order"
                    ? "Ordre permanent"
                    : line.payment_method}
            </span>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="font-semibold tabular-nums">
          {formatPrice(line.amount, line.currency)}
        </div>
        <div
          className={`text-xs ${overdue ? "font-semibold text-destructive" : urgent ? "text-destructive" : "text-muted-foreground"}`}
        >
          {dueLabel}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => onMarkPaid(line.charge_id)}>
        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
        Payé
      </Button>
    </div>
  )
}

function ToReceiveRow({ line }: { line: api.ToReceiveLine }) {
  const dueLabel =
    line.days_until === 0
      ? "Aujourd'hui"
      : line.days_until === 1
        ? "Demain"
        : `Dans ${line.days_until} j`
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <Link to={`/incomes/${line.income_id}`} className="truncate font-medium hover:underline">
          {line.name}
        </Link>
        {line.source && <div className="text-xs text-muted-foreground">{line.source}</div>}
      </div>
      <div className="text-right">
        <div className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
          + {formatPrice(line.amount, line.currency)}
        </div>
        <div className="text-xs text-muted-foreground">{dueLabel}</div>
      </div>
    </div>
  )
}

export function CeMoisPage() {
  const [summary, setSummary] = useState<api.ThisMonthSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const s = await api.getThisMonth()
      setSummary(s)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function markPaid(chargeId: string) {
    try {
      await api.markChargePaid(chargeId, new Date().toISOString().slice(0, 10), null)
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  if (loading || !summary) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  const today = new Date()
  const monthLabel = new Intl.DateTimeFormat("fr-CH", {
    month: "long",
    year: "numeric",
  }).format(today)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold capitalize">{monthLabel}</h1>
        <p className="text-sm text-muted-foreground">
          Tout ce qui passe sur vos comptes ce mois-ci, regroupé en un coup d'œil.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Net summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-destructive/10 p-2 text-destructive">
              <TrendingDown className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">À payer (30 j)</div>
              <div className="truncate text-lg font-semibold tabular-nums">
                {formatPrice(summary.to_pay_total_chf, "CHF")}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">À encaisser (30 j)</div>
              <div className="truncate text-lg font-semibold tabular-nums">
                {formatPrice(summary.to_receive_total_chf, "CHF")}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Wallet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Solde net estimé</div>
              <div
                className={`truncate text-lg font-semibold tabular-nums ${
                  summary.net_estimate_chf >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive"
                }`}
              >
                {summary.net_estimate_chf >= 0 ? "+" : ""}
                {formatPrice(summary.net_estimate_chf, "CHF")}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Inbox status */}
      {(summary.inbox_pending_transactions > 0 || summary.inbox_pending_invoices > 0) && (
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <InboxIcon className="h-5 w-5 text-primary" />
            <div className="flex-1 text-sm">
              <span className="font-medium">À traiter :</span>{" "}
              {summary.inbox_pending_transactions > 0 && (
                <span>{summary.inbox_pending_transactions} transaction(s) bancaire(s) non rapprochée(s)</span>
              )}
              {summary.inbox_pending_transactions > 0 && summary.inbox_pending_invoices > 0 && (
                <span> • </span>
              )}
              {summary.inbox_pending_invoices > 0 && (
                <span>{summary.inbox_pending_invoices} facture(s) en attente</span>
              )}
            </div>
            <Link
              to="/inbox"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Traiter <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      )}

      {/* À payer */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-destructive" />
            <CardTitle>À payer ce mois</CardTitle>
          </div>
          <Badge variant="secondary">{summary.to_pay_lines.length}</Badge>
        </CardHeader>
        <CardContent>
          {summary.to_pay_lines.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              Aucune facture en attente d'ici 30 jours. 🎯
            </p>
          ) : (
            <div>
              {summary.to_pay_lines.map((l) => (
                <ToPayRow key={l.charge_id} line={l} onMarkPaid={markPaid} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* À encaisser */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <CardTitle>À encaisser</CardTitle>
          </div>
          <Badge variant="secondary">{summary.to_receive_lines.length}</Badge>
        </CardHeader>
        <CardContent>
          {summary.to_receive_lines.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              Aucun revenu attendu dans les 30 jours.
            </p>
          ) : (
            <div>
              {summary.to_receive_lines.map((l) => (
                <ToReceiveRow key={l.income_id} line={l} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        Les totaux excluent les montants en devises non-CHF. Les ouvrir
        individuellement pour voir la devise d'origine.
      </div>
    </div>
  )
}
