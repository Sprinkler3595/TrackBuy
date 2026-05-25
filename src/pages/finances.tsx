import { useEffect, useMemo, useState, useContext } from "react"
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  AreaChart, Area,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from "recharts"
import { TrendingUp, TrendingDown, Wallet, BarChart3, PieChart as PieIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatPrice, DEFAULT_CURRENCY } from "@/lib/utils"
import { monthlyEquivalent } from "@/lib/finance"
import { MaskedAmount, VisibilityToggle, useAmountsVisible } from "@/components/features/amount-masked"
import { I18nContext, type TranslationKeys } from "@/lib/i18n"
import * as api from "@/lib/tauri"

// Discrete colour palette used across every chart. Reuses Tailwind-ish hues
// so dark/light mode stays readable without per-mode overrides.
const COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
  "#6366f1", "#84cc16", "#06b6d4", "#a855f7",
]

/// Merge multiple `{month, total}` series into a single dataset keyed by
/// month. Each input contributes one column under its label name. Missing
/// months on either side default to 0 so the area/line chart stays
/// continuous. The output is sorted lexicographically by month, which is
/// safe because we use `YYYY-MM`.
function mergeMonthlySeries(
  series: Record<string, Array<{ month: string; total: number }>>
): Array<Record<string, string | number>> {
  const months = new Set<string>()
  Object.values(series).forEach((rows) => rows.forEach((r) => months.add(r.month)))
  const sorted = Array.from(months).sort()
  return sorted.map((month) => {
    const row: Record<string, string | number> = { month }
    for (const [label, rows] of Object.entries(series)) {
      const found = rows.find((r) => r.month === month)
      row[label] = found?.total ?? 0
    }
    return row
  })
}

/// Pivot YoY data from one row per (engagement, year) into a single dataset
/// per engagement that recharts can plot as a grouped bar chart. Each output
/// row is `{ engagement, [year]: total, ... }`. Empty cells become 0.
function pivotYoyByCategory(
  engagementsByType: api.Stats["engagements_by_type"],
  yoy: api.YoyEngagement[],
): { years: string[]; rows: Array<Record<string, string | number>> } {
  // We aggregate at the engagement_type level (not per individual
  // engagement) so the chart fits a few bars per category. Re-derive type
  // from yoy.name lookups would be brittle — instead, sum yoy.series by year
  // for ALL engagements and rely on engagementsByType for the total.
  // Simpler: derive category total per year by summing all engagements'
  // series. The grouped bar then shows totals per year across the whole
  // expense base. For per-category, see the dedicated section below.
  const yearSet = new Set<string>()
  for (const e of yoy) for (const s of e.series) yearSet.add(s.year)
  const years = Array.from(yearSet).sort()
  // For the simple "total annual expenses" comparison we just sum yoy.
  const totalByYear: Record<string, number> = {}
  for (const e of yoy) {
    for (const s of e.series) {
      totalByYear[s.year] = (totalByYear[s.year] ?? 0) + s.total
    }
  }
  void engagementsByType // kept for future per-category breakdown
  const rows = [
    {
      engagement: "Total",
      ...years.reduce<Record<string, number>>((acc, y) => {
        acc[y] = totalByYear[y] ?? 0
        return acc
      }, {}),
    },
  ]
  return { years, rows }
}

