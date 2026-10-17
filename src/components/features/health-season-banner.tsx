import { useContext, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { HeartPulse } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { I18nContext } from "@/lib/i18n"
import { formatDate, formatPrice, daysUntil, cn } from "@/lib/utils"
import { decisionLabel } from "@/lib/health"
import * as api from "@/lib/tauri"

/// The yearly Swiss ritual, in one card: from the publication of the new
/// premiums (late September) to the 31 December, every basic policy of the
/// household with its premium notice — received or not, decided or not — and
/// the countdown to the 30 November. Hidden the rest of the year.
export function HealthSeasonBanner() {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const [season, setSeason] = useState<api.HealthSeason | null>(null)

  useEffect(() => { api.getHealthSeason().then(setSeason).catch(() => setSeason(null)) }, [])

  if (!season || !season.open) return null
  const basics = season.policies.filter((p) => p.kind !== "supplementary")
  if (basics.length === 0) return null

  const next = season.season_year + 1
  const switchEvent = season.events.find((e) => e.key === "switch_insurer")
  const raiseEvent = season.events.find((e) => e.key === "raise_franchise")
  const days = switchEvent ? daysUntil(switchEvent.working_date) : null
  const pending = basics.filter((p) => !p.notice || p.notice.decision === "pending").length

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-3">
        <HeartPulse className="h-5 w-5 text-primary" />
        <CardTitle className="text-base">{fr ? `Primes maladie ${next}` : `${next} health premiums`}</CardTitle>
        {pending > 0 && <Badge variant="warning" className="ml-auto">{pending} {fr ? "à décider" : "to decide"}</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {season.params.ofsp_average_change_pct != null && (
            <>{fr ? `Hausse moyenne annoncée par l'OFSP : ` : "FOPH average increase: "}
              <span className="font-medium text-foreground">{season.params.ofsp_average_change_pct >= 0 ? "+" : ""}{season.params.ofsp_average_change_pct.toFixed(1)} %</span>. </>
          )}
          {switchEvent && days != null && days >= 0 && (
            <>{fr ? "Changer de caisse ou baisser sa franchise : lettre reçue au plus tard le " : "Switch insurer or lower the deductible: letter received by "}
              <span className={cn("font-medium", days <= 14 ? "text-destructive" : "text-foreground")}>{formatDate(switchEvent.working_date)}</span>
              {" "}({fr ? `J-${days}` : `${days} days`}).</>
          )}
          {switchEvent && days != null && days < 0 && raiseEvent && (
            <>{fr ? "Le délai du 30 novembre est passé ; augmenter sa franchise reste possible jusqu'au " : "The 30 November deadline has passed; raising the deductible is still possible until "}
              {formatDate(raiseEvent.working_date)}.</>
          )}
        </p>
        <div className="space-y-2">
          {basics.map((p) => (
            <Link key={p.engagement_id} to={`/engagements/${p.engagement_id}?tab=health`}
              className="flex items-center justify-between gap-3 rounded-md border bg-background p-3 hover:bg-accent/40">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.insured_label ?? p.name}</p>
                <p className="text-xs text-muted-foreground">{p.creditor_name ?? "—"}{p.franchise != null ? ` · franchise ${p.franchise.toLocaleString("fr-CH")} CHF` : ""}</p>
              </div>
              <div className="text-right text-xs">
                {p.notice?.monthly_premium != null
                  ? <p className="font-medium">{formatPrice(p.notice.monthly_premium)} / {fr ? "mois" : "month"}</p>
                  : <p className="text-amber-700 dark:text-amber-400">{fr ? "Avis de prime à saisir" : "Premium notice to enter"}</p>}
                <p className="text-muted-foreground">{decisionLabel(p.notice?.decision ?? "pending", fr)}</p>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
