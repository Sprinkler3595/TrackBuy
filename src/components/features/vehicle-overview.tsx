import { useContext, useEffect, useMemo, useState } from "react"
import {
  ResponsiveContainer,
  ComposedChart, BarChart, Bar, Line,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend, ReferenceLine,
} from "recharts"
import {
  CalendarClock, Fuel, Gauge, Receipt, TrendingUp, Wallet, Zap,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { I18nContext } from "@/lib/i18n"
import { formatPrice, formatDate, daysUntil } from "@/lib/utils"
import { categoryLabel, energyLabel, isElectric } from "@/lib/vehicle"
import {
  averageLedger, buildMonthlySeries, lastMonths,
  smoothedContracts, sumMonthly, type MonthBucket,
} from "@/lib/vehicle-costs"
import * as api from "@/lib/tauri"

/// Chart palette — plain hues that stay readable in both themes (same set the
/// finance views used).
const COLOR_CONTRACTS = "#6366f1"
const COLOR_LEDGER = "#14b8a6"
const COLOR_ENERGY = "#f59e0b"

const MONTHS_SHOWN = 12
/// Horizon for the "coming up" list — one billing quarter ahead.
const UPCOMING_DAYS = 90

interface VehicleOverviewProps {
  vehicle: api.Vehicle
  engagements: api.VehicleEngagementSummary[]
}

/// The vehicle dashboard: what this car actually costs, month by month.
///
/// Two numbers coexist and are meant to differ: the month's REAL outflow
/// (instalments falling due + expense-book entries) and the SMOOTHED monthly
/// cost (yearly premiums spread over 12). A car with a yearly insurance looks
/// cheap eleven months a year and brutal on the twelfth — only the smoothed
/// figure answers "what does this car cost me".
export function VehicleOverview({ vehicle, engagements }: VehicleOverviewProps) {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"

  const [expenses, setExpenses] = useState<api.VehicleExpense[]>([])
  const [charges, setCharges] = useState<api.EngagementCharge[]>([])
  const [loading, setLoading] = useState(true)

  // Charges are fetched per contract: there is no "all charges for a vehicle"
  // endpoint, and a vehicle carries a handful of contracts at most.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [exp, chargeLists] = await Promise.all([
          api.getVehicleExpenses(vehicle.id),
          Promise.all(engagements.map((e) => api.getEngagementCharges(e.id).catch(() => []))),
        ])
        if (cancelled) return
        setExpenses(exp)
        setCharges(chargeLists.flat())
      } catch {
        if (!cancelled) { setExpenses([]); setCharges([]) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [vehicle.id, engagements])

  const months = useMemo(() => lastMonths(MONTHS_SHOWN), [])
  const series = useMemo(
    () => buildMonthlySeries(months, expenses, charges, fr),
    [months, expenses, charges, fr],
  )
  const current: MonthBucket = series[series.length - 1]

  const contractRows = useMemo(() => smoothedContracts(engagements), [engagements])
  const contractsMonthly = sumMonthly(contractRows)
  const ledgerAverage = useMemo(() => averageLedger(series), [series])
  const smoothedTotal = contractsMonthly + ledgerAverage

  const electric = isElectric(vehicle.energy_type)
  const energyUnit = electric ? "kWh" : fr ? "l" : "l"
  const energyQty = electric ? current.kwh : current.liters
  const hasEnergyHistory = series.some((b) => (electric ? b.kwh : b.liters) > 0)

  // Chart rows: one per month, with the energy quantity and its average unit
  // price so both series can share the same x-axis.
  const chartRows = useMemo(
    () => series.map((b) => {
      const qty = electric ? b.kwh : b.liters
      return {
        label: b.label,
        [fr ? "Contrats" : "Contracts"]: Math.round(b.contracts * 100) / 100,
        [fr ? "Carnet" : "Expenses"]: Math.round(b.ledger * 100) / 100,
        qty: Math.round(qty * 100) / 100,
        unitPrice: qty > 0 ? Math.round((b.energyCost / qty) * 1000) / 1000 : null,
      }
    }),
    [series, electric, fr],
  )

  const contractsLabel = fr ? "Contrats" : "Contracts"
  const ledgerLabel = fr ? "Carnet" : "Expenses"

  // Everything falling due in the next quarter: contract instalments and the
  // service/tire reminders carried by the expense book.
  const upcoming = useMemo(() => {
    const rows: { key: string; label: string; detail: string; date: string; days: number }[] = []
    for (const e of engagements) {
      if (e.status !== "active" || !e.next_due_date) continue
      const days = daysUntil(e.next_due_date)
      if (days < 0 || days > UPCOMING_DAYS) continue
      rows.push({
        key: `eng-${e.id}`,
        label: e.name,
        detail: e.current_amount != null ? formatPrice(e.current_amount, e.currency) : "",
        date: e.next_due_date,
        days,
      })
    }
    for (const x of expenses) {
      if (!x.next_due_date && x.next_due_km == null) continue
      const days = x.next_due_date ? daysUntil(x.next_due_date) : null
      if (days != null && (days < 0 || days > UPCOMING_DAYS)) continue
      // A km-only reminder has no date: keep it, sorted last.
      rows.push({
        key: `exp-${x.id}`,
        label: x.description || categoryTitle(x.category, fr),
        detail: x.next_due_km != null ? `${x.next_due_km.toLocaleString("fr-CH")} km` : "",
        date: x.next_due_date ?? "",
        days: days ?? Number.MAX_SAFE_INTEGER,
      })
    }
    return rows.sort((a, b) => a.days - b.days).slice(0, 6)
  }, [engagements, expenses, fr])

  const detail = (label: string, value: React.ReactNode) => (
    value ? (
      <div className="space-y-0.5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm font-medium">{value}</div>
      </div>
    ) : null
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
      </div>
    )
  }

  const monthName = new Date().toLocaleDateString(fr ? "fr-CH" : "en-GB", { month: "long" })

  return (
    <div className="space-y-4">
      {/* --- What this month actually costs --- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={electric ? Zap : Fuel}
          label={electric ? (fr ? "Recharge" : "Charging") : (fr ? "Carburant" : "Fuel")}
          value={`${energyQty.toLocaleString("fr-CH", { maximumFractionDigits: 1 })} ${energyUnit}`}
          hint={current.energyCost > 0 ? formatPrice(current.energyCost) : undefined}
        />
        <Kpi
          icon={Receipt}
          label={fr ? "Carnet du mois" : "Expense book"}
          value={formatPrice(current.ledger)}
          hint={fr ? `en ${monthName}` : `in ${monthName}`}
        />
        <Kpi
          icon={Wallet}
          label={fr ? "Contrats du mois" : "Contracts due"}
          value={formatPrice(current.contracts)}
          hint={fr ? "échéances tombant ce mois" : "instalments due this month"}
        />
        <Kpi
          icon={TrendingUp}
          label={fr ? "Total du mois" : "Month total"}
          value={formatPrice(current.total)}
          highlight
        />
      </div>

      {/* --- What it really costs, yearly contracts spread out --- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {fr ? "Coût mensuel moyen" : "Average monthly cost"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-bold tabular-nums">{formatPrice(smoothedTotal)}</span>
            <span className="text-sm text-muted-foreground">
              {fr ? "par mois, contrats annuels lissés" : "per month, yearly contracts spread out"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {contractRows.map((c) => (
              <Badge key={c.id} variant="outline" className="gap-1 py-1 font-normal">
                {c.name} · <span className="font-semibold">{formatPrice(c.monthly)}</span>/{fr ? "mois" : "mo"}
              </Badge>
            ))}
            {ledgerAverage > 0 && (
              <Badge variant="outline" className="gap-1 py-1 font-normal">
                {fr ? "Carnet (moy. 3 mois)" : "Expense book (3-mo avg)"} ·{" "}
                <span className="font-semibold">{formatPrice(ledgerAverage)}</span>/{fr ? "mois" : "mo"}
              </Badge>
            )}
            {contractRows.length === 0 && ledgerAverage === 0 && (
              <p className="text-sm text-muted-foreground">
                {fr
                  ? "Rattachez un leasing ou une assurance, ou saisissez une dépense, pour voir le coût réel de ce véhicule."
                  : "Link a leasing or insurance contract, or log an expense, to see this vehicle's real cost."}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* --- 12 months: real outflow vs the smoothed line --- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {fr ? "12 derniers mois" : "Last 12 months"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" className="fill-muted-foreground text-xs" />
              <YAxis className="fill-muted-foreground text-xs" />
              <Tooltip
                formatter={(v) => formatPrice(Number(v))}
                contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }}
              />
              <Legend />
              <Bar dataKey={contractsLabel} stackId="a" fill={COLOR_CONTRACTS} radius={[0, 0, 0, 0]} />
              <Bar dataKey={ledgerLabel} stackId="a" fill={COLOR_LEDGER} radius={[4, 4, 0, 0]} />
              {smoothedTotal > 0 && (
                <ReferenceLine
                  y={smoothedTotal}
                  stroke="var(--color-muted-foreground)"
                  strokeDasharray="4 4"
                  label={{
                    value: fr ? "coût moyen" : "average",
                    position: "insideTopRight",
                    className: "fill-muted-foreground text-xs",
                  }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-muted-foreground">
            {fr
              ? "Barres : ce qui est réellement dû chaque mois. Pointillé : le coût mensuel moyen une fois les contrats annuels répartis."
              : "Bars: what is actually due each month. Dashed line: the average monthly cost once yearly contracts are spread out."}
          </p>
        </CardContent>
      </Card>

      {/* --- Energy --- */}
      {hasEnergyHistory && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {electric ? <Zap className="h-4 w-4" /> : <Fuel className="h-4 w-4" />}
              {electric ? (fr ? "Recharge par mois" : "Charging per month") : (fr ? "Carburant par mois" : "Fuel per month")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={chartRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" className="fill-muted-foreground text-xs" />
                <YAxis yAxisId="qty" className="fill-muted-foreground text-xs" />
                <YAxis yAxisId="price" orientation="right" className="fill-muted-foreground text-xs" />
                <Tooltip
                  formatter={(v, name) =>
                    name === energyUnit
                      ? `${Number(v).toLocaleString("fr-CH")} ${energyUnit}`
                      : `${Number(v).toLocaleString("fr-CH")} CHF/${energyUnit}`
                  }
                  contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }}
                />
                <Legend />
                <Bar yAxisId="qty" dataKey="qty" name={energyUnit} fill={COLOR_ENERGY} radius={[4, 4, 0, 0]} />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="unitPrice"
                  name={`CHF/${energyUnit}`}
                  stroke={COLOR_CONTRACTS}
                  strokeWidth={2}
                  connectNulls
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* --- Coming up --- */}
      {upcoming.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" />
              {fr ? "À prévoir" : "Coming up"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.map((u) => (
              <div key={u.key} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{u.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {u.date ? formatDate(u.date) : fr ? "au kilométrage" : "by odometer"}
                    {u.date && u.days <= UPCOMING_DAYS ? ` · ${fr ? "dans" : "in"} ${u.days} j` : ""}
                  </p>
                </div>
                {u.detail && <span className="shrink-0 text-sm font-semibold tabular-nums">{u.detail}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* --- Identity --- */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">{fr ? "Identité" : "Identity"}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {detail(fr ? "Marque" : "Make", vehicle.make)}
          {detail(fr ? "Modèle" : "Model", vehicle.model)}
          {detail(fr ? "Genre" : "Category", categoryLabel(vehicle.category, fr))}
          {detail(fr ? "Motorisation" : "Energy", vehicle.energy_type ? energyLabel(vehicle.energy_type, fr) : null)}
          {detail(fr ? "Plaque" : "Plate", vehicle.plate)}
          {detail(fr ? "Canton" : "Canton", vehicle.canton)}
          {detail("VIN", vehicle.vin)}
          {detail(fr ? "N° matricule" : "Registration no.", vehicle.registration_number)}
          {detail(fr ? "1re mise en circulation" : "First registration", vehicle.first_registration ? formatDate(vehicle.first_registration) : null)}
          {detail(fr ? "Puissance" : "Power", vehicle.power_kw ? `${vehicle.power_kw} kW` : null)}
          {detail(fr ? "Batterie" : "Battery", vehicle.battery_kwh ? `${vehicle.battery_kwh} kWh` : null)}
          {detail(fr ? "Couleur" : "Color", vehicle.color)}
          {detail(fr ? "Km actuel" : "Odometer", vehicle.odometer_km != null ? `${vehicle.odometer_km.toLocaleString("fr-CH")} km` : null)}
          {detail(fr ? "Date d'achat" : "Purchase date", vehicle.purchase_date ? formatDate(vehicle.purchase_date) : null)}
          {detail(fr ? "Prix d'achat" : "Purchase price", vehicle.purchase_price != null ? formatPrice(vehicle.purchase_price) : null)}
        </CardContent>
      </Card>

      {vehicle.notes && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">{fr ? "Notes" : "Notes"}</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-wrap text-sm">{vehicle.notes}</p></CardContent>
        </Card>
      )}
    </div>
  )
}

function Kpi({
  icon: Icon, label, value, hint, highlight,
}: {
  icon: typeof Gauge
  label: string
  value: string
  hint?: string
  highlight?: boolean
}) {
  return (
    <Card className={highlight ? "border-primary/40 bg-primary/5" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}

/// Local label for an expense category, used when a reminder has no
/// description of its own.
function categoryTitle(category: api.VehicleExpenseCategory, fr: boolean): string {
  return expenseLabels[category]?.[fr ? 0 : 1] ?? category
}

const expenseLabels: Partial<Record<api.VehicleExpenseCategory, [string, string]>> = {
  maintenance: ["Entretien", "Maintenance"],
  tires: ["Pneus", "Tires"],
  inspection: ["Contrôle technique", "Inspection"],
  repair: ["Réparation", "Repair"],
  vignette: ["Vignette", "Vignette"],
  tax: ["Taxe véhicule", "Vehicle tax"],
}
