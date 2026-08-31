import { useCallback, useEffect, useMemo, useState } from "react"
import { Calendar, Copy, FileDown, RotateCcw, Save, ScrollText, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ErrorPanel } from "@/components/ui/error-panel"
import { useToast } from "@/components/ui/toast"
import { formatDate } from "@/lib/utils"
import * as api from "@/lib/tauri"
import { CANTONS } from "@/lib/cantons"

/// Paramètres → Barèmes.
///
/// L'application est livrée avec les barèmes fédéraux de chaque année, mais
/// ces chiffres bougent : l'OFAS et l'AFC les republient chaque automne, et
/// une réforme peut en changer la structure. Cet écran permet de les corriger
/// sans attendre une mise à jour de l'application.
///
/// Le principe : un champ non touché garde la valeur livrée. Ce que
/// l'utilisateur modifie est enregistré à part et signalé comme tel, de sorte
/// qu'on puisse toujours distinguer « ce que dit la loi telle que nous
/// l'avons publiée » de « ce que vous avez corrigé ».

type FieldKey = keyof api.PayrollOverrideInput

interface FieldDef {
  key: Exclude<FieldKey, "lpp_credit_brackets" | "note">
  label: string
  hint?: string
  suffix?: string
}

interface Group {
  title: string
  legal: string
  fields: FieldDef[]
}

const GROUPS: Group[] = [
  {
    title: "AVS / AI / APG",
    legal: "LAVS — cotisation paritaire, sans plafond",
    fields: [
      { key: "avs_ai_apg_employee_pct", label: "Part salarié", suffix: "%" },
      { key: "avs_ai_apg_employer_pct", label: "Part employeur", suffix: "%" },
    ],
  },
  {
    title: "Assurance-chômage",
    legal: "LACI — plafond annuel du salaire soumis",
    fields: [
      { key: "ac_employee_pct", label: "Part salarié", suffix: "%" },
      { key: "ac_ceiling", label: "Plafond annuel", suffix: "CHF" },
      {
        key: "ac_solidarity_employee_pct",
        label: "Pour-cent de solidarité",
        suffix: "%",
        hint: "Supprimé au 1.1.2023 : laisser à 0 pour les années suivantes.",
      },
    ],
  },
  {
    title: "LAA — accidents",
    legal: "LAA / OLAA",
    fields: [
      { key: "laa_max_insured", label: "Salaire annuel maximum assuré", suffix: "CHF" },
      {
        key: "laa_nonoccupational_min_weekly_hours",
        label: "Heures/semaine minimales pour l'AANP",
        suffix: "h",
        hint: "En dessous, seule l'assurance accidents professionnels de l'employeur court.",
      },
    ],
  },
  {
    title: "LPP — 2ᵉ pilier",
    legal: "LPP / OPP2 — salaire coordonné",
    fields: [
      { key: "lpp_entry_threshold", label: "Seuil d'entrée", suffix: "CHF" },
      { key: "lpp_coordination_deduction", label: "Déduction de coordination", suffix: "CHF" },
      { key: "lpp_avs_upper_limit", label: "Limite supérieure du salaire AVS", suffix: "CHF" },
      { key: "lpp_min_coordinated", label: "Salaire coordonné minimal", suffix: "CHF" },
    ],
  },
  {
    title: "Pilier 3a",
    legal: "OPP3 — plafonds de déduction",
    fields: [
      { key: "pillar3a_with_lpp", label: "Avec 2ᵉ pilier", suffix: "CHF" },
      { key: "pillar3a_without_lpp_pct", label: "Sans 2ᵉ pilier", suffix: "% du revenu" },
      { key: "pillar3a_without_lpp_cap", label: "Sans 2ᵉ pilier — plafond", suffix: "CHF" },
    ],
  },
  {
    title: "Frais professionnels",
    legal: "art. 26 LIFD — impôt fédéral direct",
    fields: [
      { key: "pro_lump_sum_pct", label: "Forfait « autres frais »", suffix: "% du net" },
      { key: "pro_lump_sum_min", label: "Forfait — minimum", suffix: "CHF" },
      { key: "pro_lump_sum_max", label: "Forfait — maximum", suffix: "CHF" },
      { key: "meals_full_year", label: "Repas hors domicile — année", suffix: "CHF" },
      { key: "meals_subsidized_year", label: "Repas, cantine subventionnée — année", suffix: "CHF" },
      { key: "meals_full_day", label: "Repas — jour", suffix: "CHF" },
      { key: "meals_subsidized_day", label: "Repas subventionné — jour", suffix: "CHF" },
      { key: "commute_cap_ifd", label: "Plafond des frais de déplacement", suffix: "CHF" },
      { key: "commute_private_car_per_km", label: "Tarif kilométrique véhicule privé", suffix: "CHF/km" },
    ],
  },
  {
    title: "Véhicule d'entreprise",
    legal: "directive AFC dès 2022 — part privée",
    fields: [
      { key: "private_car_monthly_pct", label: "Part privée mensuelle", suffix: "% du prix HT" },
      { key: "private_car_monthly_min", label: "Part privée — minimum mensuel", suffix: "CHF" },
    ],
  },
  {
    title: "Allocations familiales",
    legal: "LAFam — minimums fédéraux",
    fields: [
      { key: "family_allowance_min_child", label: "Allocation pour enfant", suffix: "CHF/mois" },
      { key: "family_allowance_min_training", label: "Allocation de formation", suffix: "CHF/mois" },
    ],
  },
]

