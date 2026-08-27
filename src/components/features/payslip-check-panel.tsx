import { useMemo } from "react"
import { AlertTriangle, CheckCircle2, Info, XCircle, ScrollText } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn, formatPrice } from "@/lib/utils"
import type { PayslipFinding, PayslipReport } from "@/lib/tauri"

/// Ordre d'affichage : ce qui cloche d'abord, ce qui est conforme ensuite.
/// Un panneau qui ouvre sur douze lignes vertes fait rater l'erreur en bas.
const SEVERITY_ORDER = { error: 0, warn: 1, info: 2, ok: 3 } as const

const SEVERITY_STYLE = {
  error: {
    Icon: XCircle,
    row: "border-destructive/40 bg-destructive/5",
    icon: "text-destructive",
    label: "Anomalie",
    badge: "destructive" as const,
  },
  warn: {
    Icon: AlertTriangle,
    row: "border-amber-500/40 bg-amber-500/5",
    icon: "text-amber-600 dark:text-amber-500",
    label: "À vérifier",
    badge: "warning" as const,
  },
  info: {
    Icon: Info,
    row: "border-border bg-muted/30",
    icon: "text-muted-foreground",
    label: "Information",
    badge: "secondary" as const,
  },
  ok: {
    Icon: CheckCircle2,
    row: "border-emerald-500/30 bg-emerald-500/5",
    icon: "text-emerald-600 dark:text-emerald-500",
    label: "Conforme",
    badge: "success" as const,
  },
} as const

function FindingRow({
  finding,
  currency,
}: {
  finding: PayslipFinding
  currency: string
}) {
  const style = SEVERITY_STYLE[finding.severity]
  const { Icon } = style
  return (
    <li className={cn("flex gap-3 rounded-lg border p-3", style.row)}>
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", style.icon)} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-medium">{finding.label}</span>
          {/* Un contrôle impossible n'est pas un contrôle réussi : on montre
              l'écart chiffré seulement quand les deux montants existent. */}
          {finding.expected != null && finding.actual != null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatPrice(finding.actual, currency)} vs{" "}
              {formatPrice(finding.expected, currency)}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{finding.message}</p>
        {finding.legal_ref !== "—" && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
            <ScrollText className="h-3 w-3 shrink-0" />
            {finding.legal_ref}
          </p>
        )}
      </div>
    </li>
  )
}

export function PayslipCheckPanel({
  report,
  currency,
  className,
}: {
  report: PayslipReport | null
  currency: string
  className?: string
}) {
  const sorted = useMemo(() => {
    if (!report) return []
    return [...report.findings].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    )
  }, [report])

  const counts = useMemo(() => {
    const c = { error: 0, warn: 0, info: 0, ok: 0 }
    for (const f of sorted) c[f.severity]++
    return c
  }, [sorted])

  if (!report) return null

  const { params, expected } = report

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Contrôle de conformité</CardTitle>
          <div className="flex items-center gap-1.5">
            {counts.error > 0 && (
              <Badge variant="destructive">{counts.error} anomalie{counts.error > 1 ? "s" : ""}</Badge>
            )}
            {counts.warn > 0 && (
              <Badge variant="warning">{counts.warn} à vérifier</Badge>
            )}
            {counts.error === 0 && counts.warn === 0 && (
              <Badge variant="success">Aucune anomalie</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!report.has_contract && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <p className="font-medium">Contrat de travail non renseigné</p>
            <p className="text-muted-foreground mt-1">
              Sans les taux de votre caisse de pension, de l'assurance accidents
              non professionnels et des indemnités journalières, ces retenues ne
              peuvent pas être vérifiées — elles sont contractuelles, aucun barème
              ne permet de les deviner. Remplissez l'onglet « Contrat » pour les
              activer.
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {sorted.map((f) => (
            <FindingRow key={f.id} finding={f} currency={currency} />
          ))}
        </ul>

        {/* Les montants de référence, pour que l'utilisateur puisse refaire le
            calcul à la main plutôt que de croire l'application sur parole. */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs">
          <p className="font-medium text-sm">Bases de calcul</p>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Salaire déterminant AVS</dt>
              <dd className="tabular-nums">{formatPrice(expected.avs_subject_gross, currency)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Cumul annuel avant la période</dt>
              <dd className="tabular-nums">{formatPrice(report.ytd_before, currency)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Assiette AC (plafond {formatPrice(params.ac_ceiling, currency)})</dt>
              <dd className="tabular-nums">{formatPrice(expected.ac_base, currency)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Salaire coordonné LPP</dt>
              <dd className="tabular-nums">
                {expected.lpp_coordinated_salary > 0
                  ? formatPrice(expected.lpp_coordinated_salary, currency)
                  : "—"}
              </dd>
            </div>
            {expected.lpp_minimum_annual_credit > 0 && (
              <div className="flex justify-between gap-2 sm:col-span-2">
                <dt className="text-muted-foreground">
                  Bonification LPP minimale (total employeur + employé)
                </dt>
                <dd className="tabular-nums">
                  {formatPrice(expected.lpp_minimum_annual_credit, currency)} / an
                </dd>
              </div>
            )}
          </dl>
        </div>

        <p className="text-xs text-muted-foreground border-t pt-3">
          Barèmes {params.effective_year}
          {params.estimated && ` appliqués à ${params.year}`} — {params.source}.
          Ce contrôle est indicatif : il ne remplace ni le décompte de votre
          employeur ni l'avis d'une fiduciaire.
        </p>
      </CardContent>
    </Card>
  )
}
