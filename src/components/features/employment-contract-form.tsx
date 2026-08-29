import { useEffect, useState } from "react"
import { Briefcase, Plus, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import { ErrorPanel } from "@/components/ui/error-panel"
import { ContractVersions } from "@/components/features/contract-versions"
import * as api from "@/lib/tauri"
import { CANTONS, RESIDENCE_CANTON_HINT, WORK_CANTON_HINT } from "@/lib/cantons"

type FormState = Record<string, string | boolean>

const FIELDS_NUMBER = [
  "activity_rate_pct", "annual_gross_agreed", "salary_periods_per_year",
  "weekly_hours", "lpp_employee_share_pct", "laa_nonoccupational_pct",
  "ijm_employee_pct", "tax_at_source_rate_pct", "company_car_purchase_price", "commute_km_per_day",
  "commute_public_transport_cost_year",
] as const

const emptyForm = (incomeId: string): FormState => ({
  id: "",
  income_id: incomeId,
  label: "",
  employer_name: "",
  employer_uid: "",
  avs_number: "",
  birth_date: "",
  work_canton: "",
  residence_canton: "",
  tax_at_source_canton_source: "residence",
  activity_rate_pct: "100",
  annual_gross_agreed: "",
  salary_periods_per_year: "12",
  weekly_hours: "",
  hourly_paid: false,
  thirteenth_salary: true,
  lpp_fund_name: "",
  lpp_employee_share_pct: "",
  lpp_insured_scope: "total",
  laa_insurer: "",
  laa_nonoccupational_pct: "",
  ijm_employee_pct: "",
  tax_at_source: false,
  tax_at_source_scale: "",
  tax_at_source_rate_pct: "",
  company_car_purchase_price: "",
  subsidized_canteen: false,
  commute_km_per_day: "",
  commute_public_transport_cost_year: "",
  started_on: "",
  ended_on: "",
  notes: "",
})

function toForm(c: api.EmploymentContract): FormState {
  const str = (v: string | number | null) => (v == null ? "" : String(v))
  return {
    id: c.id,
    income_id: c.income_id,
    label: str(c.label),
    employer_name: str(c.employer_name),
    employer_uid: str(c.employer_uid),
    avs_number: str(c.avs_number),
    birth_date: str(c.birth_date),
    work_canton: str(c.work_canton),
    residence_canton: str(c.residence_canton),
    tax_at_source_canton_source: c.tax_at_source_canton_source || "residence",
    activity_rate_pct: str(c.activity_rate_pct),
    annual_gross_agreed: str(c.annual_gross_agreed),
    salary_periods_per_year: str(c.salary_periods_per_year),
    weekly_hours: str(c.weekly_hours),
    hourly_paid: c.hourly_paid,
    thirteenth_salary: c.thirteenth_salary,
    lpp_fund_name: str(c.lpp_fund_name),
    lpp_employee_share_pct: str(c.lpp_employee_share_pct),
    lpp_insured_scope: c.lpp_insured_scope || "total",
    laa_insurer: str(c.laa_insurer),
    laa_nonoccupational_pct: str(c.laa_nonoccupational_pct),
    ijm_employee_pct: str(c.ijm_employee_pct),
    tax_at_source: c.tax_at_source,
    tax_at_source_scale: str(c.tax_at_source_scale),
    tax_at_source_rate_pct: str(c.tax_at_source_rate_pct),
    company_car_purchase_price: str(c.company_car_purchase_price),
    subsidized_canteen: c.subsidized_canteen,
    commute_km_per_day: str(c.commute_km_per_day),
    commute_public_transport_cost_year: str(c.commute_public_transport_cost_year),
    started_on: str(c.started_on),
    ended_on: str(c.ended_on),
    notes: str(c.notes),
  }
}

function toContract(f: FormState): api.EmploymentContract {
  const text = (k: string): string | null => {
    const v = f[k]
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null
  }
  const num = (k: string): number | null => {
    const v = text(k)
    if (v == null) return null
    const n = parseFloat(v)
    return Number.isNaN(n) ? null : n
  }
  const flag = (k: string) => f[k] === true

  return {
    id: String(f.id ?? ""),
    income_id: String(f.income_id),
    label: text("label"),
    employer_name: text("employer_name"),
    employer_uid: text("employer_uid"),
    avs_number: text("avs_number"),
    birth_date: text("birth_date"),
    work_canton: text("work_canton"),
    // Domicile non renseigné : c'est qu'il coïncide avec le lieu de
    // travail — le cas de loin le plus fréquent. On le recopie plutôt
    // que de laisser le barème d'impôt sans canton.
    residence_canton: text("residence_canton") ?? text("work_canton"),
    tax_at_source_canton_source: String(f.tax_at_source_canton_source || "residence"),
    activity_rate_pct: num("activity_rate_pct"),
    annual_gross_agreed: num("annual_gross_agreed"),
    salary_periods_per_year: num("salary_periods_per_year"),
    weekly_hours: num("weekly_hours"),
    hourly_paid: flag("hourly_paid"),
    thirteenth_salary: flag("thirteenth_salary"),
    lpp_fund_name: text("lpp_fund_name"),
    lpp_employee_share_pct: num("lpp_employee_share_pct"),
    lpp_insured_scope: String(f.lpp_insured_scope || "total"),
    laa_insurer: text("laa_insurer"),
    laa_nonoccupational_pct: num("laa_nonoccupational_pct"),
    ijm_employee_pct: num("ijm_employee_pct"),
    tax_at_source: flag("tax_at_source"),
    tax_at_source_scale: text("tax_at_source_scale"),
    tax_at_source_rate_pct: num("tax_at_source_rate_pct"),
    company_car_purchase_price: num("company_car_purchase_price"),
    subsidized_canteen: flag("subsidized_canteen"),
    commute_km_per_day: num("commute_km_per_day"),
    commute_public_transport_cost_year: num("commute_public_transport_cost_year"),
    started_on: text("started_on"),
    ended_on: text("ended_on"),
    notes: text("notes"),
    created_at: "",
    updated_at: "",
  }
}

function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className ?? "space-y-2"}>
      <label className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Checkbox({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input accent-primary"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      {hint && <p className="text-xs text-muted-foreground pl-6">{hint}</p>}
    </div>
  )
}

