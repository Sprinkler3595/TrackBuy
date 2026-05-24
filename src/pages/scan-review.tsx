import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  CheckCircle2,
  Loader2,
  ListChecks,
  Sparkles,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { QuickCreateDialog, type QuickCreateEntity } from "@/components/features/quick-create-dialog"
import { invalidateThumbnail } from "@/components/features/item-thumbnail"
import { findMerchantByName } from "@/lib/fuzzy-match"
import * as api from "@/lib/tauri"

import { HeaderStep } from "@/components/features/scan-review/header-step"
import { ItemStep } from "@/components/features/scan-review/item-step"
import {
  emptyDraft,
  type ItemDraft,
  type PendingReceipt,
  type SharedState,
  PENDING_RECEIPT_KEY,
  KIND_CODE_TYPE,
} from "@/components/features/scan-review/types"

/**
 * Scan-review wizard. Walks the user through a freshly OCR'd receipt one item
 * at a time, with kind-aware fields, then creates everything in one batch.
 *
 * Step layout:
 *   0           → HeaderStep (shared invoice fields)
 *   1..N        → ItemStep (one per draft)
 *   N+1         → recap with "Créer tout"
 *
 * Drafts and shared state are persisted to sessionStorage on every change so a
 * refresh mid-flow doesn't lose data. The "Ajouter un article" button on the
 * recap page appends an empty draft and jumps to it.
 */

const today = () => new Date().toISOString().slice(0, 10)

const blankShared = (): SharedState => ({
  merchant_id: "",
  location_id: "",
  payment_card_id: "",
  purchase_date: today(),
  currency: "CHF",
  invoice_number: "",
  notes: "",
  invoiceFile: null,
  purchaseOrderFile: null,
  merchantHint: "",
  discounts: [],
})

