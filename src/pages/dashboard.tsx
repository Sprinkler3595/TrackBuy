import { useEffect, useState } from "react"
import { ShoppingBag, Shield, DollarSign, TrendingUp, Bell, Calendar, Tag, Repeat } from "lucide-react"
import { Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatPrice, formatDate, daysUntil } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// Normalise a subscription's price to its per-month equivalent so the
/// "monthly cost" KPI can sum heterogeneous billing cycles.
function monthlyEquivalent(s: api.Subscription): number {
  const interval = Math.max(1, s.cycle_interval)
  switch (s.billing_cycle) {
    case "monthly": return s.price / interval
    case "quarterly": return s.price / (3 * interval)
    case "yearly": return s.price / (12 * interval)
    case "custom": return (s.price / interval) * 30.44
    default: return s.price
  }
}

export function DashboardPage() {
  const [items, setItems] = useState<api.Item[]>([])
  const [expiring, setExpiring] = useState<api.Warranty[]>([])
  const [reminders, setReminders] = useState<api.Reminder[]>([])
  const [stats, setStats] = useState<api.Stats | null>(null)
  const [renewals, setRenewals] = useState<api.Subscription[]>([])
  const [subs, setSubs] = useState<api.Subscription[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [itemsData, expiringData, remindersData, statsData, renewalsData, subsData] = await Promise.all([
          api.getItems(),
          api.getExpiringWarranties(30),
          api.getUpcomingReminders(30),
          api.getStats(),
          api.getUpcomingRenewals(30),
          api.getSubscriptions({ status: "active" }),
        ])
        setItems(itemsData)
        setExpiring(expiringData)
        setReminders(remindersData)
        setStats(statsData)
        setRenewals(renewalsData)
        setSubs(subsData)
      } catch (err) {
        console.error("Failed to load dashboard:", err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const activeItems = items.filter((i) => i.status === "active")
  const totalValue = activeItems.reduce((sum, i) => sum + i.purchase_price, 0)
  const recentItems = [...items].slice(0, 5)
  const monthlyCost = subs.reduce((sum, s) => sum + monthlyEquivalent(s), 0)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Tableau de bord</h2>
        <p className="text-muted-foreground">Vue d'ensemble de vos achats</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total articles</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{items.length}</div>
            <p className="text-xs text-muted-foreground">{activeItems.length} actifs</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valeur totale</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPrice(totalValue)}</div>
            <p className="text-xs text-muted-foreground">Articles actifs</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Coût mensuel abos</CardTitle>
            <Repeat className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPrice(monthlyCost)}</div>
            <p className="text-xs text-muted-foreground">{subs.length} abonnement(s) actif(s)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Garanties expirantes</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{expiring.length > 0 ? expiring.length : "0"}</div>
            <p className="text-xs text-muted-foreground">Dans 30 jours · {expiring.filter((w) => daysUntil(w.end_date!) <= 7).length} urgent(es)</p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly spending chart */}
      {stats && stats.monthly_spending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Dépenses mensuelles
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-40">
              {(() => {
                const data = stats.monthly_spending
                const maxVal = Math.max(...data.map((d) => d.total), 1)
                return data.map((d) => {
                  const height = (d.total / maxVal) * 100
                  const label = d.month.substring(5) // "MM" from "YYYY-MM"
                  const months = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"]
                  const monthLabel = months[parseInt(label) - 1] || label
                  return (
                    <div key={d.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {formatPrice(d.total)}
                      </span>
                      <div
                        className="w-full rounded-t bg-primary/80 hover:bg-primary transition-colors min-h-[4px]"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${d.month}: ${formatPrice(d.total)}`}
                      />
                      <span className="text-[10px] text-muted-foreground">{monthLabel}</span>
                    </div>
                  )
                })
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Achats récents</CardTitle>
          </CardHeader>
          <CardContent>
            {recentItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun achat enregistré</p>
            ) : (
              <div className="space-y-3">
                {recentItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium text-sm">{item.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.merchant_name} &middot; {formatDate(item.purchase_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-sm">{formatPrice(item.purchase_price, item.currency)}</p>
                      <Badge variant={item.status === "active" ? "success" : "secondary"} className="text-[10px]">
                        {item.status === "active" ? "Actif" : "Archivé"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expiring warranties */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Garanties bientôt expirées</CardTitle>
          </CardHeader>
          <CardContent>
            {expiring.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune garantie n'expire prochainement</p>
            ) : (
              <div className="space-y-3">
                {expiring.map((w) => {
                  const days = daysUntil(w.end_date!)
                  return (
                    <div key={w.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <p className="font-medium text-sm">{w.item_description}</p>
                        <p className="text-xs text-muted-foreground">
                          Expire le {formatDate(w.end_date!)}
                        </p>
                      </div>
                      <Badge variant={days <= 7 ? "destructive" : "warning"}>
                        {days}j restants
                      </Badge>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming subscription renewals — dedicated widget */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Repeat className="h-5 w-5" />
            Renouvellements à venir
          </CardTitle>
        </CardHeader>
        <CardContent>
          {renewals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun renouvellement prévu dans les 30 prochains jours</p>
          ) : (
            <div className="space-y-3">
              {renewals.map((s) => {
                const days = daysUntil(s.next_renewal_date)
                const variant = days <= 7 ? "destructive" : days <= 30 ? "warning" : "success"
                return (
                  <Link
                    key={s.id}
                    to={`/subscriptions/${s.id}`}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{s.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {formatDate(s.next_renewal_date)}
                          {s.merchant_name && <> · {s.merchant_name}</>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold">{formatPrice(s.price, s.currency)}</span>
                      <Badge variant={variant}>
                        {days === 0 ? "Aujourd'hui" : `${days}j`}
                      </Badge>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upcoming reminders: events + voucher/license expirations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Rappels à venir
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reminders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun rappel dans les 30 prochains jours</p>
          ) : (
            <div className="space-y-3">
              {reminders.map((r) => {
                const days = r.days_until
                const variant = days <= 7 ? "destructive" : days <= 30 ? "warning" : "success"
                const Icon = r.reminder_type === "event" ? Calendar : r.reminder_type === "renewal" ? Repeat : Tag
                const label = r.reminder_type === "event"
                  ? "Événement"
                  : r.reminder_type === "renewal"
                  ? "Renouvellement"
                  : "Expiration"
                const href = r.entity_type === "subscription"
                  ? `/subscriptions/${r.item_id}`
                  : "/tickets"
                return (
                  <Link
                    key={`${r.entity_type}-${r.item_id}-${r.reminder_type}`}
                    to={href}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{r.description}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {label} le {formatDate(r.target_date)}
                          {r.merchant_name && <> · {r.merchant_name}</>}
                        </p>
                      </div>
                    </div>
                    <Badge variant={variant} className="shrink-0">
                      {days === 0 ? "Aujourd'hui" : `${days}j`}
                    </Badge>
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Spending by merchant */}
      {items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Dépenses par marchand</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(() => {
                const byMerchant = new Map<string, { name: string; total: number; count: number }>()
                for (const item of activeItems) {
                  const name = item.merchant_name || "Inconnu"
                  const existing = byMerchant.get(name) || { name, total: 0, count: 0 }
                  existing.total += item.purchase_price
                  existing.count++
                  byMerchant.set(name, existing)
                }
                const sorted = [...byMerchant.values()].sort((a, b) => b.total - a.total)
                const maxTotal = sorted[0]?.total || 1

                return sorted.slice(0, 8).map((m) => (
                  <div key={m.name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{m.name} <span className="text-muted-foreground font-normal">({m.count})</span></span>
                      <span className="font-semibold">{formatPrice(m.total)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${(m.total / maxTotal) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              })()}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