/// Les termes de l'emploi, saisis une fois. Trois champs comptent plus que
/// les autres : les taux LPP, AANP et IJM sont contractuels, aucun barème ne
/// permet de les déduire — sans eux le contrôle du bulletin reste partiel.
export function EmploymentContractForm({
  incomeId,
  defaultEmployerName,
  onSaved,
}: {
  incomeId: string
  /// Employeur déjà connu du revenu (l'assistant de création l'enregistre
  /// comme créancier). Sert à pré-remplir un contrat neuf, jamais à écraser
  /// un contrat existant.
  defaultEmployerName?: string | null
  onSaved?: (contract: api.EmploymentContract) => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState<FormState>(() => emptyForm(incomeId))
  /// Deux cantons distincts sont l'exception, pas la règle : le second champ
  /// reste caché tant qu'on n'en a pas besoin. Il s'ouvre tout seul quand le
  /// contrat chargé en porte déjà deux différents.
  const [otherCanton, setOtherCanton] = useState(false)
  /// Toutes les versions du contrat. Un avenant n'écrase pas la précédente, il
  /// lui succède : une fiche de 2019 doit rester jugée avec les conditions de
  /// 2019.
  const [versions, setVersions] = useState<api.EmploymentContract[]>([])
  const [params, setParams] = useState<api.PayrollParamsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  /// Erreur de chargement affichée en place. Elle ne passe pas par un toast :
  /// le toast disparaît, et l'utilisateur se retrouverait devant un formulaire
  /// vide sans savoir que ses données n'ont pas été lues.
  const [loadError, setLoadError] = useState<string | null>(null)
  /// Incrémenté par « Réessayer » : l'identifiant du revenu n'a pas changé,
  /// il faut donc autre chose pour relancer le chargement.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [list, p] = await Promise.all([
          api.getEmploymentContractVersions(incomeId),
          api.getPayrollParams(new Date().getFullYear()),
        ])
        if (cancelled) return
        setParams(p)
        setVersions(list)
        // On ouvre sur la version en vigueur — celle qu'on vient consulter
        // neuf fois sur dix — et non sur la première de la liste.
        const contract = list.find((c) => c.ended_on == null) ?? list[0] ?? null
        setForm(
          contract
            ? toForm(contract)
            : { ...emptyForm(incomeId), employer_name: defaultEmployerName ?? "" },
        )
        setOtherCanton(
          !!contract?.residence_canton &&
            contract.residence_canton !== contract.work_canton,
        )
      } catch (e) {
        if (!cancelled) setLoadError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [incomeId, reloadKey, defaultEmployerName])

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))
  const str = (k: string) => String(form[k] ?? "")

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    // Un taux ne peut pas être négatif ni dépasser 100 % : mieux vaut le dire
    // ici que produire un contrôle absurde sur chaque bulletin.
    for (const k of FIELDS_NUMBER) {
      const raw = str(k)
      if (raw && (Number.isNaN(parseFloat(raw)) || parseFloat(raw) < 0)) {
        toast("Valeur numérique invalide", "error")
        return
      }
    }
    setSaving(true)
    try {
      const saved = await api.upsertEmploymentContract(toContract(form))
      setForm(toForm(saved))
      // Enregistrer une version peut clore la précédente : la liste doit être
      // relue, sinon elle afficherait deux périodes qui se chevauchent.
      setVersions(await api.getEmploymentContractVersions(incomeId))
      toast(isAmendment ? "Avenant enregistré" : "Contrat enregistré", "success")
      onSaved?.(saved)
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  /// Un avenant part des conditions actuelles : on ne renégocie jamais tout,
  /// on change un salaire ou un taux. Pré-remplir évite de tout ressaisir et,
  /// surtout, de perdre un taux qu'on aurait oublié de recopier.
  const startAmendment = () => {
    const today = new Date().toISOString().slice(0, 10)
    setForm((f) => ({
      ...f,
      id: "",
      label: `Avenant ${today.slice(0, 4)}`,
      started_on: today,
      ended_on: "",
    }))
  }

  const selectVersion = (id: string) => {
    const v = versions.find((c) => c.id === id)
    if (!v) return
    setForm(toForm(v))
    setOtherCanton(!!v.residence_canton && v.residence_canton !== v.work_canton)
  }

  const removeVersion = async (id: string) => {
    try {
      await api.deleteEmploymentContractVersion(id)
      const list = await api.getEmploymentContractVersions(incomeId)
      setVersions(list)
      const next = list.find((c) => c.ended_on == null) ?? list[0] ?? null
      setForm(next ? toForm(next) : emptyForm(incomeId))
      toast("Version supprimée", "success")
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  /// Vrai quand le formulaire décrit une version qui n'existe pas encore.
  const isAmendment = !str("id") && versions.length > 0

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }
  if (loadError) {
    return (
      <ErrorPanel
        error={loadError}
        onRetry={() => { setLoadError(null); setReloadKey((k) => k + 1) }}
      />
    )
  }

  const inputCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ContractVersions
        versions={versions}
        selectedId={str("id") || null}
        onSelect={selectVersion}
        onAddAmendment={startAmendment}
        onDelete={removeVersion}
      />

      {isAmendment && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm font-medium">Nouvel avenant</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Les conditions actuelles sont reprises : ne changez que ce qui change. À
            l'enregistrement, la version précédente sera close la veille de la date d'effet,
            et vos anciens bulletins continueront d'être contrôlés avec elle.
          </p>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Employeur
            </CardTitle>
            {/* Quand il n'y a qu'une version, la frise ne s'affiche pas : le
                bouton doit donc exister ici, sans quoi on ne pourrait jamais
                créer le premier avenant. */}
            {versions.length === 1 && !isAmendment && (
              <Button type="button" variant="outline" size="sm" onClick={startAmendment}>
                <Plus className="mr-1.5 h-4 w-4" />
                Ajouter un avenant
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Nom de l'employeur">
            <Input value={str("employer_name")} onChange={(e) => set("employer_name", e.target.value)} />
          </Field>
          <Field label="IDE" hint="Format CHE-123.456.789">
            <Input
              value={str("employer_uid")}
              onChange={(e) => set("employer_uid", e.target.value)}
              placeholder="CHE-123.456.789"
            />
          </Field>
          <Field label="N° AVS" hint="Format 756.xxxx.xxxx.xx">
            <Input
              value={str("avs_number")}
              onChange={(e) => set("avs_number", e.target.value)}
              placeholder="756.1234.5678.90"
            />
          </Field>
          <Field label="Canton de travail" hint={WORK_CANTON_HINT}>
            <select
              className={inputCls}
              value={str("work_canton")}
              onChange={(e) => set("work_canton", e.target.value)}
            >
              <option value="">—</option>
              {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {(versions.length > 1 || isAmendment) && (
            <Field label="Nom de cette version" hint="Ex. « Avenant 2021 — augmentation ».">
              <Input value={str("label")} onChange={(e) => set("label", e.target.value)} />
            </Field>
          )}
          <Field label="Début du contrat" hint="Date d'effet de cette version.">
            <Input type="date" value={str("started_on")} onChange={(e) => set("started_on", e.target.value)} />
          </Field>
          <Field label="Fin du contrat">
            <Input type="date" value={str("ended_on")} onChange={(e) => set("ended_on", e.target.value)} />
          </Field>

          {/* Le second canton ne s'affiche que pour qui en a besoin. Vivre et
              travailler dans le même canton est le cas courant : lui imposer
              deux sélecteurs identiques serait une complication gratuite. */}
          <div className="sm:col-span-2 lg:col-span-3 space-y-3">
            <Checkbox
              label="J'habite dans un autre canton que celui de mon employeur"
              checked={otherCanton}
              onChange={(v) => {
                setOtherCanton(v)
                if (!v) set("residence_canton", "")
              }}
              hint="Par exemple : domicile à Vaud, entreprise basée à Genève."
            />
            {otherCanton && (
              <div className="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
                <Field label="Canton de domicile" hint={RESIDENCE_CANTON_HINT}>
                  <select
                    className={inputCls}
                    value={str("residence_canton")}
                    onChange={(e) => set("residence_canton", e.target.value)}
                  >
                    <option value="">—</option>
                    {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field
                  label="Barème d'impôt à la source appliqué"
                  hint="La loi désigne votre canton de domicile. Certains employeurs retiennent malgré tout selon le leur : votre fiche de salaire le dit."
                >
                  <select
                    className={inputCls}
                    value={str("tax_at_source_canton_source")}
                    onChange={(e) => set("tax_at_source_canton_source", e.target.value)}
                  >
                    <option value="residence">Celui de mon canton de domicile</option>
                    <option value="work">Celui du canton de mon employeur</option>
                  </select>
                </Field>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Les retenues sociales cantonales et les allocations familiales suivent
                  toujours le canton de votre employeur, quel que soit ce réglage.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rémunération</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Date de naissance"
            hint="Sert uniquement à la tranche de bonification LPP (7 / 10 / 15 / 18 %)."
          >
            <Input type="date" value={str("birth_date")} onChange={(e) => set("birth_date", e.target.value)} />
          </Field>
          <Field label="Taux d'activité (%)">
            <Input
              type="number" step="1" min="0" max="100"
              value={str("activity_rate_pct")}
              onChange={(e) => set("activity_rate_pct", e.target.value)}
            />
          </Field>
          <Field
            label="Salaire annuel brut convenu"
            hint="Référence du salaire coordonné LPP — plus fiable que 12 × le brut du mois."
          >
            <Input
              type="number" step="0.01" min="0"
              value={str("annual_gross_agreed")}
              onChange={(e) => set("annual_gross_agreed", e.target.value)}
            />
          </Field>
          <Field
            label="Versements par an"
            hint="12, ou 13 si le 13ᵉ salaire est versé séparément."
          >
            <Input
              type="number" step="1" min="1" max="26"
              value={str("salary_periods_per_year")}
              onChange={(e) => set("salary_periods_per_year", e.target.value)}
            />
          </Field>
          <Field
            label="Heures par semaine"
            hint={
              params
                ? `En dessous de ${params.laa_nonoccupational_min_weekly_hours} h, l'assurance accidents non professionnels n'est pas obligatoire (art. 7 al. 2 LAA).`
                : undefined
            }
          >
            <Input
              type="number" step="0.5" min="0"
              value={str("weekly_hours")}
              onChange={(e) => set("weekly_hours", e.target.value)}
            />
          </Field>
          <div className="space-y-3 pt-6">
            <Checkbox
              label="13ᵉ salaire prévu"
              checked={form.thirteenth_salary === true}
              onChange={(v) => set("thirteenth_salary", v)}
            />
            <Checkbox
              label="Payé à l'heure"
              checked={form.hourly_paid === true}
              onChange={(v) => set("hourly_paid", v)}
              hint="Votre salaire de base dépend des heures faites : le contrôle de la majoration de 25 % sur les heures supplémentaires est alors écarté, faute de tarif horaire fixe auquel le comparer."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Taux de vos assurances</CardTitle>
          <p className="text-sm text-muted-foreground">
            Ces trois taux dépendent de votre contrat et du règlement de votre
            caisse : aucun barème légal ne permet de les déduire. Sans eux, les
            retenues correspondantes ne peuvent pas être vérifiées — elles sont
            signalées comme non contrôlables plutôt qu'estimées au hasard. Vous
            les trouvez sur votre bulletin ou votre certificat de prévoyance.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Caisse de pension (LPP)">
            <Input value={str("lpp_fund_name")} onChange={(e) => set("lpp_fund_name", e.target.value)} />
          </Field>
          <Field
            label="Salaire assuré au 2ᵉ pilier"
            hint="Vos suppléments comptent-ils dans le salaire assuré ? Le signe est simple : si votre retenue LPP est identique tous les mois, seul le salaire de base l'est."
          >
            <select
              className={inputCls}
              value={str("lpp_insured_scope")}
              onChange={(e) => set("lpp_insured_scope", e.target.value)}
            >
              <option value="total">Tout le brut, suppléments compris</option>
              <option value="base">Seulement le salaire de base</option>
            </select>
          </Field>
          <Field
            label="Part employé LPP (%)"
            hint="En % du salaire coordonné. L'employeur doit financer au moins autant que vous (art. 66 al. 1 LPP)."
          >
            <Input
              type="number" step="0.01" min="0"
              value={str("lpp_employee_share_pct")}
              onChange={(e) => set("lpp_employee_share_pct", e.target.value)}
            />
          </Field>
          <Field label="Assureur LAA">
            <Input value={str("laa_insurer")} onChange={(e) => set("laa_insurer", e.target.value)} />
          </Field>
          <Field
            label="Prime AANP (%)"
            hint="Accidents non professionnels, à votre charge (art. 91 al. 2 LAA). Les accidents professionnels sont payés par l'employeur."
          >
            <Input
              type="number" step="0.001" min="0"
              value={str("laa_nonoccupational_pct")}
              onChange={(e) => set("laa_nonoccupational_pct", e.target.value)}
            />
          </Field>
          <Field
            label="Prime IJM (%)"
            hint="Indemnités journalières maladie. Assurance facultative, souvent partagée par moitié."
          >
            <Input
              type="number" step="0.001" min="0"
              value={str("ijm_employee_pct")}
              onChange={(e) => set("ijm_employee_pct", e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Frais et avantages</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Prix d'achat du véhicule de service (HT)"
            hint={
              params
                ? `La part privée vaut ${params.private_car_monthly_pct} %/mois de ce montant, au minimum ${params.private_car_monthly_min} CHF, et couvre le trajet domicile-travail (ch. 2.2, case F).`
                : undefined
            }
          >
            <Input
              type="number" step="0.01" min="0"
              value={str("company_car_purchase_price")}
              onChange={(e) => set("company_car_purchase_price", e.target.value)}
            />
          </Field>
          <Field
            label="Abonnement transports publics (CHF/an)"
            hint={
              params
                ? `Frais de déplacement domicile-travail, plafonnés à ${params.commute_cap_ifd} CHF pour l'impôt fédéral direct.`
                : undefined
            }
          >
            <Input
              type="number" step="0.01" min="0"
              value={str("commute_public_transport_cost_year")}
              onChange={(e) => set("commute_public_transport_cost_year", e.target.value)}
            />
          </Field>
          <Field
            label="Trajet en voiture (km/jour)"
            hint="Utilisé seulement si aucun abonnement n'est saisi. Le véhicule privé n'est admis que si les transports publics ne sont pas exigibles."
          >
            <Input
              type="number" step="0.1" min="0"
              value={str("commute_km_per_day")}
              onChange={(e) => set("commute_km_per_day", e.target.value)}
            />
          </Field>
          <div className="pt-6 sm:col-span-2 lg:col-span-3">
            <Checkbox
              label="Cantine subventionnée par l'employeur"
              checked={form.subsidized_canteen === true}
              onChange={(v) => set("subsidized_canteen", v)}
              hint={
                params
                  ? `Réduit le forfait repas déductible de ${params.meals_full_year} à ${params.meals_subsidized_year} CHF par an.`
                  : undefined
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Régime fiscal</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Checkbox
            label="Imposé à la source"
            checked={form.tax_at_source === true}
            onChange={(v) => set("tax_at_source", v)}
            hint="Décoché : taxation ordinaire, vous remplissez une déclaration."
          />
          {form.tax_at_source === true && (
            <>
              <Field label="Barème" hint="A, B, C, H… tel qu'indiqué sur votre bulletin.">
                <Input
                  value={str("tax_at_source_scale")}
                  onChange={(e) => set("tax_at_source_scale", e.target.value)}
                  placeholder="A0N"
                />
              </Field>
              <Field
                label="Taux effectif (%)"
                hint="Lu sur votre fiche de salaire. Sert tant que le barème de votre canton n'est pas importé dans Paramètres → Barèmes."
              >
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={str("tax_at_source_rate_pct")}
                  onChange={(e) => set("tax_at_source_rate_pct", e.target.value)}
                  placeholder="0.00"
                />
              </Field>
            </>
          )}
          <Field label="Notes" className="space-y-2 sm:col-span-2">
            <textarea
              className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={str("notes")}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          <Save className="h-4 w-4" />
          {saving ? "Enregistrement…" : "Enregistrer le contrat"}
        </Button>
      </div>
    </form>
  )
}