export function ScanReviewPage() {
  const navigate = useNavigate()
  const { toast } = useToast()

  // Reference data for selectors.
  const [merchants, setMerchants] = useState<api.Merchant[]>([])
  const [locations, setLocations] = useState<api.Location[]>([])
  const [cards, setCards] = useState<api.PaymentCard[]>([])
  const [refDataLoaded, setRefDataLoaded] = useState(false)

  // Wizard state.
  const [shared, setShared] = useState<SharedState>(blankShared)
  const [drafts, setDrafts] = useState<ItemDraft[]>([])
  const [originalAttach, setOriginalAttach] = useState<{ path: string; name: string } | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [quickCreate, setQuickCreate] = useState<QuickCreateEntity | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmQuit, setConfirmQuit] = useState(false)
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState<number | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // ------------------ Initial load ------------------
  useEffect(() => {
    Promise.all([api.getMerchants(), api.getLocations(), api.getCards()])
      .then(([m, l, c]) => {
        setMerchants(m)
        setLocations(l)
        setCards(c)
      })
      .catch((err) => console.error("Failed to load reference data:", err))
      .finally(() => setRefDataLoaded(true))
  }, [])

  // Hydrate the wizard state from sessionStorage AFTER reference data is
  // loaded (so we can fuzzy-match the OCR merchant name immediately).
  useEffect(() => {
    if (!refDataLoaded || hydrated) return
    try {
      const raw = sessionStorage.getItem(PENDING_RECEIPT_KEY)
      if (!raw) {
        // No queue → nothing to review. Send the user back to the scan page.
        toast("Aucune facture à vérifier. Lance d'abord un scan.", "error")
        navigate("/scan")
        return
      }
      const payload = JSON.parse(raw) as PendingReceipt
      const matched = payload.shared.merchantHint
        ? findMerchantByName(payload.shared.merchantHint, merchants)
        : null
      setShared({
        ...blankShared(),
        purchase_date: payload.shared.purchase_date || today(),
        currency: payload.shared.currency || "CHF",
        invoice_number: payload.shared.invoice_number || "",
        notes: payload.shared.notes || "",
        merchantHint: payload.shared.merchantHint || "",
        merchant_id: matched?.id || "",
        discounts: payload.shared.discounts || [],
        invoiceFile: payload.attachFile && payload.attachName
          ? { path: payload.attachFile, name: payload.attachName }
          : null,
      })
      setDrafts(payload.drafts)
      setOriginalAttach(
        payload.attachFile && payload.attachName
          ? { path: payload.attachFile, name: payload.attachName }
          : null,
      )
    } catch (err) {
      console.error("Failed to hydrate scan-review:", err)
      toast("Données du scan invalides.", "error")
      navigate("/scan")
    } finally {
      setHydrated(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refDataLoaded])

  // Persist drafts to sessionStorage on every change — survives refresh, and
  // keeps the queue authoritative even while the wizard is in progress.
  useEffect(() => {
    if (!hydrated) return
    try {
      const payload: PendingReceipt = {
        shared: {
          purchase_date: shared.purchase_date,
          currency: shared.currency,
          invoice_number: shared.invoice_number,
          notes: shared.notes,
          merchantHint: shared.merchantHint,
          discounts: shared.discounts,
        },
        drafts,
        attachFile: originalAttach?.path ?? "",
        attachName: originalAttach?.name ?? "",
      }
      sessionStorage.setItem(PENDING_RECEIPT_KEY, JSON.stringify(payload))
    } catch {
      /* quota or serialization error — silently ignore, persistence is best-effort */
    }
  }, [hydrated, shared, drafts, originalAttach])

  // ------------------ Patches helpers ------------------
  const patchShared = useCallback((p: Partial<SharedState>) => {
    setShared((prev) => ({ ...prev, ...p }))
  }, [])

  const patchDraft = useCallback((idx: number, p: Partial<ItemDraft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...p } : d)))
  }, [])

  const addDraft = useCallback(() => {
    setDrafts((prev) => {
      const next = [...prev, emptyDraft(shared.currency)]
      // Jump straight to the new item so the user can edit it.
      setCurrentStep(next.length) // 0 = header, so new item idx = next.length
      return next
    })
  }, [shared.currency])

  const removeDraft = useCallback((idx: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== idx))
    // Step shifts down if we removed something before/at current.
    setCurrentStep((s) => {
      if (s > drafts.length) return drafts.length // was on recap, stay on recap
      if (s > idx + 1) return s - 1
      return s
    })
  }, [drafts.length])

  // ------------------ Navigation guards ------------------
  // Step 0 (header): can only move on once merchant + location are picked.
  const headerComplete = !!shared.merchant_id && !!shared.location_id
  // Item steps: description + a parsable price required.
  const isItemComplete = (d: ItemDraft) => {
    const trimmed = d.description.trim()
    const price = parseFloat(d.price)
    return trimmed.length > 0 && !isNaN(price)
  }

  const totalSteps = 1 /* header */ + drafts.length + 1 /* recap */
  const isHeader = currentStep === 0
  const isRecap = currentStep === totalSteps - 1
  const currentItemIdx = !isHeader && !isRecap ? currentStep - 1 : -1
  const currentDraft = currentItemIdx >= 0 ? drafts[currentItemIdx] : null

  const canGoNext = isHeader
    ? headerComplete
    : currentDraft
      ? isItemComplete(currentDraft)
      : true

  // ------------------ Submit ------------------
  const submit = async () => {
    if (!headerComplete) {
      toast("Sélectionne un marchand et un lieu d'abord", "error")
      setCurrentStep(0)
      return
    }
    if (drafts.length === 0) {
      toast("Aucun article à créer", "error")
      return
    }
    const incomplete = drafts.findIndex((d) => !isItemComplete(d))
    if (incomplete >= 0) {
      toast(`L'article ${incomplete + 1} est incomplet (description + prix obligatoires)`, "error")
      setCurrentStep(incomplete + 1)
      return
    }

    setSubmitting(true)
    const createdIds: string[] = []
    const failures: string[] = []

    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i]
      try {
        // Merge per-item notes with the shared invoice notes (if any). The
        // backend doesn't have a separate "shared notes" concept — every item
        // copy gets the combined string.
        const combinedNotes = [shared.notes.trim(), d.notes.trim()].filter(Boolean).join("\n")

        const created = await api.createItem({
          description: d.description.trim(),
          purchase_date: shared.purchase_date,
          purchase_price: parseFloat(d.price),
          currency: shared.currency || undefined,
          merchant_id: shared.merchant_id,
          location_id: shared.location_id,
          payment_card_id: shared.payment_card_id || undefined,
          invoice_number: shared.invoice_number || undefined,
          notes: combinedNotes || undefined,
          // Physical-only fields — leave undefined for digital kinds so the
          // backend keeps NULL.
          product_reference: d.item_kind === "physical" && d.product_reference ? d.product_reference : undefined,
          quantity: d.item_kind === "physical" && d.quantity ? parseInt(d.quantity) : undefined,
          price_excl_tax: d.item_kind === "physical" && d.price_excl_tax ? parseFloat(d.price_excl_tax) : undefined,
          tax_rate: d.item_kind === "physical" && d.tax_rate ? parseFloat(d.tax_rate) : undefined,
          // Kind + kind-specific.
          item_kind: d.item_kind,
          event_datetime: d.item_kind === "ticket" && d.event_datetime ? d.event_datetime : undefined,
          event_location: d.item_kind === "ticket" && d.event_location ? d.event_location : undefined,
          expiration_date: d.item_kind !== "physical" && d.expiration_date ? d.expiration_date : undefined,
          redemption_url: (d.item_kind === "license" || d.item_kind === "voucher") && d.redemption_url
            ? d.redemption_url
            : undefined,
        })
        createdIds.push(created.id)

        // Attachments: per-item photo for physical items, encrypted code for
        // digital ones. Both are best-effort — a failure here doesn't undo
        // the item creation, we just surface it in the recap toast.
        if (d.item_kind === "physical" && d.photo) {
          try {
            await api.addAttachment(created.id, d.photo.path, d.photo.name, "photo")
            invalidateThumbnail(created.id)
          } catch (err) {
            failures.push(`Photo "${d.description}": ${err}`)
          }
        }
        if (d.item_kind !== "physical" && d.code.trim()) {
          try {
            await api.addTextAttachment(
              created.id,
              d.code.trim(),
              undefined,
              KIND_CODE_TYPE[d.item_kind],
            )
          } catch (err) {
            failures.push(`Code "${d.description}": ${err}`)
          }
        }

        // Warranty: only physical items, only when a positive duration is set.
        if (d.item_kind === "physical" && d.warranty_months) {
          const months = parseInt(d.warranty_months)
          if (!isNaN(months) && months > 0) {
            try {
              await api.createWarranty({
                item_id: created.id,
                start_date: shared.purchase_date,
                duration_months: months,
              })
            } catch (err) {
              failures.push(`Garantie "${d.description}": ${err}`)
            }
          }
        }
      } catch (err) {
        failures.push(`Article ${i + 1} "${d.description}": ${err}`)
      }
    }

    // Group everything under a single order so the invoice can be shared at
    // the order level (mirrors the createOrderWithItems behaviour, but works
    // across kinds since createItem itself doesn't take an order_id).
    if (createdIds.length >= 2) {
      try {
        await api.linkItemsToOrder(createdIds)
      } catch (err) {
        failures.push(`Regroupement: ${err}`)
      }
    }

    // Shared invoice + purchase order: attach to the first item with
    // shareWithOrder=true so they show up at order level too.
    if (createdIds.length > 0 && shared.invoiceFile) {
      try {
        await api.addAttachment(
          createdIds[0],
          shared.invoiceFile.path,
          shared.invoiceFile.name,
          "invoice",
          true,
        )
      } catch (err) {
        failures.push(`Facture: ${err}`)
      }
    }
    if (createdIds.length > 0 && shared.purchaseOrderFile) {
      try {
        await api.addAttachment(
          createdIds[0],
          shared.purchaseOrderFile.path,
          shared.purchaseOrderFile.name,
          "purchase_order",
          true,
        )
      } catch (err) {
        failures.push(`Bon de commande: ${err}`)
      }
    }

    setSubmitting(false)
    sessionStorage.removeItem(PENDING_RECEIPT_KEY)

    const okCount = createdIds.length
    if (okCount === drafts.length && failures.length === 0) {
      toast(`${okCount} article${okCount > 1 ? "s" : ""} créé${okCount > 1 ? "s" : ""}`, "success")
    } else if (okCount > 0) {
      toast(`${okCount}/${drafts.length} créés — ${failures.length} avertissement${failures.length > 1 ? "s" : ""}`, "error")
      console.warn("Scan-review failures:", failures)
    } else {
      toast(`Aucun article créé. Voir la console pour les détails.`, "error")
      console.error("Scan-review failures:", failures)
      return // stay on the page so user can retry
    }

    // Pick a destination based on what was created: if all created items are
    // digital → /tickets, all physical → /items, mixed → /items (default).
    const onlyDigital = drafts.every((d) => d.item_kind !== "physical")
    navigate(onlyDigital ? "/tickets" : "/items")
  }

  // ------------------ Render ------------------
  if (!hydrated) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Vérifier la facture
          </h2>
          <p className="text-sm text-muted-foreground">
            Passe sur chaque article, ajuste les détails, puis crée le tout en un clic.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setConfirmQuit(true)}>
          Quitter
        </Button>
      </div>

      {/* Stepper bar */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        <StepDot active={currentStep === 0} done={currentStep > 0} label="Facture" onClick={() => setCurrentStep(0)} />
        {drafts.map((d, i) => (
          <StepDot
            key={i}
            active={currentStep === i + 1}
            done={currentStep > i + 1}
            label={`${i + 1}`}
            onClick={() => setCurrentStep(i + 1)}
            tone={d.item_kind}
          />
        ))}
        <StepDot
          active={isRecap}
          done={false}
          label="Récap"
          icon={<ListChecks className="h-3.5 w-3.5" />}
          onClick={() => setCurrentStep(totalSteps - 1)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {isHeader && "Informations facture"}
            {currentDraft && `Article ${currentItemIdx + 1} sur ${drafts.length}`}
            {isRecap && "Récapitulatif"}
          </CardTitle>
          {isHeader && (
            <CardDescription>
              Marchand, lieu, date et fichiers s'appliquent à tous les articles de cette facture.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isHeader && (
            <HeaderStep
              shared={shared}
              onChange={patchShared}
              merchants={merchants}
              locations={locations}
              cards={cards}
              onQuickCreate={setQuickCreate}
            />
          )}

          {currentDraft && (
            <div className="space-y-4">
              <ItemStep
                draft={currentDraft}
                onChange={(p) => patchDraft(currentItemIdx, p)}
                currency={shared.currency}
                index={currentItemIdx + 1}
                total={drafts.length}
              />
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRemoveIdx(currentItemIdx)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Retirer cet article
                </Button>
              </div>
            </div>
          )}

          {isRecap && (
            <RecapStep
              drafts={drafts}
              shared={shared}
              onEdit={(idx) => setCurrentStep(idx + 1)}
              onAdd={addDraft}
            />
          )}
        </CardContent>
      </Card>

      {/* Nav buttons */}
      <div className="flex justify-between gap-2">
        <Button
          variant="outline"
          onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
          disabled={currentStep === 0 || submitting}
        >
          <ArrowLeft className="h-4 w-4" />
          Précédent
        </Button>
        {!isRecap ? (
          <Button
            onClick={() => setCurrentStep((s) => Math.min(totalSteps - 1, s + 1))}
            disabled={!canGoNext || submitting}
          >
            Suivant
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={submitting || drafts.length === 0}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Création...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Créer {drafts.length} article{drafts.length > 1 ? "s" : ""}
              </>
            )}
          </Button>
        )}
      </div>

      {/* Header step hint when blocked */}
      {isHeader && !headerComplete && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5" />
          Sélectionne au moins un marchand et un lieu pour continuer.
        </p>
      )}

      <QuickCreateDialog
        entity={quickCreate}
        initialName={quickCreate === "merchant" ? shared.merchantHint : undefined}
        onClose={() => setQuickCreate(null)}
        onCreated={(entity, id) => {
          setQuickCreate(null)
          if (entity === "merchant") {
            api.getMerchants().then((m) => {
              setMerchants(m)
              patchShared({ merchant_id: id })
            })
          } else if (entity === "location") {
            api.getLocations().then((l) => {
              setLocations(l)
              patchShared({ location_id: id })
            })
          } else if (entity === "card") {
            api.getCards().then((c) => {
              setCards(c)
              patchShared({ payment_card_id: id })
            })
          }
        }}
      />

      <ConfirmDialog
        open={confirmQuit}
        title="Quitter sans créer ?"
        message="Les articles saisis seront perdus. Tu peux aussi revenir plus tard — la facture est conservée tant que tu ne la quittes pas explicitement."
        confirmLabel="Quitter"
        cancelLabel="Continuer la saisie"
        variant="destructive"
        onConfirm={() => {
          sessionStorage.removeItem(PENDING_RECEIPT_KEY)
          navigate("/scan")
        }}
        onCancel={() => setConfirmQuit(false)}
      />

      <ConfirmDialog
        open={confirmRemoveIdx !== null}
        title="Retirer cet article ?"
        message="L'article sera supprimé de la liste à créer. Tu peux toujours l'ajouter à nouveau depuis le récap."
        confirmLabel="Retirer"
        cancelLabel="Annuler"
        variant="destructive"
        onConfirm={() => {
          if (confirmRemoveIdx !== null) removeDraft(confirmRemoveIdx)
          setConfirmRemoveIdx(null)
        }}
        onCancel={() => setConfirmRemoveIdx(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stepper dot
// ---------------------------------------------------------------------------
interface StepDotProps {
  active: boolean
  done: boolean
  label: string
  icon?: React.ReactNode
  tone?: string
  onClick: () => void
}

const TONE_DOT: Record<string, string> = {
  physical: "bg-blue-500",
  license: "bg-violet-500",
  voucher: "bg-rose-500",
  ticket: "bg-amber-500",
}

function StepDot({ active, done, label, icon, tone, onClick }: StepDotProps) {
  const dotColor = tone ? TONE_DOT[tone] : "bg-primary"
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors shrink-0 ${
        active
          ? "border-primary bg-primary/10 text-primary font-semibold"
          : done
            ? "border-muted-foreground/30 text-muted-foreground"
            : "border-input text-muted-foreground hover:bg-accent"
      }`}
    >
      {icon ? icon : <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-primary" : done ? dotColor : "bg-muted-foreground/40"}`} />}
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Recap step
// ---------------------------------------------------------------------------
interface RecapStepProps {
  drafts: ItemDraft[]
  shared: SharedState
  onEdit: (idx: number) => void
  onAdd: () => void
}

const KIND_LABEL: Record<string, string> = {
  physical: "Article",
  license: "Licence",
  voucher: "Bon",
  ticket: "Billet",
}

function RecapStep({ drafts, shared, onEdit, onAdd }: RecapStepProps) {
  const total = drafts.reduce((sum, d) => sum + (parseFloat(d.price) || 0), 0)
  return (
    <div className="space-y-4">
      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Aucun article. Clique sur "Ajouter un article" pour commencer.
        </p>
      ) : (
        <ul className="space-y-1">
          {drafts.map((d, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onEdit(i)}
                className="flex w-full items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {KIND_LABEL[d.item_kind] ?? d.item_kind}
                  </Badge>
                  <span className="truncate">{d.description || <em className="text-muted-foreground">sans description</em>}</span>
                </div>
                <span className="font-medium tabular-nums shrink-0">
                  {(parseFloat(d.price) || 0).toFixed(2)} {shared.currency}
                </span>
              </button>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{total.toFixed(2)} {shared.currency}</span>
          </li>
        </ul>
      )}

      <Button type="button" variant="outline" onClick={onAdd} className="w-full">
        <Plus className="h-4 w-4" />
        Ajouter un article
      </Button>
    </div>
  )
}
