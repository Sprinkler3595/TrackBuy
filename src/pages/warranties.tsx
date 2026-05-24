import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Shield, Search, ExternalLink, AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatDate, daysUntil } from "@/lib/utils"
import * as api from "@/lib/tauri"

type Filter = "all" | "active" | "expiring" | "expired"

function computeEndDate(start: string, months: number): string {
  const d = new Date(start)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

export function WarrantiesPage() {
  const [warranties, setWarranties] = useState<api.Warranty[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const list = await api.getWarranties()
        if (!alive) return
        setWarranties(list)
      } catch (e) {
        console.error(e)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const enriched = useMemo(() => {
    return warranties.map((w) => {
      const end = w.end_date ?? computeEndDate(w.start_date, w.duration_months)
      return { ...w, end_date: end, days_left: daysUntil(end) }
    })
  }, [warranties])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return enriched.filter((w) => {
      if (q && !(w.item_description ?? "").toLowerCase().includes(q) &&
          !(w.notes ?? "").toLowerCase().includes(q)) return false
      switch (filter) {
        case "active": return w.days_left > 30
        case "expiring": return w.days_left >= 0 && w.days_left <= 30
        case "expired": return w.days_left < 0
        default: return true
      }
    }).sort((a, b) => a.days_left - b.days_left)
  }, [enriched, query, filter])

  const counts = useMemo(() => ({
    all: enriched.length,
    active: enriched.filter(w => w.days_left > 30).length,
    expiring: enriched.filter(w => w.days_left >= 0 && w.days_left <= 30).length,
    expired: enriched.filter(w => w.days_left < 0).length,
  }), [enriched])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Shield className="h-7 w-7" /> Garanties
        </h1>
        <p className="text-muted-foreground mt-1">
          Toutes les garanties associées à tes achats.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          ["all", "Toutes", counts.all],
          ["active", "Actives", counts.active],
          ["expiring", "Bientôt expirées", counts.expiring],
          ["expired", "Expirées", counts.expired],
        ] as const).map(([key, label, n]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-xl border p-4 text-left transition-colors ${
              filter === key ? "border-primary bg-accent" : "hover:bg-accent/50"
            }`}
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="text-2xl font-bold mt-1">{n}</div>
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher une garantie…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground py-12">Chargement…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Aucune garantie ne correspond aux filtres.
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y rounded-lg border bg-card">
          {filtered.map((w) => {
            const status = w.days_left < 0
              ? { label: "Expirée", variant: "destructive" as const }
              : w.days_left <= 30
                ? { label: `${w.days_left} j`, variant: "secondary" as const }
                : { label: "Active", variant: "default" as const }
            return (
              <Link
                key={w.id}
                to={`/items/${w.item_id}`}
                className="flex items-center gap-4 px-4 py-2.5 hover:bg-accent/40 transition-colors"
              >
                {w.days_left >= 0 && w.days_left <= 30 ? (
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                ) : (
                  <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{w.item_description ?? "Article inconnu"}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {formatDate(w.start_date)} → {formatDate(w.end_date)} · {w.duration_months} mois
                    {w.notes && ` · ${w.notes}`}
                  </div>
                </div>
                <Badge variant={status.variant} className="shrink-0">{status.label}</Badge>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
