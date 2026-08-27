import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, ChevronRight, Receipt, Users, Wallet } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatPrice, formatDate } from "@/lib/utils"
import { useToast } from "@/components/ui/toast"
import * as api from "@/lib/tauri"

/// French + EN labels per rubric. Captions show the Swiss-specific rule of
/// thumb so the user remembers WHY each rubric matters for the declaration.
/// Libellés des rubriques de dépenses. Les captions décrivent la RÈGLE, pas
/// les montants : les plafonds changent chaque année et sont injectés depuis
/// les barèmes du backend (`getPayrollParams`) plutôt que codés ici — c'est
/// ce qui a laissé traîner le plafond 3a de 2024 pendant deux ans.
const RUBRIC: Record<
  api.TaxCategory,
  { label: string; caption: (p: api.PayrollParams | null) => string }
> = {
  pro: {
    label: "Frais professionnels",
    caption: (p) =>
      p
        ? `Transports domicile-travail (plafond fédéral ${formatPrice(p.commute_cap_ifd, "CHF")}), repas (${formatPrice(p.meals_full_year, "CHF")}/an, moitié si cantine subventionnée), formation, vêtements.`
        : "Transports domicile-travail, repas, formation pro, vêtements.",
  },
  medical: {
    label: "Frais médicaux",
    caption: () =>
      "Médecin, dentiste, pharmacie, hospitalisation. Déductible au-dessus de 5% du revenu net imposable.",
  },
  don: {
    label: "Dons",
    caption: () =>
      "Dons à organisations d'utilité publique (au moins 100 CHF, plafond cantonal).",
  },
  entretien: {
    label: "Entretien immeuble",
    caption: () =>
      "Propriétaires : frais d'entretien et de réparation, charges PPE (LFR), primes d'assurance bâtiment.",
  },
  "3a": {
    label: "3ᵉ pilier (3a)",
    caption: (p) =>
      p
        ? `Plafond ${p.effective_year} : ${formatPrice(p.pillar3a_with_lpp, "CHF")} (salarié affilié LPP) ou ${formatPrice(p.pillar3a_without_lpp_cap, "CHF")} (indépendant sans LPP, ${p.pillar3a_without_lpp_pct}% du revenu). 100% déductible.`
        : "Versements à un compte de 3ᵉ pilier lié. 100% déductible.",
  },
  formation: {
    label: "Formation continue",
    caption: () =>
      "Formation continue à des fins professionnelles (max ≈ 12'000 CHF/an au fédéral).",
  },
  garde_enfant: {
    label: "Frais de garde d'enfants",
    caption: () =>
      "Crèche, parascolaire, maman de jour. Plafond fédéral par enfant, variable au cantonal.",
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
  params,
}: {
  bucket: api.TaxBucket
  year: number
  params: api.PayrollParams | null
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
              <p className="mt-1 text-xs text-muted-foreground">{meta.caption(params)}</p>
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

/// Volet revenus : base imposable, comparatif des frais professionnels et
/// plafond 3a. Les deux branches du calcul des frais sont montrées côte à
/// côte — le contribuable ne peut retenir la plus favorable qu'en les voyant
/// ensemble, et l'application n'a pas à choisir à sa place.
function IncomeBlock({ summary }: { summary: api.IncomeTaxSummary }) {
  const [open, setOpen] = useState(true)
  const pe = summary.professional_expenses
  const nothingYet = summary.gross_total === 0 && summary.other_income_by_type.length === 0

  if (nothingYet) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Aucun revenu enregistré pour {summary.year}. Saisissez vos bulletins de
          salaire dans <Link to="/incomes" className="underline">Revenus</Link>{" "}
          pour que la base imposable et les frais professionnels se calculent ici.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
            <div>
              <CardTitle className="text-base">Revenus et frais professionnels</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Reconstitué depuis vos bulletins et certificats de salaire.
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums">
              {formatPrice(pe.total, "CHF")}
            </div>
            <div className="text-xs text-muted-foreground">frais déductibles</div>
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4 pt-0">
          {summary.salary_sources.length > 0 && (
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-2">Salaires</p>
              <table className="w-full text-sm">
                <tbody>
                  {summary.salary_sources.map((s) => (
                    <tr key={s.income_id} className="border-t">
                      <td className="py-2 text-xs">
                        <Link to={`/incomes/${s.income_id}`} className="hover:underline">
                          {s.employer_name ?? s.name}
                        </Link>
                        {s.has_declared_certificate ? (
                          <Badge variant="success" className="ml-2 text-[10px]">
                            certificat reçu
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            {s.receipt_count} bulletin(s)
                          </Badge>
                        )}
                        {!s.has_contract && (
                          <Badge variant="warning" className="ml-2 text-[10px]">
                            contrat manquant
                          </Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums">
                        {formatPrice(s.net_salary, "CHF")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {summary.other_income_by_type.length > 0 && (
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-2">Autres revenus</p>
              <table className="w-full text-sm">
                <tbody>
                  {summary.other_income_by_type.map((o) => (
                    <tr key={o.income_type} className="border-t">
                      <td className="py-2 text-xs">
                        {o.income_type}
                        <span className="ml-2 text-muted-foreground">
                          ({o.count} versement{o.count > 1 ? "s" : ""})
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums">
                        {formatPrice(o.total, "CHF")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <p className="text-xs uppercase text-muted-foreground mb-2">
              Frais professionnels (impôt fédéral direct)
            </p>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-t">
                  <td className="py-2 text-xs">
                    Autres frais — forfait {summary.params.pro_lump_sum_pct}% du salaire net
                    <span className="ml-1 text-muted-foreground">
                      (min. {formatPrice(summary.params.pro_lump_sum_min, "CHF")}, max.{" "}
                      {formatPrice(summary.params.pro_lump_sum_max, "CHF")})
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums">
                    {formatPrice(pe.lump_sum_other_expenses, "CHF")}
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="py-2 text-xs">
                    Déplacements domicile-travail
                    {pe.commute_claimed > pe.commute_capped && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">
                        (ramenés de {formatPrice(pe.commute_claimed, "CHF")} au plafond)
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums">
                    {formatPrice(pe.commute_capped, "CHF")}
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="py-2 text-xs">
                    Repas hors du domicile
                    {pe.meals_reduced_by_employer && (
                      <span className="ml-1 text-muted-foreground">
                        (réduit : cantine subventionnée)
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums">
                    {formatPrice(pe.meals, "CHF")}
                  </td>
                </tr>
                <tr className="border-t bg-muted/40 font-medium">
                  <td className="py-2 text-xs">Total</td>
                  <td className="whitespace-nowrap py-2 text-right text-xs tabular-nums">
                    {formatPrice(pe.total, "CHF")}
                  </td>
                </tr>
              </tbody>
            </table>
            {pe.notes.length > 0 && (
              <ul className="mt-2 space-y-1">
                {pe.notes.map((n, idx) => (
                  <li key={idx} className="text-xs text-muted-foreground">• {n}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <p>
              <strong>Plafond 3a {summary.params.effective_year} :</strong>{" "}
              {formatPrice(summary.pillar3a_cap, "CHF")}{" "}
              {summary.affiliated_to_lpp
                ? "(affilié à une caisse de pension)"
                : "(aucune cotisation LPP constatée sur l'année)"}
              . Les versements que vous taggez « 3ᵉ pilier » dans la rubrique
              ci-dessous viennent s'y imputer.
            </p>
            {summary.params.estimated && (
              <p className="mt-1 text-amber-600 dark:text-amber-400">
                Aucun barème publié pour {summary.params.year} : les valeurs{" "}
                {summary.params.effective_year} sont appliquées.
              </p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

export function TaxesPage() {
  const [year, setYear] = useState(() => new Date().getFullYear() - 1)
  const [buckets, setBuckets] = useState<api.TaxBucket[]>([])
  const [summary, setSummary] = useState<api.IncomeTaxSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.getTaxBuckets(year),
      // Le volet revenus est un ajout : son indisponibilité ne doit pas
      // empêcher d'afficher les déductions, qui existaient avant lui.
      api.getIncomeTaxSummary(year).catch(() => null),
    ])
      .then(([b, s]) => { setBuckets(b); setSummary(s) })
      .catch((e) => toast(String(e), "error"))
      .finally(() => setLoading(false))
  }, [year, toast])

  const params = summary?.params ?? null

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

      <div className="grid gap-4 lg:grid-cols-2">
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

        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <Wallet className="h-6 w-6 text-primary" />
            <div className="flex-1">
              <div className="text-xs uppercase text-muted-foreground">
                Salaire net imposable (ch. 11)
              </div>
              <div className="text-2xl font-bold tabular-nums">
                {formatPrice(summary?.net_salary ?? 0, "CHF")}
              </div>
              {summary && summary.gross_total > 0 && (
                <div className="text-xs text-muted-foreground">
                  Brut {formatPrice(summary.gross_total, "CHF")} − cotisations{" "}
                  {formatPrice(summary.social_contributions, "CHF")} − LPP{" "}
                  {formatPrice(summary.lpp_contributions, "CHF")}
                </div>
              )}
            </div>
            <Link
              to="/incomes"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              Revenus
            </Link>
          </CardContent>
        </Card>
      </div>

      {summary && <IncomeBlock summary={summary} />}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-3">
          {ordered.map((b) => (
            <Rubric key={b.category} bucket={b} year={year} params={params} />
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
