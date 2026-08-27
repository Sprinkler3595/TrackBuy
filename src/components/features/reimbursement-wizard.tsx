import { useContext, useEffect, useMemo, useState } from "react"
import {
  Briefcase, Check, ChevronLeft, ChevronRight, FileText, HandCoins, PackageOpen, Search, Undo2, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { useModalKeyboard } from "@/hooks/use-modal-keyboard"
import { I18nContext } from "@/lib/i18n"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { InlineCreateSelect, type InlineOption } from "@/components/ui/inline-create-select"
import { formatDate, formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// Guided creation of money you expect back.
///
/// Both real cases start from something the app already knows, so nothing is
/// retyped: an expense claim is owed by one of the EMPLOYERS registered in
/// Revenus, and a return is owed by the MERCHANT of a purchase already in
/// Achats — picking the article fills the label, the amount, the shop and the
/// invoice reference in one go.
///
/// The record is created when entering the final "documents" step (its id is
/// needed to attach files), so Back is hidden there.

type Path = "expense" | "return" | "other"
type Step = 1 | 2 | 3

const today = () => new Date().toISOString().slice(0, 10)

/// Types the assistant can produce, per path.
const RETURN_TYPES: api.ReimbursementType[] = ["product_return", "warranty_return"]
const OTHER_TYPES: api.ReimbursementType[] = ["insurance_claim", "deposit", "tax_refund", "other"]

const typeLabel = (t: api.ReimbursementType, fr: boolean): string => {
  switch (t) {
    case "product_return":  return fr ? "Retour / échange" : "Return / exchange"
    case "warranty_return": return fr ? "Panne sous garantie" : "Warranty claim"
    case "insurance_claim": return fr ? "Sinistre assurance" : "Insurance claim"
    case "deposit":         return fr ? "Caution / dépôt" : "Deposit"
    case "tax_refund":      return fr ? "Remboursement d'impôt" : "Tax refund"
    case "expense_report":  return fr ? "Note de frais" : "Expense report"
    default:                return fr ? "Autre" : "Other"
  }
}

interface ReimbursementWizardProps {
  onClose: () => void
}

export function ReimbursementWizard({ onClose }: ReimbursementWizardProps) {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()

  const [step, setStep] = useState<Step>(1)
  const [path, setPath] = useState<Path>("expense")
  const [saving, setSaving] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [createdLabel, setCreatedLabel] = useState("")

  const [employers, setEmployers] = useState<InlineOption[]>([])
  const [items, setItems] = useState<api.Item[]>([])

  useModalKeyboard(!saving, onClose)

  // Employers come from Revenus: registered creditors first, plus the ones
  // that still only exist as the free-text source of a salary.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [known, incomes, purchases] = await Promise.all([
          api.getCreditors({ creditor_type: "employer" }),
          api.getIncomes(),
          api.getItems({ kind: "physical" }),
        ])
        if (cancelled) return
        const names = new Set(known.map((c) => c.name.trim().toLowerCase()))
        const legacy = incomes
          .filter((i) => i.income_type === "salary" && i.source_name?.trim())
          .map((i) => (i.source_name as string).trim())
          .filter((n) => !names.has(n.toLowerCase()))
        const uniqueLegacy = Array.from(new Set(legacy)).map((name) => ({ id: `legacy:${name}`, name }))
        setEmployers(
          [...known.map((c) => ({ id: c.id, name: c.name })), ...uniqueLegacy]
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
        setItems(purchases)
      } catch (e) {
        if (!cancelled) toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
      }
    })()
    return () => { cancelled = true }
  }, [fr, toast])

  async function createEmployer(name: string): Promise<InlineOption | null> {
    try {
      const c = await api.createCreditor({ name: name.trim(), creditor_type: "employer" })
      setEmployers((prev) => [...prev.filter((e) => e.name !== c.name), { id: c.id, name: c.name }]
        .sort((a, b) => a.name.localeCompare(b.name)))
      return { id: c.id, name: c.name }
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
      return null
    }
  }

  // --- common ---
  const [label, setLabel] = useState("")
  const [amount, setAmount] = useState("")
  const [requestedOn, setRequestedOn] = useState(today())
  const [expectedBy, setExpectedBy] = useState("")
  const [notes, setNotes] = useState("")

  // --- expense claim ---
  const [employerId, setEmployerId] = useState("")

  // --- article return ---
  const [itemSearch, setItemSearch] = useState("")
  const [itemId, setItemId] = useState("")
  const [returnType, setReturnType] = useState<api.ReimbursementType>("product_return")

  // --- other ---
  const [otherDebtor, setOtherDebtor] = useState("")
  const [otherType, setOtherType] = useState<api.ReimbursementType>("insurance_claim")

  const employerName = employers.find((e) => e.id === employerId)?.name ?? ""
  const selectedItem = items.find((i) => i.id === itemId) ?? null

  const matches = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    const pool = q
      ? items.filter((i) =>
          i.description.toLowerCase().includes(q) ||
          (i.merchant_name ?? "").toLowerCase().includes(q))
      : items
    return pool.slice(0, 8)
  }, [items, itemSearch])

  /// Selecting an article fills everything the claim needs — that's the whole
  /// point of going through Achats rather than retyping a label and a price.
  function pickItem(item: api.Item) {
    setItemId(item.id)
    setLabel(fr ? `Retour ${item.description}` : `Return ${item.description}`)
    setAmount(String(item.purchase_price))
    setItemSearch("")
  }

  const amountValue = parseFloat(amount)
  const amountValid = !Number.isNaN(amountValue) && amountValue > 0
  const step2Valid =
    path === "expense" ? !!employerName && label.trim().length > 0 && amountValid :
    path === "return"  ? !!selectedItem && amountValid :
                         label.trim().length > 0 && amountValid

  /// Promote a legacy free-text employer to a real creditor the first time it
  /// is used, so the link is a real one from here on.
  async function resolveEmployerId(): Promise<string | null> {
    if (!employerId) return null
    if (!employerId.startsWith("legacy:")) return employerId
    const created = await createEmployer(employerId.slice("legacy:".length))
    if (created) setEmployerId(created.id)
    return created?.id ?? null
  }

  async function create() {
    setSaving(true)
    try {
      let payload: Parameters<typeof api.createPendingReimbursement>[0]
      if (path === "expense") {
        const creditorId = await resolveEmployerId()
        payload = {
          label: label.trim(),
          reimbursement_type: "expense_report",
          expected_amount: amountValue,
          currency: "CHF",
          debtor_creditor_id: creditorId,
          debtor_name: employerName || null,
          requested_on: requestedOn || null,
          expected_by: expectedBy || null,
          notes: notes.trim() || null,
        }
      } else if (path === "return" && selectedItem) {
        const source = [
          selectedItem.invoice_number ? `${fr ? "Facture" : "Invoice"} ${selectedItem.invoice_number}` : "",
          `${fr ? "acheté le" : "bought on"} ${formatDate(selectedItem.purchase_date)}`,
        ].filter(Boolean).join(" · ")
        payload = {
          label: label.trim() || selectedItem.description,
          reimbursement_type: returnType,
          expected_amount: amountValue,
          currency: selectedItem.currency || "CHF",
          item_id: selectedItem.id,
          debtor_name: selectedItem.merchant_name || null,
          source_description: source,
          requested_on: requestedOn || null,
          expected_by: expectedBy || null,
          notes: notes.trim() || null,
        }
      } else {
        payload = {
          label: label.trim(),
          reimbursement_type: otherType,
          expected_amount: amountValue,
          currency: "CHF",
          debtor_name: otherDebtor.trim() || null,
          requested_on: requestedOn || null,
          expected_by: expectedBy || null,
          notes: notes.trim() || null,
        }
      }
      const created = await api.createPendingReimbursement(payload)
      setCreatedId(created.id)
      setCreatedLabel(created.label)
      setStep(3)
      toast(fr ? "Remboursement suivi. Ajoutez vos justificatifs." : "Reimbursement tracked. Now add proofs.", "success")
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const fieldCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"

  const stepTitle =
    step === 1 ? (fr ? "Qui vous doit de l'argent ?" : "Who owes you?") :
    step === 2 ? (path === "expense" ? (fr ? "La note de frais" : "The expense claim")
                : path === "return" ? (fr ? "L'article à rendre" : "The article to return")
                : (fr ? "Le remboursement attendu" : "The expected refund")) :
                 (fr ? "Justificatifs" : "Proofs")

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              {step === 3 ? <FileText className="h-5 w-5" /> : <Undo2 className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{fr ? "Nouveau remboursement" : "New reimbursement"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {fr ? "Étape" : "Step"} {step}/3 — {stepTitle}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving} aria-label={fr ? "Fermer" : "Close"}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="space-y-2">
              <PathButton
                active={path === "expense"}
                icon={Briefcase}
                title={fr ? "Frais professionnels" : "Work expenses"}
                hint={fr
                  ? "Avancés pour l'un de vos employeurs — repris depuis vos revenus"
                  : "Paid for one of your employers — taken from your incomes"}
                onClick={() => setPath("expense")}
              />
              <PathButton
                active={path === "return"}
                icon={PackageOpen}
                title={fr ? "Retour d'article ou garantie" : "Article return or warranty"}
                hint={fr
                  ? "Un achat déjà enregistré : marchand, montant et facture repris automatiquement"
                  : "A purchase already recorded: shop, amount and invoice reused automatically"}
                onClick={() => setPath("return")}
              />
              <PathButton
                active={path === "other"}
                icon={HandCoins}
                title={fr ? "Autre remboursement" : "Other reimbursement"}
                hint={fr
                  ? "Sinistre, caution, impôt…"
                  : "Insurance claim, deposit, tax…"}
                onClick={() => setPath("other")}
              />
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {path === "expense" && (
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">{fr ? "Employeur" : "Employer"} *</label>
                  <InlineCreateSelect
                    value={employerId}
                    onChange={setEmployerId}
                    options={employers}
                    onCreate={createEmployer}
                    placeholder={fr ? "Nom de l'entreprise" : "Company name"}
                    createTitle={fr ? "Nouvel employeur" : "New employer"}
                    fr={fr}
                  />
                  {employers.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {fr
                        ? "Aucun employeur connu : créez d'abord votre salaire dans Revenus, ou ajoutez l'entreprise ici avec le +."
                        : "No employer known yet: add your salary in Incomes first, or create the company here with +."}
                    </p>
                  )}
                </div>
              )}

              {path === "return" && (
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">{fr ? "Article concerné" : "Article concerned"} *</label>
                  {selectedItem ? (
                    <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{selectedItem.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {selectedItem.merchant_name ?? (fr ? "marchand inconnu" : "unknown shop")}
                          {" · "}{formatDate(selectedItem.purchase_date)}
                          {" · "}{formatPrice(selectedItem.purchase_price, selectedItem.currency)}
                          {selectedItem.invoice_number ? ` · ${selectedItem.invoice_number}` : ""}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => { setItemId(""); setLabel(""); setAmount("") }}>
                        {fr ? "Changer" : "Change"}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={itemSearch}
                          onChange={(e) => setItemSearch(e.target.value)}
                          placeholder={fr ? "Chercher par article ou marchand…" : "Search by article or shop…"}
                          className="pl-8"
                          autoFocus
                        />
                      </div>
                      <div className="space-y-1">
                        {matches.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            {fr
                              ? "Aucun achat trouvé. Enregistrez d'abord l'achat depuis Achats (scan de la facture)."
                              : "No purchase found. Record the purchase first from Achats (invoice scan)."}
                          </p>
                        ) : matches.map((it) => (
                          <button
                            key={it.id}
                            type="button"
                            onClick={() => pickItem(it)}
                            className="flex w-full items-center justify-between gap-3 rounded-md border p-2 text-left text-sm transition-colors hover:bg-accent/40"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{it.description}</span>
                              <span className="block text-xs text-muted-foreground">
                                {it.merchant_name ?? "—"} · {formatDate(it.purchase_date)}
                              </span>
                            </span>
                            <span className="shrink-0 tabular-nums">{formatPrice(it.purchase_price, it.currency)}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {path === "return" && selectedItem && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{fr ? "Motif" : "Reason"}</label>
                  <select className={fieldCls} value={returnType}
                    onChange={(e) => setReturnType(e.target.value as api.ReimbursementType)}>
                    {RETURN_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t, fr)}</option>)}
                  </select>
                </div>
              )}

              {path === "other" && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Nature" : "Kind"}</label>
                    <select className={fieldCls} value={otherType}
                      onChange={(e) => setOtherType(e.target.value as api.ReimbursementType)}>
                      {OTHER_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t, fr)}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Qui doit payer ?" : "Who owes it?"}</label>
                    <Input value={otherDebtor} onChange={(e) => setOtherDebtor(e.target.value)}
                      placeholder={fr ? "Ex : AXA, régie, canton…" : "e.g. insurer, agency, canton…"} />
                  </div>
                </>
              )}

              {(path !== "return" || selectedItem) && (
                <>
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">{fr ? "Désignation" : "Label"} *</label>
                    <Input value={label} onChange={(e) => setLabel(e.target.value)}
                      placeholder={path === "expense"
                        ? (fr ? "Ex : Frais de déplacement août" : "e.g. August travel expenses")
                        : (fr ? "Ex : Retour clavier défectueux" : "e.g. Faulty keyboard return")} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Montant attendu (CHF)" : "Expected amount (CHF)"} *</label>
                    <Input type="number" min="0" step="0.01" value={amount}
                      onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Demandé le" : "Requested on"}</label>
                    <Input type="date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Attendu pour le" : "Expected by"}</label>
                    <Input type="date" value={expectedBy} onChange={(e) => setExpectedBy(e.target.value)} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">{fr ? "Notes" : "Notes"}</label>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          )}

          {step === 3 && createdId && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {fr
                  ? "Ajoutez les justificatifs : reçus avancés, formulaire de retour, échange de courriels. Vous pourrez en ajouter d'autres plus tard."
                  : "Attach the proofs: receipts you paid, the return form, e-mail exchanges. You can add more later."}
              </p>
              <AttachmentsPanel reimbursementId={createdId} itemDescription={createdLabel} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t p-4">
          {step === 1 && <Button variant="ghost" onClick={onClose} disabled={saving}>{fr ? "Annuler" : "Cancel"}</Button>}
          {step === 2 && (
            <Button variant="ghost" onClick={() => setStep(1)} disabled={saving}>
              <ChevronLeft className="mr-1 h-4 w-4" />{fr ? "Retour" : "Back"}
            </Button>
          )}
          {step === 3 && <span />}

          {step === 1 && (
            <Button onClick={() => setStep(2)}>
              {fr ? "Suivant" : "Next"}<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 2 && (
            <Button onClick={create} disabled={saving || !step2Valid}>
              {fr ? "Créer le suivi" : "Create"}<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 3 && (
            <Button onClick={onClose}><Check className="mr-1 h-4 w-4" />{fr ? "Terminer" : "Finish"}</Button>
          )}
        </div>
      </div>
    </div>
  )
}

function PathButton({
  active, icon: Icon, title, hint, onClick,
}: {
  active: boolean
  icon: typeof Briefcase
  title: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
        active ? "border-primary bg-primary/5" : "hover:bg-accent/40"
      }`}
    >
      <span className={`rounded-lg p-2 ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}
