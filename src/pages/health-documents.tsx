import { useCallback, useContext, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  CheckCircle2, Circle, Download, Eye, FileText, FolderOpen, Loader2, Pencil, Sparkles, Trash2, Upload, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/components/ui/toast"
import { I18nContext } from "@/lib/i18n"
import { AttachmentViewer } from "@/components/features/attachment-viewer"
import { documentToText } from "@/lib/document-scan"
import { formatDate, cn } from "@/lib/utils"
import { HEALTH_DOC_KINDS, docAttachmentType, healthDocName, mimeOf } from "@/lib/health-docs"
import * as api from "@/lib/tauri"

/// Health-insurance documents, for the whole household, in one place.
///
/// The insurer's mail piles up: policies, premium notices, statements,
/// invoices, subsidy decisions, affiliation and cancellation letters, tax
/// certificates — for several people, every year. This page takes the
/// filing off the user's hands: drop everything at once, each file is read
/// locally and classified (what, which year, for whom) by the backend's
/// keyword rules; the user only checks the proposal. Files are then named
/// "year — kind — people — insurer" and listed by year, with what is still
/// missing for that year.

type PolicyRef = { id: string; label: string; kind: "basic" | "supplementary"; insurer: string | null; active: boolean; replaces: boolean }

type Draft = {
  path: string
  original: string
  kind: api.HealthDocKind
  year: number | null
  engagement_ids: string[]
  matched: string | null
  readable: boolean
}

const fieldCls = "h-9 rounded-md border border-input bg-background px-2 text-sm"

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function HealthDocumentsPage() {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()
  const thisYear = new Date().getFullYear()
  const [docs, setDocs] = useState<api.HealthDocument[]>([])
  const [policies, setPolicies] = useState<PolicyRef[]>([])
  const [loading, setLoading] = useState(true)
  const [year, setYear] = useState<number>(thisYear)
  const [person, setPerson] = useState<string>("")
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [reading, setReading] = useState(false)
  const [filing, setFiling] = useState(false)
  const [editing, setEditing] = useState<api.HealthDocument | null>(null)
  const [viewing, setViewing] = useState<api.Attachment | null>(null)
  const [deleting, setDeleting] = useState<api.HealthDocument | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, engagements] = await Promise.all([api.listHealthDocuments(), api.getEngagements()])
      const health = engagements.filter((e) => e.engagement_type === "insurance_health")
      const refs = await Promise.all(health.map(async (e): Promise<PolicyRef> => {
        const o = await api.getHealthOverview(e.id).catch(() => null)
        return {
          id: e.id,
          label: o?.insured_label ?? e.name,
          kind: (o?.policy?.kind ?? (e.parent_engagement_id ? "supplementary" : "basic")) as PolicyRef["kind"],
          insurer: e.creditor_name ?? null,
          active: e.status === "active",
          replaces: !!o?.policy?.replaces_engagement_id && !o?.policy?.affiliation_confirmed_on,
        }
      }))
      setDocs(list)
      setPolicies(refs)
    } catch (e) {
      toast(String(e), "error")
    } finally {
      setLoading(false)
    }
  }, [toast])
  useEffect(() => { void load() }, [load])

  const policyLabel = (id: string) => {
    const p = policies.find((x) => x.id === id)
    return p ? `${p.label} · ${p.kind === "basic" ? "LAMal" : "LCA"}${p.insurer ? ` (${p.insurer})` : ""}${p.active ? "" : fr ? " — quittée" : " — left"}` : id
  }

  // --- Ajout : lire, classer, faire vérifier -------------------------------

  async function pick() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const selected = await open({ multiple: true, title: fr ? "Documents d'assurance maladie" : "Health insurance documents" })
      if (!selected) return
      const paths = (Array.isArray(selected) ? selected : [selected]).filter(Boolean) as string[]
      if (paths.length === 0) return
      setReading(true)
      const out: Draft[] = []
      for (const path of paths) {
        const original = path.split(/[\\/]/).pop() ?? path
        let text = ""
        try {
          const bytes = bytesFromBase64(await api.readBinaryFileBase64(path))
          text = await documentToText(bytes, mimeOf(original), original)
        } catch { /* unreadable: filed by hand */ }
        const c = text.trim() ? await api.classifyHealthDocument(text) : null
        out.push({
          path,
          original,
          kind: c?.kind ?? "other",
          year: c?.year ?? thisYear,
          engagement_ids: c && c.engagement_ids.length > 0 ? c.engagement_ids : [],
          matched: c?.matched ?? null,
          readable: !!text.trim(),
        })
      }
      setDrafts(out)
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setReading(false)
    }
  }

  async function fileAll() {
    if (!drafts) return
    setFiling(true)
    let ok = 0
    try {
      for (const d of drafts) {
        const ids = d.engagement_ids.length > 0 ? d.engagement_ids : (policies[0] ? [policies[0].id] : [])
        if (ids.length === 0) continue
        const people = [...new Set(ids.map((id) => policies.find((p) => p.id === id)?.label).filter(Boolean) as string[])]
        const insurer = policies.find((p) => p.id === ids[0])?.insurer ?? null
        const name = healthDocName({ year: d.year, kind: d.kind, people, insurer, original: d.original, fr })
        const att = await api.addEngagementAttachment(ids[0], d.path, name, docAttachmentType(d.kind))
        await api.fileHealthDocument({ attachment_id: att.id, kind: d.kind, year: d.year, engagement_ids: ids })
        ok += 1
      }
      toast(fr ? `${ok} document(s) classé(s).` : `${ok} document(s) filed.`, "success")
      setDrafts(null)
      if (drafts[0]?.year) setYear(drafts[0].year)
      await load()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setFiling(false)
    }
  }

  // --- Liste, filtres, ce qui manque ---------------------------------------

  const years = useMemo(() => {
    const ys = new Set<number>([thisYear, thisYear + 1, ...docs.map((d) => d.year)])
    return [...ys].filter((y) => y > 2000).sort((a, b) => b - a)
  }, [docs, thisYear])
  const people = useMemo(() => [...new Set(policies.map((p) => p.label))], [policies])

  const shown = docs.filter((d) => d.year === year && (!person || d.people.includes(person)))
  const byKind = HEALTH_DOC_KINDS
    .map((k) => ({ ...k, items: shown.filter((d) => d.kind === k.kind) }))
    .filter((g) => g.items.length > 0)

  // For each person insured that year: the papers a Swiss household is
  // expected to keep. Ticked when a document of that kind and year is filed
  // for one of the person's policies.
  const checklist = useMemo(() => {
    const has = (kind: api.HealthDocKind, y: number, ids: string[]) =>
      docs.some((d) => d.kind === kind && d.year === y && d.engagement_ids.some((i) => ids.includes(i)))
    return people.map((label) => {
      const mine = policies.filter((p) => p.label === label)
      const ids = mine.map((p) => p.id)
      const items: { label: string; done: boolean }[] = [
        { label: fr ? `Police ${year}` : `${year} policy`, done: has("policy", year, ids) },
        { label: fr ? `Avis de prime ${year}` : `${year} premium notice`, done: has("premium_notice", year, ids) },
      ]
      if (year <= thisYear) {
        items.push({ label: fr ? `Attestation fiscale ${year - 1}` : `${year - 1} tax certificate`, done: has("tax_certificate", year - 1, ids) })
      }
      if (mine.some((p) => p.replaces)) {
        items.push({ label: fr ? "Confirmation d'affiliation (nouvelle caisse)" : "Affiliation confirmation", done: has("affiliation", year, ids) || has("affiliation", year - 1, ids) })
      }
      return { label, items }
    })
  }, [docs, people, policies, year, thisYear, fr])

  async function exportDoc(d: api.HealthDocument) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog")
      const destination = await save({ defaultPath: d.display_name, title: fr ? "Exporter le document" : "Export document" })
      if (destination) {
        await api.exportAttachment(d.attachment_id, destination)
        toast(fr ? "Document exporté." : "Document exported.", "success")
      }
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }

  const asAttachment = (d: api.HealthDocument): api.Attachment => ({
    id: d.attachment_id, item_id: null, order_id: null, engagement_id: d.engagement_ids[0] ?? null, engagement_charge_id: null,
    engagement_revision_id: null, vehicle_expense_id: null, income_id: null, income_receipt_id: null, reimbursement_id: null,
    original_name: d.display_name, display_name: d.display_name, mime_type: d.mime_type, file_path: "",
    size_bytes: d.size_bytes, attachment_type: docAttachmentType(d.kind), created_at: d.created_at,
  })

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <FolderOpen className="h-7 w-7 text-primary" />{fr ? "Documents santé" : "Health documents"}
          </h2>
          <p className="text-muted-foreground">
            {fr
              ? "Déposez tous vos courriers de caisse d'un coup : chacun est lu sur votre appareil et rangé par année, personne et type."
              : "Drop all your insurer's mail at once: each file is read on your device and filed by year, person and kind."}
          </p>
        </div>
        <Button onClick={pick} disabled={reading || policies.length === 0}>
          {reading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
          {reading ? (fr ? "Lecture…" : "Reading…") : (fr ? "Ajouter des documents" : "Add documents")}
        </Button>
      </div>

      {policies.length === 0 && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          {fr ? "Aucune assurance maladie enregistrée : créez-la d'abord depuis Engagements." : "No health insurance yet."}
        </CardContent></Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {years.map((y) => (
          <Button key={y} size="sm" variant={year === y ? "default" : "outline"} onClick={() => setYear(y)}>
            {y}<span className="ml-1 text-xs opacity-70">{docs.filter((d) => d.year === y).length}</span>
          </Button>
        ))}
        <select className={cn(fieldCls, "ml-auto")} value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">{fr ? "Toute la famille" : "Whole household"}</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-lg">{fr ? `Documents ${year}` : `${year} documents`}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {byKind.length === 0 ? (
              <p className="text-sm text-muted-foreground">{fr ? "Aucun document pour cette année." : "No document for this year."}</p>
            ) : byKind.map((g) => (
              <div key={g.kind} className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{fr ? g.fr : g.en} · {g.items.length}</p>
                {g.items.map((d) => (
                  <div key={d.attachment_id} className="flex items-center gap-3 rounded-md border p-2">
                    <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <button className="min-w-0 flex-1 text-left" onClick={() => setViewing(asAttachment(d))}>
                      <p className="truncate text-sm font-medium">{d.display_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.people.join(", ") || "—"} · {fr ? "ajouté le" : "added"} {formatDate(d.created_at)}
                        {!d.filed && <Badge variant="outline" className="ml-2">{fr ? "à vérifier" : "to check"}</Badge>}
                      </p>
                    </button>
                    <Button variant="ghost" size="icon" title={fr ? "Aperçu" : "Preview"} onClick={() => setViewing(asAttachment(d))}><Eye className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" title={fr ? "Reclasser" : "Reclassify"} onClick={() => setEditing(d)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" title={fr ? "Exporter" : "Export"} onClick={() => void exportDoc(d)}><Download className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" title={fr ? "Supprimer" : "Delete"} onClick={() => setDeleting(d)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">{fr ? `À garder pour ${year}` : `To keep for ${year}`}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {checklist.filter((c) => !person || c.label === person).map((c) => (
              <div key={c.label} className="space-y-1">
                <p className="text-sm font-medium">{c.label}</p>
                {c.items.map((i) => (
                  <p key={i.label} className={cn("flex items-center gap-2 text-sm", i.done ? "text-muted-foreground" : "")}>
                    {i.done ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Circle className="h-4 w-4 text-amber-600" />}
                    {i.label}
                  </p>
                ))}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              {fr
                ? "Décomptes et factures arrivent tout au long de l'année : ils se rangent ici sans liste à cocher. L'attestation fiscale arrive en début d'année pour la déclaration."
                : "Statements and invoices come all year round."}
            </p>
          </CardContent>
        </Card>
      </div>

      {drafts && (
        <ReviewDialog fr={fr} drafts={drafts} setDrafts={setDrafts} policies={policies} policyLabel={policyLabel}
          years={[thisYear + 1, thisYear, thisYear - 1, thisYear - 2]} filing={filing} onFile={fileAll} onClose={() => setDrafts(null)} />
      )}
      {editing && (
        <EditDialog fr={fr} doc={editing} policies={policies} policyLabel={policyLabel} years={years}
          onClose={() => setEditing(null)}
          onSave={async (kind, y, ids) => {
            try {
              await api.fileHealthDocument({ attachment_id: editing.attachment_id, kind, year: y, engagement_ids: ids })
              setEditing(null)
              await load()
            } catch (e) {
              toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
            }
          }} />
      )}
      <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} onExport={(att) => {
        const d = docs.find((x) => x.attachment_id === att.id)
        if (d) void exportDoc(d)
      }} />
      <ConfirmDialog
        open={deleting !== null}
        title={fr ? "Supprimer le document" : "Delete document"}
        message={fr ? `« ${deleting?.display_name ?? ""} » sera supprimé définitivement.` : "This document will be deleted."}
        confirmLabel={fr ? "Supprimer" : "Delete"}
        variant="destructive"
        onConfirm={async () => {
          if (!deleting) return
          try {
            await api.deleteAttachment(deleting.attachment_id)
            setDeleting(null)
            await load()
          } catch (e) {
            toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
          }
        }}
        onCancel={() => setDeleting(null)}
      />
      <p className="text-xs text-muted-foreground">
        {fr ? "Les documents restent aussi visibles dans l'onglet Pièces jointes de chaque police. " : "Documents also appear in each policy's Attachments tab. "}
        <Link to="/engagements" className="text-primary underline">{fr ? "Vos assurances" : "Your policies"}</Link>
      </p>
    </div>
  )
}

function PolicyPicker({ policies, value, onChange, policyLabel }: {
  policies: PolicyRef[]; value: string[]; onChange: (ids: string[]) => void; policyLabel: (id: string) => string
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {policies.map((p) => {
        const on = value.includes(p.id)
        return (
          <button key={p.id} type="button" onClick={() => onChange(on ? value.filter((i) => i !== p.id) : [...value, p.id])}
            className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
            {policyLabel(p.id)}
          </button>
        )
      })}
    </div>
  )
}

function ReviewDialog({ fr, drafts, setDrafts, policies, policyLabel, years, filing, onFile, onClose }: {
  fr: boolean; drafts: Draft[]; setDrafts: (d: Draft[]) => void; policies: PolicyRef[]; policyLabel: (id: string) => string
  years: number[]; filing: boolean; onFile: () => void; onClose: () => void
}) {
  const set = (i: number, patch: Partial<Draft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const unassigned = drafts.filter((d) => d.engagement_ids.length === 0).length
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="h-5 w-5 text-primary" />{fr ? `${drafts.length} document(s) à classer` : `${drafts.length} document(s) to file`}</h2>
            <p className="text-sm text-muted-foreground">{fr ? "Proposition faite d'après le contenu de chaque fichier — corrigez si besoin." : "Proposal from each file's content — correct if needed."}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {drafts.map((d, i) => (
            <div key={d.path} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.original}</span>
                {!d.readable && <Badge variant="outline">{fr ? "texte illisible — à classer à la main" : "unreadable"}</Badge>}
                {d.matched && <span className="text-xs text-muted-foreground">{fr ? "reconnu par" : "matched"} « {d.matched} »</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select className={fieldCls} value={d.kind} onChange={(e) => set(i, { kind: e.target.value as api.HealthDocKind })}>
                  {HEALTH_DOC_KINDS.map((k) => <option key={k.kind} value={k.kind}>{fr ? k.fr : k.en}</option>)}
                </select>
                <select className={fieldCls} value={d.year ?? ""} onChange={(e) => set(i, { year: e.target.value ? Number(e.target.value) : null })}>
                  {[...new Set([d.year, ...years].filter((y): y is number => y != null))].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <PolicyPicker policies={policies} value={d.engagement_ids} onChange={(ids) => set(i, { engagement_ids: ids })} policyLabel={policyLabel} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 border-t p-4">
          <span className="text-xs text-muted-foreground">
            {unassigned > 0 ? (fr ? `${unassigned} sans personne : rangé(s) sur la première police.` : `${unassigned} without a person.`) : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={filing}>{fr ? "Annuler" : "Cancel"}</Button>
            <Button onClick={onFile} disabled={filing}>{filing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{fr ? "Tout classer" : "File all"}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditDialog({ fr, doc, policies, policyLabel, years, onClose, onSave }: {
  fr: boolean; doc: api.HealthDocument; policies: PolicyRef[]; policyLabel: (id: string) => string; years: number[]
  onClose: () => void; onSave: (kind: api.HealthDocKind, year: number, ids: string[]) => void
}) {
  const [kind, setKind] = useState<api.HealthDocKind>(doc.kind)
  const [y, setY] = useState(doc.year)
  const [ids, setIds] = useState(doc.engagement_ids)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg space-y-3 rounded-lg border bg-card p-5 shadow-lg">
        <h2 className="text-lg font-semibold">{fr ? "Reclasser" : "Reclassify"}</h2>
        <p className="truncate text-sm text-muted-foreground">{doc.display_name}</p>
        <div className="flex gap-2">
          <select className={fieldCls} value={kind} onChange={(e) => setKind(e.target.value as api.HealthDocKind)}>
            {HEALTH_DOC_KINDS.map((k) => <option key={k.kind} value={k.kind}>{fr ? k.fr : k.en}</option>)}
          </select>
          <select className={fieldCls} value={y} onChange={(e) => setY(Number(e.target.value))}>
            {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
          </select>
        </div>
        <PolicyPicker policies={policies} value={ids} onChange={setIds} policyLabel={policyLabel} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{fr ? "Annuler" : "Cancel"}</Button>
          <Button onClick={() => onSave(kind, y, ids)} disabled={ids.length === 0}>{fr ? "Enregistrer" : "Save"}</Button>
        </div>
      </div>
    </div>
  )
}

