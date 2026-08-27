import { useEffect, useState } from "react"
import { Briefcase, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import { ErrorPanel } from "@/components/ui/error-panel"
import * as api from "@/lib/tauri"

/// Cantons suisses, code officiel. Le canton de TRAVAIL détermine le barème
/// des allocations familiales — pas celui de domicile.
const CANTONS = [
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU",
  "NE", "NW", "OW", "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS",
  "ZG", "ZH",
] as const

type FormState = Record<string, string | boolean>

const FIELDS_NUMBER = [
  "activity_rate_pct", "annual_gross_agreed", "salary_periods_per_year",
  "weekly_hours", "lpp_employee_share_pct", "laa_nonoccupational_pct",
  "ijm_employee_pct", "company_car_purchase_price", "commute_km_per_day",
  "commute_public_transport_cost_year",
] as const

const emptyForm = (incomeId: string): FormState => ({
  id: "",
  income_id: incomeId,
  employer_name: "",
  employer_uid: "",
  avs_number: "",
  birth_date: "",
  work_canton: "",
  activity_rate_pct: "100",
  annual_gross_agreed: "",
  salary_periods_per_year: "12",
  weekly_hours: "",
  hourly_paid: false,
  thirteenth_salary: true,
  lpp_fund_name: "",
  lpp_employee_share_pct: "",
  laa_insurer: "",
  laa_nonoccupational_pct: "",
  ijm_employee_pct: "",
  tax_at_source: false,
  tax_at_source_scale: "",
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
    employer_name: str(c.employer_name),
    employer_uid: str(c.employer_uid),
    avs_number: str(c.avs_number),
    birth_date: str(c.birth_date),
    work_canton: str(c.work_canton),
    activity_rate_pct: str(c.activity_rate_pct),
    annual_gross_agreed: str(c.annual_gross_agreed),
    salary_periods_per_year: str(c.salary_periods_per_year),
    weekly_hours: str(c.weekly_hours),
    hourly_paid: c.hourly_paid,
    thirteenth_salary: c.thirteenth_salary,
    lpp_fund_name: str(c.lpp_fund_name),
    lpp_employee_share_pct: str(c.lpp_employee_share_pct),
    laa_insurer: str(c.laa_insurer),
    laa_nonoccupational_pct: str(c.laa_nonoccupational_pct),
    ijm_employee_pct: str(c.ijm_employee_pct),
    tax_at_source: c.tax_at_source,
    tax_at_source_scale: str(c.tax_at_source_scale),
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
    employer_name: text("employer_name"),
    employer_uid: text("employer_uid"),
    avs_number: text("avs_number"),
    birth_date: text("birth_date"),
    work_canton: text("work_canton"),
    activity_rate_pct: num("activity_rate_pct"),
    annual_gross_agreed: num("annual_gross_agreed"),
    salary_periods_per_year: num("salary_periods_per_year"),
    weekly_hours: num("weekly_hours"),
    hourly_paid: flag("hourly_paid"),
    thirteenth_salary: flag("thirteenth_salary"),
    lpp_fund_name: text("lpp_fund_name"),
    lpp_employee_share_pct: num("lpp_employee_share_pct"),
    laa_insurer: text("laa_insurer"),
    laa_nonoccupational_pct: num("laa_nonoccupational_pct"),
    ijm_employee_pct: num("ijm_employee_pct"),
    tax_at_source: flag("tax_at_source"),
    tax_at_source_scale: text("tax_at_source_scale"),
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
  onSaved,
}: {
  incomeId: string
  onSaved?: (contract: api.EmploymentContract) => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState<FormState>(() => emptyForm(incomeId))
  const [params, setParams] = useState<api.PayrollParams | null>(null)
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
        const [contract, p] = await Promise.all([
          api.getEmploymentContract(incomeId),
          api.getPayrollParams(new Date().getFullYear()),
        ])
        if (cancelled) return
        setParams(p)
        setForm(contract ? toForm(contract) : emptyForm(incomeId))
      } catch (e) {
        if (!cancelled) setLoadError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [incomeId, reloadKey])

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
      toast("Contrat enregistré", "success")
      onSaved?.(saved)
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4" />
            Employeur
          </CardTitle>
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
          <Field
            label="Canton de travail"
            hint="C'est lui qui fixe le barème des allocations familiales, pas le canton de domicile."
          >
            <select
              className={inputCls}
              value={str("work_canton")}
              onChange={(e) => set("work_canton", e.target.value)}
            >
              <option value="">—</option>
              {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Début du contrat">
            <Input type="date" value={str("started_on")} onChange={(e) => set("started_on", e.target.value)} />
          </Field>
          <Field label="Fin du contrat">
            <Input type="date" value={str("ended_on")} onChange={(e) => set("ended_on", e.target.value)} />
          </Field>
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
            <Field label="Barème" hint="A, B, C, H… tel qu'indiqué sur votre bulletin.">
              <Input
                value={str("tax_at_source_scale")}
                onChange={(e) => set("tax_at_source_scale", e.target.value)}
                placeholder="A0N"
              />
            </Field>
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