const parseRate = (v: string): number | null => {
  const t = v.trim().replace(",", ".")
  if (!t) return null
  const n = parseFloat(t)
  return Number.isNaN(n) ? null : n
}

export function PayrollSettings() {
  const { toast } = useToast()
  const currentYear = new Date().getFullYear()

  const [year, setYear] = useState(currentYear)
  const [params, setParams] = useState<api.PayrollParamsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  /// Uniquement les champs que l'utilisateur a repris à son compte. Les
  /// autres restent aux valeurs livrées, et ne sont pas réenvoyés — c'est ce
  /// qui permet de dire, champ par champ, d'où vient le chiffre.
  const [edited, setEdited] = useState<Record<string, string>>({})

  /// « J'ai vérifié ces chiffres. » Tant que ce n'est pas coché sur une année
  /// non livrée avec l'application, les contrôles de bulletins plafonnent en
  /// avertissement : un écart pourrait venir du barème et non de l'employeur.
  const [confirmed, setConfirmed] = useState(false)
  const [inferred, setInferred] = useState<api.InferredParams | null>(null)

  /// Taux salariés cantonaux. Aucun n'est livré avec l'application : ils
  /// changent chaque année et dépendent de la caisse de compensation.
  const [cantonal, setCantonal] = useState<api.CantonalRates[]>([])
  const [cantonalDraft, setCantonalDraft] = useState({ canton: "", af: "", amat: "" })

  const [imports, setImports] = useState<api.TariffImport[]>([])
  const [importCanton, setImportCanton] = useState("")
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, list, guess, cantons] = await Promise.all([
        api.getPayrollParams(year),
        api.listTaxAtSourceImports(),
        // Les bulletins de l'année révèlent les taux réellement appliqués.
        // Sur une année ancienne, c'est souvent la seule source disponible.
        api.inferPayrollParams(year).catch(() => null),
        api.getCantonalRates(year),
      ])
      setCantonal(cantons)
      setParams(p)
      setImports(list)
      setConfirmed(p.confirmed)
      setInferred(guess)
      // Repartir de ce qui est déjà surchargé : sans cela, un simple
      // enregistrement effacerait les corrections précédentes.
      const restored: Record<string, string> = {}
      for (const k of p.overridden_fields) {
        const v = (p as unknown as Record<string, unknown>)[k]
        if (typeof v === "number") restored[k] = String(v)
      }
      setEdited(restored)
      setLoadError(null)
    } catch (e) {
      setLoadError(String(e))
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, reloadKey])

  const years = useMemo(() => {
    if (!params) return [currentYear]
    const all = new Set<number>([
      ...params.known_years,
      ...params.edited_years,
      // Une année où l'on a des bulletins mérite son barème.
      ...params.data_years,
      currentYear,
      year,
    ])
    return [...all].sort((a, b) => b - a)
  }, [params, currentYear, year])

  const shipped = (key: string): number | null => {
    if (!params) return null
    const v = (params as unknown as Record<string, unknown>)[key]
    return typeof v === "number" ? v : null
  }

  const valueOf = (key: string): string => {
    if (key in edited) return edited[key]
    const v = shipped(key)
    return v == null ? "" : String(v)
  }

  const setValue = (key: string, v: string) => setEdited((e) => ({ ...e, [key]: v }))

  const clearValue = (key: string) =>
    setEdited((e) => {
      const next = { ...e }
      delete next[key]
      return next
    })

  const dirtyCount = Object.keys(edited).length

  const save = async () => {
    setSaving(true)
    try {
      const values: api.PayrollOverrideInput = {}
      for (const [k, raw] of Object.entries(edited)) {
        const n = parseRate(raw)
        // Un champ vidé n'est pas un champ à zéro : il redevient la valeur
        // livrée, donc on ne l'envoie pas.
        if (n != null) (values as Record<string, number>)[k] = n
      }
      values.confirmed = confirmed
      const p = await api.upsertPayrollOverrides(year, values)
      setParams(p)
      setConfirmed(p.confirmed)
      toast(`Barèmes ${year} enregistrés.`, "success")
    } catch (e) {
      toast(`Erreur : ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const resetYear = async () => {
    setSaving(true)
    try {
      const p = await api.resetPayrollOverrides(year)
      setParams(p)
      setEdited({})
      setConfirmed(p.confirmed)
      toast(`Barèmes ${year} revenus aux valeurs livrées.`, "success")
    } catch (e) {
      toast(`Erreur : ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const duplicate = async () => {
    const target = year + 1
    setSaving(true)
    try {
      await api.duplicatePayrollYear(year, target)
      toast(`${year} recopié sur ${target}. Ajustez les chiffres qui changent.`, "success")
      setYear(target)
    } catch (e) {
      toast(`Erreur : ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  /// Reprendre un canton déjà saisi le RECHARGE dans le formulaire.
  ///
  /// Sans cela, corriger un seul des deux taux effaçait l'autre : le
  /// formulaire repartait vide et l'enregistrement envoie toujours les deux
  /// champs, donc `null` pour celui qu'on n'avait pas retapé. Une correction
  /// de routine détruisait une valeur juste.
  const pickCanton = (canton: string) => {
    const known = cantonal.find((c) => c.canton === canton)
    setCantonalDraft({
      canton,
      af: known?.family_allowance_employee_pct?.toString() ?? "",
      amat: known?.maternity_employee_pct?.toString() ?? "",
    })
  }

  const saveCantonal = async () => {
    const canton = cantonalDraft.canton.trim().toUpperCase()
    if (canton.length !== 2) {
      toast("Choisissez un canton.", "error")
      return
    }
    try {
      setCantonal(
        await api.upsertCantonalRates({
          canton,
          year,
          family_allowance_employee_pct: parseRate(cantonalDraft.af),
          maternity_employee_pct: parseRate(cantonalDraft.amat),
          note: null,
        }),
      )
      setCantonalDraft({ canton: "", af: "", amat: "" })
      toast(`Taux ${canton} ${year} enregistrés.`, "success")
    } catch (e) {
      toast(`Erreur : ${e}`, "error")
    }
  }

  const removeCantonal = async (canton: string) => {
    try {
      setCantonal(
        await api.upsertCantonalRates({
          canton,
          year,
          family_allowance_employee_pct: null,
          maternity_employee_pct: null,
          note: null,
        }),
      )
      toast(`Taux ${canton} retirés.`, "success")
    } catch (e) {
      toast(`Erreur : ${e}`, "error")
    }
  }

  const importTariff = async () => {
    if (!importCanton) {
      toast("Choisissez d'abord le canton du fichier.", "error")
      return
    }
    setImporting(true)
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const picked = await open({
        multiple: false,
        filters: [{ name: "Barème d'impôt à la source", extensions: ["txt", "zip", "dat"] }],
      })
      if (typeof picked !== "string") return
      const result = await api.importTaxAtSourceTariff(importCanton, year, picked)
      setImports(await api.listTaxAtSourceImports())
      toast(`${result.row_count} tranches importées pour ${result.canton} ${year}.`, "success")
    } catch (e) {
      toast(`Import impossible : ${e}`, "error")
    } finally {
      setImporting(false)
    }
  }

  const removeImport = async (canton: string, fiscalYear: number) => {
    try {
      await api.deleteTaxAtSourceImport(canton, fiscalYear)
      setImports(await api.listTaxAtSourceImports())
      toast(`Barème ${canton} ${fiscalYear} supprimé.`, "success")
    } catch (e) {
      toast(`Erreur : ${e}`, "error")
    }
  }

  if (loadError) {
    return <ErrorPanel error={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Année</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              disabled={loading || saving}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={duplicate} disabled={loading || saving}>
              <Copy className="mr-1.5 h-4 w-4" />
              Dupliquer vers {year + 1}
            </Button>
            {params && params.overridden_fields.length > 0 && (
              <Button variant="ghost" size="sm" onClick={resetYear} disabled={saving}>
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Tout réinitialiser
              </Button>
            )}
          </div>

          {params && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <ScrollText className="h-3.5 w-3.5 shrink-0" />
              <span>{params.source}</span>
              <span>· vérifié le {formatDate(params.verified_on)}</span>
              {params.estimated && (
                <Badge variant="warning">
                  Barèmes {params.effective_year} appliqués à {params.year}
                </Badge>
              )}
              {params.overridden_fields.length > 0 && (
                <Badge variant="secondary">
                  {params.overridden_fields.length} valeur
                  {params.overridden_fields.length > 1 ? "s" : ""} modifiée
                  {params.overridden_fields.length > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          )}

          {params?.estimated && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
              Aucun barème n'est publié pour {params.year} : ceux de {params.effective_year} sont
              appliqués en attendant. Dupliquez l'année précédente puis corrigez les chiffres
              parus, et cet avertissement disparaîtra.
            </p>
          )}

          {params && !params.published && (
            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-start gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                J'ai vérifié ces chiffres auprès d'une source officielle
              </label>
              <p className="pl-6 text-xs text-muted-foreground">
                {confirmed
                  ? "Les contrôles de bulletins de cette année peuvent signaler une anomalie."
                  : "Tant que ce n'est pas coché, les contrôles de bulletins de " +
                    `${params.year} plafonnent en avertissement : un écart pourrait venir du ` +
                    "barème et non de votre employeur. Pensez à enregistrer après avoir coché."}
              </p>
            </div>
          )}

          {inferred && inferred.rates.length > 0 && (
            <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
              <p className="text-sm font-medium">
                Vos bulletins de {inferred.year} révèlent ces taux
              </p>
              <p className="text-xs text-muted-foreground">
                Déduits de {inferred.receipt_count} bulletin
                {inferred.receipt_count > 1 ? "s" : ""}. Cela ne prouve pas que votre employeur
                avait raison — cela montre qu'il a été cohérent, et désigne le mois qui sort du
                lot.
              </p>
              <ul className="space-y-1.5">
                {inferred.rates.map((r) => (
                  <li key={r.field} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{r.label}</span>
                    <span className="tabular-nums">{r.value} %</span>
                    <span className="text-xs text-muted-foreground">
                      {r.agreeing}/{r.total} bulletins
                    </span>
                    {r.outliers.length > 0 && (
                      <Badge variant="warning">
                        écart : {r.outliers.join(", ")}
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setValue(r.field, String(r.value))}
                    >
                      Reprendre
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{group.title}</CardTitle>
            <p className="text-xs text-muted-foreground">{group.legal}</p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {group.fields.map((f) => {
              const isEdited = f.key in edited
              return (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <label className="text-sm font-medium">{f.label}</label>
                    {isEdited && (
                      <button
                        type="button"
                        onClick={() => clearValue(f.key)}
                        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        modifié — rétablir
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={valueOf(f.key)}
                      onChange={(e) => setValue(f.key, e.target.value)}
                      disabled={loading}
                      className={isEdited ? "border-primary/60" : undefined}
                    />
                    {f.suffix && (
                      <span className="shrink-0 text-xs text-muted-foreground">{f.suffix}</span>
                    )}
                  </div>
                  {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                </div>
              )
            })}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Retenues cantonales sur le salaire</CardTitle>
          <p className="text-xs text-muted-foreground">
            La plupart des cantons ne font cotiser que l'employeur. Trois font exception, et ces
            retenues figurent bien sur votre fiche : <strong>Vaud</strong> et{" "}
            <strong>Valais</strong> font cotiser l'employé aux allocations familiales,{" "}
            <strong>Genève</strong> prélève l'assurance maternité cantonale. Ces taux changent
            chaque année et dépendent de votre caisse de compensation : ils ne sont pas livrés
            avec l'application, votre décompte annuel de caisse ou votre fiche de salaire les
            porte.
          </p>
          <p className="text-xs text-muted-foreground">
            Saisis une fois, ils s'appliquent d'eux-mêmes à tous les bulletins de l'année dès
            que le canton est choisi sur le contrat — il n'y a rien à recopier revenu par
            revenu. « Recopier sur {year + 1} », plus haut, les emporte aussi : la nouvelle
            année démarre avec les taux de la précédente, signalés comme à vérifier.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Canton</label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={cantonalDraft.canton}
                onChange={(e) => pickCanton(e.target.value)}
              >
                <option value="">—</option>
                {CANTONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Allocations familiales (%)</label>
              <Input
                type="number"
                step="0.001"
                min="0"
                className="w-48"
                placeholder="ex. 0.131"
                value={cantonalDraft.af}
                onChange={(e) => setCantonalDraft((d) => ({ ...d, af: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Assurance maternité (%)</label>
              <Input
                type="number"
                step="0.001"
                min="0"
                className="w-48"
                placeholder="ex. 0.043"
                value={cantonalDraft.amat}
                onChange={(e) => setCantonalDraft((d) => ({ ...d, amat: e.target.value }))}
              />
            </div>
            <Button variant="outline" onClick={saveCantonal} disabled={!cantonalDraft.canton}>
              Enregistrer
            </Button>
          </div>

          {cantonal.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Aucune retenue cantonale pour {year}. Si vous travaillez hors de VD, VS ou GE,
              c'est normal — il n'y en a pas.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {cantonal.map((c) => (
                <li key={c.canton} className="flex items-center justify-between gap-3 p-3">
                  <div>
                    <p className="text-sm font-medium">{c.canton}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.family_allowance_employee_pct != null &&
                        `allocations familiales ${c.family_allowance_employee_pct} %`}
                      {c.family_allowance_employee_pct != null &&
                        c.maternity_employee_pct != null &&
                        " · "}
                      {c.maternity_employee_pct != null &&
                        `maternité ${c.maternity_employee_pct} %`}
                    </p>
                    {c.note && (
                      <p className="text-xs text-amber-600">{c.note}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeCantonal(c.canton)}
                    aria-label={`Retirer ${c.canton}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Impôt à la source — barèmes cantonaux</CardTitle>
          <p className="text-xs text-muted-foreground">
            Ces barèmes ne sont pas livrés avec l'application : l'AFC les réserve aux employeurs
            et aux éditeurs de logiciels de paie. Téléchargez celui de votre canton auprès de
            votre administration cantonale des impôts, puis importez-le ici. Tant qu'aucun
            barème n'est importé, l'application utilise le taux effectif que vous avez saisi sur
            le contrat de travail — et ne calcule rien si vous ne l'avez pas saisi.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Canton du fichier</label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={importCanton}
                onChange={(e) => setImportCanton(e.target.value)}
              >
                <option value="">—</option>
                {CANTONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={importTariff} disabled={importing || !importCanton}>
              <Upload className="mr-1.5 h-4 w-4" />
              {importing ? "Import en cours…" : `Importer le barème ${year}`}
            </Button>
          </div>

          {imports.length === 0 ? (
            <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <FileDown className="h-4 w-4 shrink-0" />
              Aucun barème importé.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {imports.map((im) => (
                <li key={im.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {im.canton} {im.fiscal_year}
                      {im.annual_model && (
                        <Badge variant="secondary" className="ml-2">modèle annuel</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {im.row_count.toLocaleString("fr-CH")} tranches · {im.source_file}
                      {im.file_created_on && ` · fichier du ${formatDate(im.file_created_on)}`}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeImport(im.canton, im.fiscal_year)}
                    aria-label={`Supprimer le barème ${im.canton} ${im.fiscal_year}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          <Calendar className="mr-1 inline h-3.5 w-3.5" />
          {dirtyCount === 0
            ? "Aucune modification : les valeurs livrées s'appliquent."
            : `${dirtyCount} valeur${dirtyCount > 1 ? "s" : ""} sera${dirtyCount > 1 ? "ont" : ""} enregistrée${dirtyCount > 1 ? "s" : ""} pour ${year}.`}
        </p>
        <Button onClick={save} disabled={saving || loading}>
          <Save className="mr-1.5 h-4 w-4" />
          Enregistrer
        </Button>
      </div>
    </div>
  )
}
