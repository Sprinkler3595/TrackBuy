import { useEffect, useState, useContext } from "react"
import { Plus, Trash2, Edit, Landmark } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { I18nContext } from "@/lib/i18n"
import * as api from "@/lib/tauri"

const CREDITOR_TYPES: api.CreditorType[] = [
  "insurer", "landlord", "utility", "telco", "tax_office",
  "leasing_company", "employer", "bank", "other",
]

const emptyForm = () => ({
  name: "",
  creditor_type: "other" as api.CreditorType,
  contact_email: "",
  contact_phone: "",
  address: "",
  iban: "",
  reference_prefix: "",
  notes: "",
})

export function CreditorsPage() {
  const { t } = useContext(I18nContext)
  const [creditors, setCreditors] = useState<api.Creditor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<api.Creditor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm())
  const { toast } = useToast()

  const load = async () => {
    try { setCreditors(await api.getCreditors()) }
    catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const resetForm = () => { setForm(emptyForm()); setEditing(null); setShowForm(false) }

  const handleEdit = (c: api.Creditor) => {
    setForm({
      name: c.name,
      creditor_type: c.creditor_type,
      contact_email: c.contact_email || "",
      contact_phone: c.contact_phone || "",
      address: c.address || "",
      iban: c.iban || "",
      reference_prefix: c.reference_prefix || "",
      notes: c.notes || "",
    })
    setEditing(c); setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editing) {
        await api.updateCreditor({
          ...editing,
          name: form.name.trim(),
          creditor_type: form.creditor_type,
          contact_email: form.contact_email || null,
          contact_phone: form.contact_phone || null,
          address: form.address || null,
          iban: form.iban || null,
          reference_prefix: form.reference_prefix || null,
          notes: form.notes || null,
        })
        toast("Créancier modifié", "success")
      } else {
        await api.createCreditor({
          name: form.name.trim(),
          creditor_type: form.creditor_type,
          contact_email: form.contact_email || null,
          contact_phone: form.contact_phone || null,
          address: form.address || null,
          iban: form.iban || null,
          reference_prefix: form.reference_prefix || null,
          notes: form.notes || null,
        })
        toast("Créancier ajouté", "success")
      }
      resetForm(); await load()
    } catch (e) { toast(`Erreur: ${e}`, "error") }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteCreditor(deleteTarget)
      toast("Créancier supprimé", "success")
      setDeleteTarget(null); await load()
    } catch (e) { toast(`Erreur: ${e}`, "error") }
  }

  const typeLabel = (k: api.CreditorType): string => {
    switch (k) {
      case "insurer":        return t("creditors.typeInsurer")
      case "landlord":       return t("creditors.typeLandlord")
      case "utility":        return t("creditors.typeUtility")
      case "telco":          return t("creditors.typeTelco")
      case "tax_office":     return t("creditors.typeTaxOffice")
      case "leasing_company":return t("creditors.typeLeasingCompany")
      case "employer":       return t("creditors.typeEmployer")
      case "bank":           return t("creditors.typeBank")
      default:               return t("creditors.typeOther")
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t("creditors.title")}</h2>
          <p className="text-muted-foreground">{t("creditors.subtitle")} · {creditors.length}</p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true) }}>
          <Plus className="h-4 w-4" />{t("creditors.new")}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{editing ? "Modifier" : t("creditors.new")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{t("creditors.name")} *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("creditors.type")}</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.creditor_type}
                  onChange={(e) => setForm({ ...form, creditor_type: e.target.value as api.CreditorType })}
                >
                  {CREDITOR_TYPES.map((k) => <option key={k} value={k}>{typeLabel(k)}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("creditors.iban")}</label>
                <Input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="CH00 0000 0000 0000 0000 0" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("creditors.referencePrefix")}</label>
                <Input value={form.reference_prefix} onChange={(e) => setForm({ ...form, reference_prefix: e.target.value })} placeholder="01-12345-6" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("creditors.contactEmail")}</label>
                <Input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("creditors.contactPhone")}</label>
                <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{t("creditors.address")}</label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{t("creditors.notes")}</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit">{editing ? t("common.save") : t("common.add")}</Button>
                <Button type="button" variant="outline" onClick={resetForm}>{t("common.cancel")}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {creditors.length === 0 ? (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
              <Landmark className="h-12 w-12 mb-4 opacity-20" />
              <p>{t("creditors.title")}</p>
            </CardContent>
          </Card>
        ) : creditors.map((c) => (
          <Card key={c.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{typeLabel(c.creditor_type)}</p>
                  {c.iban && <p className="text-xs text-muted-foreground mt-1 font-mono truncate">{c.iban}</p>}
                  {c.contact_phone && <p className="text-xs text-muted-foreground">{c.contact_phone}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(c)}><Edit className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer le créancier"
        message="Ce créancier sera supprimé définitivement."
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