export function FinancesPage() {
  const { t } = useContext(I18nContext)
  const [stats, setStats] = useState<api.Stats | null>(null)
  const [incomes, setIncomes] = useState<api.Income[]>([])
  const [engagements, setEngagements] = useState<api.Engagement[]>([])
  const [subs, setSubs] = useState<api.Subscription[]>([])
  const [upcomingCharges, setUpcomingCharges] = useState<api.EngagementCharge[]>([])
  const [selectedEngagementId, setSelectedEngagementId] = useState<string>("")
  const [engagementCharges, setEngagementCharges] = useState<api.EngagementCharge[]>([])
  const [windowMonths, setWindowMonths] = useState<12 | 24>(12)
  const [amountsVisible, setAmountsVisible] = useAmountsVisible()
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const [statsData, incData, engData, subsData, chargesData] = await Promise.all([
        api.getStats(windowMonths, DEFAULT_CURRENCY),
        api.getIncomes({ status: "active" }),
        api.getEngagements({ status: "active" }),
        api.getSubscriptions({ status: "active" }),
        api.getUpcomingEngagementCharges(30),
      ])
      setStats(statsData)
      setIncomes(incData)
      setEngagements(engData)
      setSubs(subsData)
      setUpcomingCharges(chargesData)
      if (!selectedEngagementId && engData.length > 0) {
        setSelectedEngagementId(engData[0].id)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [windowMonths])

  useEffect(() => {
    if (!selectedEngagementId) return
    api.getEngagementCharges(selectedEngagementId).then(setEngagementCharges).catch(() => setEngagementCharges([]))
  }, [selectedEngagementId])

  // --------- Derived KPIs (monthly equivalents on the live entities) ---------

  const monthlyIncome = useMemo(() => incomes
    .filter((i) => i.current_amount != null && i.billing_cycle !== "one_shot")
    .reduce((acc, i) => acc + monthlyEquivalent(i.current_amount as number, i.billing_cycle, i.cycle_interval), 0),
    [incomes],
  )

  const monthlyEngagement = useMemo(() => engagements
    .filter((e) => e.current_amount != null && e.billing_cycle !== "one_shot")
    .reduce((acc, e) => acc + monthlyEquivalent(e.current_amount as number, e.billing_cycle, e.cycle_interval), 0),
    [engagements],
  )

  const monthlySubs = useMemo(() => subs.reduce((acc, s) => {
    const n = Math.max(1, s.cycle_interval)
    switch (s.billing_cycle) {
      case "monthly":   return acc + s.price / n
      case "quarterly": return acc + s.price / (3 * n)
      case "yearly":    return acc + s.price / (12 * n)
      case "custom":    return acc + (s.price / n) * 30.44
    }
    return acc
  }, 0), [subs])

  const totalMonthlyExpense = monthlyEngagement + monthlySubs
  const ratio = monthlyIncome > 0 ? (totalMonthlyExpense / monthlyIncome) * 100 : 0
  const remaining = monthlyIncome - totalMonthlyExpense
  const dueIn30 = upcomingCharges.reduce((acc, c) => acc + c.amount, 0)

  // ----- Chart-friendly merges of the backend per-month series -----

  const expenseVsIncome = useMemo(() => {
    if (!stats) return []
    return mergeMonthlySeries({
      Revenus: stats.monthly_incomes,
      Dépenses: [
        ...stats.monthly_engagements,
        ...stats.monthly_subscriptions,
        ...stats.monthly_spending,
      ].reduce<Array<{ month: string; total: number }>>((acc, row) => {
        const existing = acc.find((r) => r.month === row.month)
        if (existing) existing.total += row.total
        else acc.push({ ...row })
        return acc
      }, []),
    })
  }, [stats])

  const stackedSpending = useMemo(() => {
    if (!stats) return []
    return mergeMonthlySeries({
      Engagements: stats.monthly_engagements,
      Abonnements: stats.monthly_subscriptions,
      Achats: stats.monthly_spending,
    })
  }, [stats])

  // ----- Donut by category : group canonical types into broader buckets -----

  const CATEGORY_GROUPS: Record<string, string[]> = {
    Assurances: ["insurance_health", "insurance_household", "insurance_car", "insurance_life", "insurance_legal", "insurance_other"],
    Logement:   ["rent", "parking", "mortgage"],
    Véhicule:   ["leasing", "fuel"],
    Fluides:    ["electricity", "gas", "water", "heating"],
    Télécom:    ["phone", "internet", "tv_radio"],
    Fiscalité:  ["tax_federal", "tax_cantonal", "tax_communal", "tax_other", "fine", "fee"],
    Autres:     ["membership", "other"],
  }

  const donutData = useMemo(() => {
    if (!stats) return []
    const buckets: Record<string, number> = {}
    for (const row of stats.engagements_by_type) {
      const bucket = Object.entries(CATEGORY_GROUPS).find(([, types]) => types.includes(row.type))?.[0] ?? "Autres"
      buckets[bucket] = (buckets[bucket] ?? 0) + row.total
    }
    // Append online subscriptions and one-off items as their own slices so
    // the donut covers 100% of the monetary base, not just engagements.
    const subsTotal = stats.monthly_subscriptions.reduce((a, r) => a + r.total, 0)
    const itemsTotal = stats.monthly_spending.reduce((a, r) => a + r.total, 0)
    if (subsTotal > 0) buckets["Abos en ligne"] = subsTotal
    if (itemsTotal > 0) buckets["Achats"] = itemsTotal
    return Object.entries(buckets)
      .map(([name, value]) => ({ name, value }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [stats])

  // ----- Price evolution for one engagement -----

  const priceEvolution = useMemo(() => {
    return engagementCharges
      .slice() // copy then sort ascending so the line goes left → right
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .map((c) => ({
        date: c.due_date,
        // Use unit_price when available (kWh, m³, …) — otherwise the snapshot
        // amount. Lets fluides plots stay meaningful even when the volume
        // varies month-to-month.
        prix: c.unit_price ?? c.amount,
        unit: c.unit,
      }))
  }, [engagementCharges])

  // ----- YoY -----

  const yoyData = useMemo(() => {
    if (!stats) return { years: [], rows: [] }
    return pivotYoyByCategory(stats.engagements_by_type, stats.yoy_by_engagement)
  }, [stats])

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const fmt = (v: number) => formatPrice(v)
  // Recharts v3's `Formatter` is a complex generic that we don't need to
  // narrow; cast to any keeps the tooltip code short without losing safety
  // — `formatPrice` already accepts any numeric input.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tooltipFormatter: any = (value: number | string) =>
    typeof value === "number" ? fmt(value) : value

  const selectedEngagement = engagements.find((e) => e.id === selectedEngagementId)
  const engagementTypeKey = (typ: string): keyof TranslationKeys => `engagements.type.${typ}` as keyof TranslationKeys

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Finances</h2>
          <p className="text-muted-foreground">
            Analyse {windowMonths} mois — revenus, dépenses, ratios et évolution des prix
          </p>
          {stats && (
            <p className="text-xs text-muted-foreground mt-1">
              Devise affichée : <span className="font-medium">{stats.display_currency}</span>
              {" — les montants saisis dans une autre devise ne sont pas inclus."}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <VisibilityToggle
            visible={amountsVisible}
            onChange={setAmountsVisible}
            labelShow={t("incomes.showAmounts")}
            labelHide={t("incomes.hideAmounts")}
          />
          <div className="inline-flex rounded-md border">
            <Button
              variant={windowMonths === 12 ? "default" : "ghost"}
              size="sm"
              className="rounded-r-none"
              onClick={() => setWindowMonths(12)}
            >12 mois</Button>
            <Button
              variant={windowMonths === 24 ? "default" : "ghost"}
              size="sm"
              className="rounded-l-none"
              onClick={() => setWindowMonths(24)}
            >24 mois</Button>
          </div>
        </div>
      </div>

      {/* 1. KPI grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenu mensuel net</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <MaskedAmount amount={monthlyIncome} currency="CHF" visible={amountsVisible} />
            </div>
            <p className="text-xs text-muted-foreground">{incomes.length} source(s)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Dépense mensuelle</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <MaskedAmount amount={totalMonthlyExpense} currency="CHF" visible={amountsVisible} />
            </div>
            <p className="text-xs text-muted-foreground">Engagements + abos en ligne</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ratio dépenses</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${ratio > 100 ? "text-destructive" : ratio > 80 ? "text-amber-600 dark:text-amber-500" : ""}`}>
              {ratio.toFixed(1)} %
            </div>
            <p className="text-xs text-muted-foreground">/ revenu net</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reste à vivre</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${remaining < 0 ? "text-destructive" : ""}`}>
              <MaskedAmount amount={remaining} currency="CHF" visible={amountsVisible} />
            </div>
            <p className="text-xs text-muted-foreground">Avant achats ponctuels</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">À payer 30j</CardTitle>
            <PieIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmt(dueIn30)}</div>
            <p className="text-xs text-muted-foreground">{upcomingCharges.length} facture(s)</p>
          </CardContent>
        </Card>
      </div>

      {/* 2. Revenus vs dépenses */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Revenus vs dépenses ({windowMonths} mois)</CardTitle></CardHeader>
        <CardContent>
          {expenseVsIncome.length === 0 ? (
            <p className="text-sm text-muted-foreground">Pas encore de données sur la période.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={expenseVsIncome}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" className="fill-muted-foreground text-xs" />
                <YAxis className="fill-muted-foreground text-xs" />
                <Tooltip formatter={tooltipFormatter} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Line type="monotone" dataKey="Revenus" stroke={COLORS[1]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Dépenses" stroke={COLORS[3]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 3. Évolution mensuelle empilée */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Évolution des dépenses par catégorie</CardTitle></CardHeader>
        <CardContent>
          {stackedSpending.length === 0 ? (
            <p className="text-sm text-muted-foreground">Pas encore de dépenses enregistrées.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={stackedSpending}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" className="fill-muted-foreground text-xs" />
                <YAxis className="fill-muted-foreground text-xs" />
                <Tooltip formatter={tooltipFormatter} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Area type="monotone" dataKey="Engagements" stackId="1" stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.5} />
                <Area type="monotone" dataKey="Abonnements" stackId="1" stroke={COLORS[4]} fill={COLORS[4]} fillOpacity={0.5} />
                <Area type="monotone" dataKey="Achats" stackId="1" stroke={COLORS[2]} fill={COLORS[2]} fillOpacity={0.5} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 4. Donut par catégorie */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Répartition par catégorie</CardTitle></CardHeader>
          <CardContent>
            {donutData.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune dépense sur la période.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                    {donutData.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={tooltipFormatter} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 7. Top créanciers (placé à côté du donut pour économiser l'espace) */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Top créanciers</CardTitle></CardHeader>
          <CardContent>
            {stats.top_creditors.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun créancier référencé.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats.top_creditors} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" className="fill-muted-foreground text-xs" />
                  <YAxis type="category" dataKey="name" width={120} className="fill-muted-foreground text-xs" />
                  <Tooltip formatter={tooltipFormatter} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="total" fill={COLORS[0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 5. Évolution du prix d'un engagement */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-lg">Évolution du prix d'un engagement</CardTitle>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={selectedEngagementId}
              onChange={(e) => setSelectedEngagementId(e.target.value)}
            >
              {engagements.length === 0 && <option value="">— aucun engagement —</option>}
              {engagements.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          {selectedEngagement && (
            <p className="text-xs text-muted-foreground">
              {t(engagementTypeKey(selectedEngagement.engagement_type))}
              {selectedEngagement.creditor_name && ` · ${selectedEngagement.creditor_name}`}
              {priceEvolution[0]?.unit && ` · prix par ${priceEvolution[0].unit}`}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {priceEvolution.length < 2 ? (
            <p className="text-sm text-muted-foreground">Pas assez d'échéances enregistrées pour tracer une courbe.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={priceEvolution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="fill-muted-foreground text-xs" />
                <YAxis domain={["auto", "auto"]} className="fill-muted-foreground text-xs" />
                <Tooltip formatter={tooltipFormatter} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Line type="stepAfter" dataKey="prix" stroke={COLORS[5]} strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 6. YoY total annuel des dépenses (engagements). Requires at least
          two distinct years in the window to be useful. */}
      {yoyData.years.length >= 2 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Comparatif annuel des engagements</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={yoyData.rows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="engagement" className="fill-muted-foreground text-xs" />
                <YAxis className="fill-muted-foreground text-xs" />
                <Tooltip formatter={tooltipFormatter} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                {yoyData.years.map((year, idx) => (
                  <Bar key={year} dataKey={year} fill={COLORS[idx % COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
