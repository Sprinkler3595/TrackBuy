import { useEffect, useState } from "react"
import {
  AlertTriangle, Briefcase, ChevronLeft, ChevronRight, Lock, Plus, Save, Search, ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import { ErrorPanel } from "@/components/ui/error-panel"
import { ContractVersions } from "@/components/features/contract-versions"
import { ZefixLookup } from "@/components/features/zefix-lookup"
import * as api from "@/lib/tauri"
import { RateField } from "@/components/features/rate-field"
import { CANTONS, RESIDENCE_CANTON_HINT, WORK_CANTON_HINT } from "@/lib/cantons"
import { formatDate } from "@/lib/utils"
import { diffVersions } from "@/lib/contract-changes"

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
  lpp_coordination_part_time: false,
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
    lpp_coordination_part_time: c.lpp_coordination_part_time,
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
    lpp_coordination_part_time: flag("lpp_coordination_part_time"),
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
  /// Recherche au registre du commerce, ouverte depuis la carte Employeur.
  const [zefixOpen, setZefixOpen] = useState(false)
  /// Trois régimes, et un seul par défaut.
  ///
  /// `view` — les conditions enregistrées sont en lecture seule. C'est l'état
  /// normal : un contrat signé ne se retouche pas, et une modification par
  /// inadvertance changerait le contrôle de bulletins déjà validés.
  ///
  /// `wizard` — annoncer un changement, section par section, avec un
  /// récapitulatif de ce qui bouge avant d'enregistrer.
  ///
  /// `fix` — corriger une erreur de saisie. Nécessaire : forcer un
  /// « changement » pour un IDE mal tapé inventerait un événement qui n'a pas
  /// eu lieu. Explicite, jamais par défaut, et bruyamment averti quand des
  /// bulletins en dépendent.
  const [mode, setMode] = useState<"view" | "wizard" | "fix">("view")
  const [step, setStep] = useState(0)
  /// La version dont le changement part, gardée pour le récapitulatif : sans
  /// elle, impossible de dire CE QUI change avant d'enregistrer.
  const [before, setBefore] = useState<api.EmploymentContract | null>(null)
  /// Combien de bulletins chaque version juge déjà. Sert aux deux moitiés de
  /// la promesse : rassurer avant d'annoncer un changement, avertir avant de
  /// corriger une version qui a déjà servi.
  const [usage, setUsage] = useState<api.ContractVersionUsage[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [list, use, p] = await Promise.all([
          api.getEmploymentContractVersions(incomeId),
          api.getContractVersionUsage(incomeId).catch(() => [] as api.ContractVersionUsage[]),
          api.getPayrollParams(new Date().getFullYear()),
        ])
        if (cancelled) return
        setParams(p)
        setVersions(list)
        setUsage(use)
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

  /// Le registre fait foi : ce qu'il renvoie remplace ce qui était saisi.
  ///
  /// L'adresse du siège n'a pas de case ici — elle vit sur l'entreprise, pas
  /// sur le contrat, parce qu'un avenant ne déménage pas l'employeur. On la
  /// dit quand même, faute de quoi l'utilisateur croirait la recherche
  /// incomplète.
  const pickFromZefix = (c: api.ZefixCompany) => {
    setZefixOpen(false)
    set("employer_name", c.name)
    if (c.uid) set("employer_uid", c.uid)
    toast(
      c.address
        ? `${c.name} — siège : ${c.address}`
        : `${c.name} — pas d'adresse au registre`,
      "success",
    )
  }

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
      setUsage(await api.getContractVersionUsage(incomeId).catch(() => []))
      toast(
        mode === "wizard" ? "Changement enregistré" : "Contrat enregistré",
        "success",
      )
      setMode("view")
      setStep(0)
      setBefore(null)
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
    // Les conditions en vigueur servent de point de départ : on ne renégocie
    // jamais tout, et repartir de zéro ferait perdre un taux qu'on aurait
    // oublié de recopier.
    setBefore(versions.find((v) => v.ended_on == null) ?? versions[0] ?? null)
    setForm((f) => ({
      ...f,
      id: "",
      label: `Changement ${today.slice(0, 4)}`,
      started_on: today,
      ended_on: "",
    }))
    setMode("wizard")
    setStep(0)
  }

  /// Corriger une saisie : tout redevient modifiable d'un coup, sans créer de
  /// version. Réservé aux fautes de frappe — l'écran le rappelle.
  const startFix = () => setMode("fix")

  const cancelEdit = () => {
    const v = versions.find((c) => c.id === str("id")) ?? versions.find((c) => c.ended_on == null)
    setForm(v ? toForm(v) : emptyForm(incomeId))
    setMode("view")
    setStep(0)
  }

  const selectVersion = (id: string) => {
    const v = versions.find((c) => c.id === id)
    if (!v) return
    setForm(toForm(v))
    setOtherCanton(!!v.residence_canton && v.residence_canton !== v.work_canton)
    setMode("view")
  }

  const removeVersion = async (id: string) => {
    try {
      await api.deleteEmploymentContractVersion(id)
      const list = await api.getEmploymentContractVersions(incomeId)
      setVersions(list)
      setUsage(await api.getContractVersionUsage(incomeId).catch(() => []))
      const next = list.find((c) => c.ended_on == null) ?? list[0] ?? null
      setForm(next ? toForm(next) : emptyForm(incomeId))
      toast("Version supprimée", "success")
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  /// Vrai quand le formulaire décrit une version qui n'existe pas encore.
  const isAmendment = !str("id") && versions.length > 0

  /// L'usage de la version actuellement ouverte dans le formulaire.
  const editedUsage = usage.find((u) => u.contract_id === str("id")) ?? null
  /// Ce qu'un changement annoncé laissera intact : tout ce qui est déjà
  /// enregistré, puisqu'une nouvelle version ne juge que ce qui suit sa date.
  const frozenBefore = usage.reduce((n, u) => n + u.receipt_count, 0)

  /// Le parcours d'annonce, dans l'ordre où on relit un contrat : quand, chez
  /// qui, pour combien, avec quelles assurances, quels frais, quel régime
  /// fiscal — puis ce qui change, avant d'enregistrer.
  const STEPS = [
    { key: "when", title: "Date d'effet" },
    { key: "employer", title: "L'entreprise" },
    { key: "pay", title: "La rémunération" },
    { key: "insurance", title: "Vos assurances" },
    { key: "expenses", title: "Frais et avantages" },
    { key: "tax", title: "Régime fiscal" },
    { key: "recap", title: "Ce qui change" },
  ] as const

  const wizard = mode === "wizard"
  /// Une section est visible hors parcours (tout à la fois), ou à son tour.
  const shows = (key: (typeof STEPS)[number]["key"]) =>
    !wizard || STEPS[step]?.key === key
  // Un contrat encore inexistant doit pouvoir être saisi : le verrou protège
  // ce qui a été enregistré, pas la page blanche.
  const readOnly = mode === "view" && versions.length > 0
  const lastStep = step === STEPS.length - 1

  /// Ce que l'enregistrement va changer, calculé sur la version de départ.
  /// Le montrer AVANT d'écrire est tout l'intérêt d'« annoncer » : on vérifie
  /// qu'on annonce bien ce qu'on croit annoncer.
  const pendingChanges = before ? diffVersions(before, toContract(form)) : []

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

      {/* Une fois enregistrées, les conditions sont verrouillées. Un contrat
          signé ne se retouche pas, et une modification par inadvertance
          changerait le contrôle de bulletins déjà validés. */}
      {readOnly && versions.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
              Conditions enregistrées
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Elles ne se modifient plus directement. Salaire, taux de cotisation, plan de
              prévoyance, nom ou IDE de l'entreprise, canton… tout changement se déclare à
              partir d'une date, et ce qui précède ne bouge pas.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" onClick={startAmendment}>
              <Plus className="mr-1.5 h-4 w-4" />
              Annoncer un changement
            </Button>
          </div>
        </div>
      )}

      {wizard && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm font-medium">
            Étape {step + 1}/{STEPS.length} — {STEPS[step].title}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Les conditions en vigueur sont reprises : ne changez que ce qui change.
          </p>
          {frozenBefore > 0 && (
            <p className="mt-1.5 flex gap-1.5 text-xs text-emerald-700 dark:text-emerald-500">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {frozenBefore === 1
                ? "1 bulletin déjà enregistré gardera ses conditions actuelles."
                : `${frozenBefore} bulletins déjà enregistrés garderont leurs conditions actuelles.`}
            </p>
          )}
        </div>
      )}

      {/* Corriger reste possible — forcer un « changement » pour un IDE mal
          tapé inventerait un événement qui n'a pas eu lieu — mais jamais par
          défaut, et bruyamment averti quand des bulletins en dépendent. */}
      {mode === "fix" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="flex gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <span>
              <strong>Correction d'une erreur de saisie.</strong> Réservé aux fautes de
              frappe : cette version est modifiée sur place, sans trace de changement.
              {editedUsage != null && editedUsage.receipt_count > 0 && (
                <>
                  {" "}
                  <strong>
                    {editedUsage.receipt_count === 1
                      ? "1 bulletin est contrôlé avec cette version"
                      : `${editedUsage.receipt_count} bulletins sont contrôlés avec cette version`}
                  </strong>
                  {editedUsage.first_period && editedUsage.last_period && (
                    <> ({formatDate(editedUsage.first_period)} → {formatDate(editedUsage.last_period)})</>
                  )}{" "}
                  : leur contrôle changera. Si vos conditions ont réellement évolué, revenez
                  en arrière et annoncez un changement.
                </>
              )}
            </span>
          </p>
        </div>
      )}

      {/* En lecture seule, `fieldset` neutralise d'un coup tous les champs
          qu'il contient — sans toucher aux boutons d'action, qui vivent
          dehors : « Annoncer un changement » doit rester cliquable. */}
      <fieldset disabled={readOnly} className="contents">

      {/* La date d'effet, première question du parcours : c'est elle qui
          sépare ce qui change de ce qui ne bouge pas. */}
      {wizard && shows("when") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">À partir de quand ?</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Date d'effet"
              hint="Les bulletins antérieurs restent contrôlés avec les conditions actuelles."
            >
              <Input
                type="date"
                value={str("started_on")}
                onChange={(e) => set("started_on", e.target.value)}
              />
            </Field>
            <Field label="Nom de ce changement" hint="Ex. « Avenant 2026 — augmentation ».">
              <Input value={str("label")} onChange={(e) => set("label", e.target.value)} />
            </Field>
          </CardContent>
        </Card>
      )}

      {shows("employer") && (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Employeur
            </CardTitle>
            <Button type="button" variant="ghost" size="sm" onClick={() => setZefixOpen(true)}>
              <Search className="mr-1.5 h-3.5 w-3.5" />
              Chercher au registre
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {zefixOpen && (
            <ZefixLookup
              initialName={str("employer_name")}
              canton={str("work_canton") || null}
              onPicked={pickFromZefix}
              onClose={() => setZefixOpen(false)}
            />
          )}
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
      )}

      {shows("pay") && (
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
      )}

      {shows("insurance") && (
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
          {/* Ces trois taux tendent tous le même piège : « 50/50 » décrit le
              partage de la prime, pas son taux. `RateField` le dit, et le
              signale quand la valeur saisie ressemble à une répartition. */}
          {/* Ce champ et le plan par tranches, plus bas, répondent à la MÊME
              question. Le plan gagne dès qu'une de ses tranches couvre votre
              âge ; celui-ci n'est plus qu'un repli. Le dire ici évite de
              croire que les deux se cumulent, ou qu'il faut choisir. */}
          <RateField
            kind="lpp"
            label="Taux unique du 2ᵉ pilier — repli"
            value={str("lpp_employee_share_pct")}
            onChange={(v) => set("lpp_employee_share_pct", v)}
            footnote="Utilisé seulement si le plan par tranches, plus bas, ne couvre pas votre âge — ou si vous n'en avez pas saisi."
          />
          <div className="sm:col-span-2">
            <Checkbox
              label="Déduction de coordination réduite au taux d'occupation"
              checked={form.lpp_coordination_part_time === true}
              onChange={(v) => set("lpp_coordination_part_time", v)}
              hint="La loi fixe une déduction en francs, la même pour tous ; beaucoup de caisses la réduisent au prorata pour les temps partiels, et le plan le dit alors noir sur blanc. À 50 % d'activité l'écart est majeur : la déduction pleine écrase le salaire assuré, donc la retenue."
            />
          </div>
          <Field label="Assureur LAA">
            <Input value={str("laa_insurer")} onChange={(e) => set("laa_insurer", e.target.value)} />
          </Field>
          <RateField
            kind="laa"
            value={str("laa_nonoccupational_pct")}
            onChange={(v) => set("laa_nonoccupational_pct", v)}
          />
          <RateField
            kind="ijm"
            value={str("ijm_employee_pct")}
            onChange={(v) => set("ijm_employee_pct", v)}
          />
        </CardContent>
      </Card>
      )}

      {shows("expenses") && (
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
      )}

      {shows("tax") && (
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
      )}

      {/* Le récapitulatif : ce que l'enregistrement va réellement changer.
          Le montrer AVANT d'écrire est tout l'intérêt d'« annoncer » — on
          vérifie qu'on annonce bien ce qu'on croit annoncer. */}
      {wizard && shows("recap") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ce qui change</CardTitle>
            <p className="text-xs text-muted-foreground">
              À partir du {str("started_on") ? formatDate(str("started_on")) : "…"}. Tout ce
              qui précède cette date reste jugé avec les conditions actuelles.
            </p>
          </CardHeader>
          <CardContent>
            {pendingChanges.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Rien ne change par rapport aux conditions en vigueur. Revenez en arrière pour
                modifier quelque chose, ou annulez : enregistrer une version identique
                n'apporterait rien.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {pendingChanges.map((c) => (
                  <li key={c.label} className="flex flex-wrap items-baseline gap-x-2 p-2.5 text-sm">
                    <span className="min-w-48 flex-1 font-medium">{c.label}</span>
                    <span className="text-muted-foreground line-through">{c.before}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-medium">{c.after}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {wizard && step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep((n) => n - 1)}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              Retour
            </Button>
          )}
          {mode !== "view" && (
            <Button type="button" variant="ghost" onClick={cancelEdit} disabled={saving}>
              Annuler
            </Button>
          )}
          {/* Discret et nommé sans ambiguïté : ce n'est pas la porte qu'on
              prend quand ses conditions ont changé. */}
          {readOnly && versions.length > 0 && (
            <button
              type="button"
              onClick={startFix}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Corriger une erreur de saisie
            </button>
          )}
        </div>

        <div className="flex gap-2">
          {wizard && !lastStep && (
            <Button type="button" onClick={() => setStep((n) => n + 1)}>
              Suivant
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {(!wizard || lastStep) && !readOnly && (
            <Button
              type="submit"
              disabled={saving || (wizard && pendingChanges.length === 0)}
            >
              <Save className="h-4 w-4" />
              {saving
                ? "Enregistrement…"
                : wizard
                  ? "Enregistrer le changement"
                  : "Enregistrer la correction"}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
