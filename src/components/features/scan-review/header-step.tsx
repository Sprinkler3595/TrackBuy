import { Plus, FileText, ClipboardList, AlertCircle, TicketPercent, Paperclip, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DocSlot } from "@/components/features/doc-slot"
import * as api from "@/lib/tauri"
import type { SharedState } from "./types"

/**
 * Step 0 of the scan-review wizard: per-invoice fields that apply to all
 * items in the receipt — merchant, location, card, date, currency, invoice
 * documents — plus a read-only summary of discount lines (voucher items with
 * a negative price) so the user sees them without having to create them.
 *
 * Selectors follow the same `<select>` + "+" + QuickCreateDialog pattern used
 * in items.tsx and tickets.tsx so the look is familiar.
 */

interface HeaderStepProps {
  shared: SharedState
  onChange: (patch: Partial<SharedState>) => void
  merchants: api.Merchant[]
  locations: api.Location[]
  cards: api.PaymentCard[]
  onQuickCreate: (entity: "merchant" | "location" | "card") => void
  /** When the wizard was launched from a pending invoice, holds the original
   *  filename so we can show a visual hint that it will be auto-attached on
   *  submit (the user can still override by picking a file in the slot). */
  pendingInvoiceName?: string | null
}

export function HeaderStep({
  shared,
  onChange,
  merchants,
  locations,
  cards,
  onQuickCreate,
  pendingInvoiceName,
}: HeaderStepProps) {
  const discountTotal = shared.discounts.reduce((sum, d) => sum + d.price, 0)
  // Pre-attached state: a file from the pending queue is queued for auto
  // attach. The hint disappears as soon as the user manually picks one in
  // the slot (manual pick takes priority on submit).
  const showPendingHint = !!pendingInvoiceName && !shared.invoiceFile

  return (
    <div className="space-y-5">
      {/* OCR didn't match an existing merchant — nudge the user to create one. */}
      {shared.merchantHint && !shared.merchant_id && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Marchand &laquo;&nbsp;<strong>{shared.merchantHint}</strong>&nbsp;&raquo; détecté mais non
            reconnu — sélectionne-le ci-dessous ou clique sur + pour le créer.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Marchand *"
          value={shared.merchant_id}
          onChange={(v) => onChange({ merchant_id: v })}
          options={merchants.map((m) => ({ value: m.id, label: m.name }))}
          onCreate={() => onQuickCreate("merchant")}
        />
        <SelectField
          label="Lieu *"
          value={shared.location_id}
          onChange={(v) => onChange({ location_id: v })}
          options={locations.map((l) => ({ value: l.id, label: l.name }))}
          onCreate={() => onQuickCreate("location")}
        />
        <SelectField
          label="Carte de paiement"
          value={shared.payment_card_id}
          onChange={(v) => onChange({ payment_card_id: v })}
          options={cards.map((c) => ({ value: c.id, label: c.name }))}
          onCreate={() => onQuickCreate("card")}
        />
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Date d'achat *
          </label>
          <Input
            type="date"
            value={shared.purchase_date}
            onChange={(e) => onChange({ purchase_date: e.target.value })}
            required
            aria-invalid={!shared.purchase_date}
          />
          {!shared.purchase_date && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Non détectée automatiquement — saisis la date réelle de l'achat.
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Devise
          </label>
          <Input
            value={shared.currency}
            onChange={(e) => onChange({ currency: e.target.value.toUpperCase() })}
            placeholder="CHF"
            maxLength={3}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            N° de facture
          </label>
          <Input
            value={shared.invoice_number}
            onChange={(e) => onChange({ invoice_number: e.target.value })}
            placeholder="(optionnel)"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Notes (s'ajoutent à chaque article)
        </label>
        <textarea
          value={shared.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          rows={2}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="(optionnel)"
        />
      </div>

      {/* Shared documents — facture (invoice) and bon de commande (purchase
          order) attached at the order level (shareWithOrder=true on submit). */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <DocSlot
            label="Facture"
            icon={<FileText className="h-3.5 w-3.5" />}
            value={shared.invoiceFile}
            onChange={(v) => onChange({ invoiceFile: v })}
            dialogTitle="Sélectionner la facture"
          />
          {showPendingHint && (
            <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-2.5 py-2 text-xs text-blue-700 dark:text-blue-300">
              <Paperclip className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Facture déjà en file d'attente
                </p>
                <p className="truncate" title={pendingInvoiceName ?? ""}>
                  {pendingInvoiceName}
                </p>
                <p className="text-blue-700/80 dark:text-blue-300/80 mt-0.5">
                  S'attachera automatiquement. Choisis un fichier ci-dessus pour la remplacer.
                </p>
              </div>
            </div>
          )}
        </div>
        <DocSlot
          label="Bon de commande"
          icon={<ClipboardList className="h-3.5 w-3.5" />}
          value={shared.purchaseOrderFile}
          onChange={(v) => onChange({ purchaseOrderFile: v })}
          dialogTitle="Sélectionner le bon de commande"
        />
      </div>

      {/* Read-only discount summary — lines flagged as voucher with negative
          price are commercial discounts, not items to create. */}
      {shared.discounts.length > 0 && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-300">
            <TicketPercent className="h-3.5 w-3.5" />
            Remises appliquées sur la facture (info)
          </div>
          <ul className="space-y-1 text-sm">
            {shared.discounts.map((d, i) => (
              <li key={i} className="flex justify-between text-muted-foreground">
                <span>{d.description}</span>
                <span className="font-medium tabular-nums">
                  −{Math.abs(d.price).toFixed(2)} {shared.currency}
                </span>
              </li>
            ))}
            <li className="flex justify-between border-t pt-1 text-sm font-semibold text-rose-600 dark:text-rose-300">
              <span>Total remises</span>
              <span className="tabular-nums">
                {discountTotal >= 0 ? "" : "−"}{Math.abs(discountTotal).toFixed(2)} {shared.currency}
              </span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Ces lignes ne sont pas créées comme articles — elles servent uniquement à
            comprendre le total de la facture.
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local helper: select + "+" button — same pattern used in items.tsx so a
// future refactor can extract this too. Kept local for now to avoid a third
// shared component just for this wizard.
// ---------------------------------------------------------------------------
interface SelectFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  onCreate: () => void
}

function SelectField({ label, value, onChange, options, onCreate }: SelectFieldProps) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </label>
      <div className="flex gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">(aucun)</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Button type="button" variant="outline" size="icon" onClick={onCreate}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
