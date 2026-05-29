import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, ChevronRight, Receipt, Users } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatPrice, formatDate } from "@/lib/utils"
import { useToast } from "@/components/ui/toast"
import * as api from "@/lib/tauri"

/// French + EN labels per rubric. Captions show the Swiss-specific rule of
/// thumb so the user remembers WHY each rubric matters for the declaration.
const RUBRIC: Record<
  api.TaxCategory,
  { label: string; caption: string }
> = {
  pro: {
    label: "Frais professionnels",
    caption: "Transports domicile-travail, repas, formation pro, vêtements.",
  },
  medical: {
    label: "Frais médicaux",
    caption:
      "Médecin, dentiste, pharmacie, hospitalisation. Déductible au-dessus de 5% du revenu net imposable.",
  },
  don: {
    label: "Dons",
    caption:
      "Dons à organisations d'utilité publique (au moins 100 CHF, plafond cantonal).",
  },
  entretien: {
    label: "Entretien immeuble",
    caption:
      "Propriétaires : frais d'entretien et de réparation, charges PPE (LFR), primes d'assurance bâtiment.",
  },
  "3a": {
    label: "3ᵉ pilier (3a)",
    caption:
      "Plafond 2024 : 7'056 CHF (salarié avec LPP) ou 35'280 CHF (indépendant sans LPP). 100% déductible.",
  },
  formation: {
    label: "Formation continue",
    caption: "Formation continue à des fins professionnelles (max ≈ 12'000 CHF/an).",
  },
  garde_enfant: {
    label: "Frais de garde d'enfants",
    caption:
      "Crèche, parascolaire, maman de jour. Plafond fédéral 25'500 CHF/enfant (2024), variable au cantonal.",
  },
}

const CATEGORY_ORDER: api.TaxCategory[] = [
  "pro",
  "medical",
  "3a",
  "garde_enfant",
  "don",
  "formation",
  "entretien",
]

function YearPicker({
  year,
  onChange,
}: {
  year: number
  onChange: (y: number) => void
}) {
  const current = new Date().getFullYear()
  const options = Array.from({ length: 6 }, (_, i) => current - i)
  return (
    <select
      value={year}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
      className="rounded-md border bg-background px-3 py-1.5 text-sm font-medium"
    >
      {options.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  )
}

function Rubric({
  bucket,
  year,
}: {
  bucket: api.TaxBucket
  year: number
}) {
  const [expanded, setExpanded] = useState(false)
  const [lines, setLines] = useState<api.TaxLine[] | null>(null)
  const meta = RUBRIC[bucket.category]
  const { toast } = useToast()

  async function toggle() {
    if (!expanded && lines === null) {
      try {
        const l = await api.listTaxLines(year, bucket.category)
        setLines(l)
      } catch (e) {
        toast(String(e), "error")
        return
      }
    }
    setExpanded(!expanded)
  }

  const empty = bucket.count === 0
  return (
    <Card>
      <CardHeader
        className={`cursor-pointer ${empty ? "opacity-60" : ""}`}
        onClick={toggle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </div>
            <div>
              <CardTitle className="text-base">{meta.label}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{meta.caption}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums">
              {formatPrice(bucket.total_chf, "CHF")}
            </div>
            <div className="text-xs text-muted-foreground">{bucket.count} ligne(s)</div>
            {bucket.total_other_currencies > 0 && (
              <div className="text-[10px] text-amber-600 dark:text-amber-400">
                + {formatPrice(bucket.total_other_currencies, "EUR")} autres
                devises
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      {expanded && lines && (
        <CardContent className="pt-0">
          {lines.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Aucune ligne taggée dans cette rubrique. Ouvrez un achat ou une
              charge d'engagement et choisissez la catégorie fiscale pour
              alimenter ce total.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Date</th>
                  <th className="py-2 text-left">Description</th>
                  <th className="py-2 text-left">Personne</th>
                  <th className="py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={`${l.source}-${l.source_id}`} className="border-t">
                    <td className="whitespace-nowrap py-2 text-xs">
                      {formatDate(l.date)}
                    </td>
                    <td className="py-2 text-xs">
                      {l.label}
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {l.source === "item" ? "Achat" : "Charge"}
                      </Badge>
                    </td>
                    <td className="py-2 text-xs">
                      {l.member_name ?? (
                        <span className="text-muted-foreground">Ménage</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right text-xs font-medium tabular-nums">
                      {formatPrice(l.amount, l.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      )}
    </Card>
  )
}

export function TaxesPage() {
  const [year, setYear] = useState(() => new Date().getFullYear() - 1)
  const [buckets, setBuckets] = useState<api.TaxBucket[]>([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    setLoading(true)
    api
      .getTaxBuckets(year)
      .then((b) => setBuckets(b))
      .catch((e) => toast(String(e), "error"))
      .finally(() => setLoading(false))
  }, [year, toast])

  const total = useMemo(
    () => buckets.reduce((sum, b) => sum + b.total_chf, 0),
    [buckets],
  )

  const ordered = useMemo(() => {
    const byCat = new Map(buckets.map((b) => [b.category, b]))
    return CATEGORY_ORDER.map((c) => byCat.get(c)).filter(
      (b): b is api.TaxBucket => !!b,
    )
  }, [buckets])

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Receipt className="h-6 w-6" />
            Déclaration d'impôt {year}
          </h1>
          <p className="text-sm text-muted-foreground">
            Tout ce qui peut alléger votre revenu imposable, regroupé par rubrique
            cantonale/fédérale.
          </p>
        </div>
        <YearPicker year={year} onChange={setYear} />
      </div>

      <Card className="bg-primary/5">
        <CardContent className="flex items-center gap-4 p-4">
          <Users className="h-6 w-6 text-primary" />
          <div className="flex-1">
            <div className="text-xs uppercase text-muted-foreground">
              Total déductible identifié
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {formatPrice(total, "CHF")}
            </div>
          </div>
          <Link
            to="/settings/menage"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            Membres du ménage
          </Link>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-3">
          {ordered.map((b) => (
            <Rubric key={b.category} bucket={b} year={year} />
          ))}
        </div>
      )}

      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <strong>Comment alimenter ces rubriques :</strong> ouvrez un achat dans
        Items ou une charge dans Engagements → champ « Catégorie fiscale » →
        sélectionnez la rubrique correspondante. Les totaux ci-dessus se
        rafraîchissent automatiquement.
      </div>
    </div>
  )
}
