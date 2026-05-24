import { Camera, Lock, Calendar, MapPin, Link as LinkIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { DocSlot } from "@/components/features/doc-slot"
import { KindSelector } from "./kind-selector"
import type { ItemDraft } from "./types"

/**
 * Per-item form rendered as step N of the scan-review wizard.
 *
 * Shows the kind selector at the top, then a common block (description,
 * price), then a kind-conditional block:
 *   - physical → warranty, reference, quantity, HT, TVA, photo
 *   - license/voucher → secret code, expiration, redemption URL
 *   - ticket → event date/location, expiration
 *
 * Notes are always available at the bottom.
 */

interface ItemStepProps {
  draft: ItemDraft
  onChange: (patch: Partial<ItemDraft>) => void
  currency: string
  /** 1-based, for the form header (e.g. "Article 2/5"). */
  index: number
  total: number
}

export function ItemStep({ draft, onChange, currency, index, total }: ItemStepProps) {
  const isDigital = draft.item_kind !== "physical"

  // ----- Auto-compute prix HT / montant TVA -----
  // Relation : prix_TTC = prix_HT * (1 + tva/100).
  // Quand l'utilisateur modifie le TTC ou la TVA, on recalcule le HT si
  // possible. La TVA elle-même n'est recalculée que si l'utilisateur édite
  // le HT manuellement (auquel cas on déduit le taux des deux montants).
  const recomputeHtFromTtc = (ttcStr: string, rateStr: string): string | null => {
    const ttc = parseFloat(ttcStr)
    const rate = parseFloat(rateStr)
    if (isNaN(ttc) || isNaN(rate) || rate <= 0 || ttc <= 0) return null
    return (ttc / (1 + rate / 100)).toFixed(2)
  }

  const handlePriceChange = (next: string) => {
    const patch: Partial<ItemDraft> = { price: next }
    if (draft.tax_rate) {
      const ht = recomputeHtFromTtc(next, draft.tax_rate)
      if (ht !== null) patch.price_excl_tax = ht
    }
    onChange(patch)
  }

  const handleTaxRateChange = (next: string) => {
    const patch: Partial<ItemDraft> = { tax_rate: next }
    if (draft.price) {
      const ht = recomputeHtFromTtc(draft.price, next)
      if (ht !== null) patch.price_excl_tax = ht
    }
    onChange(patch)
  }

  const handleHtChange = (next: string) => {
    const patch: Partial<ItemDraft> = { price_excl_tax: next }
    // Si on a TTC + nouveau HT → déduit le taux. Évite que l'utilisateur
    // entre un HT cohérent et voie la TVA rester à zéro.
    const ttc = parseFloat(draft.price)
    const ht = parseFloat(next)
    if (!isNaN(ttc) && !isNaN(ht) && ht > 0 && ttc > ht) {
      patch.tax_rate = (((ttc - ht) / ht) * 100).toFixed(2)
    }
    onChange(patch)
  }

  // Montant TVA affiché (TTC − HT), strictement informatif.
  const taxAmount = (() => {
    const ttc = parseFloat(draft.price)
    const ht = parseFloat(draft.price_excl_tax)
    if (isNaN(ttc) || isNaN(ht)) return null
    return (ttc - ht).toFixed(2)
  })()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">
          Article {index}/{total}
        </h3>
      </div>

      <KindSelector value={draft.item_kind} onChange={(k) => onChange({ item_kind: k })} />

      {/* Common fields */}
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-4 space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Description *
          </label>
          <Input
            value={draft.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Nom de l'article"
          />
        </div>
        <div className="sm:col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Prix TTC ({currency || "—"}) *
          </label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={draft.price}
            onChange={(e) => handlePriceChange(e.target.value)}
          />
        </div>
      </div>

      {/* ---------------- Physical-specific ---------------- */}
      {draft.item_kind === "physical" && (
        <div className="space-y-3 rounded-md border bg-card/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Détails article
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Garantie (mois)
              </label>
              <Input
                type="number"
                min="0"
                value={draft.warranty_months}
                onChange={(e) => onChange({ warranty_months: e.target.value })}
                placeholder="aucune"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Quantité
              </label>
              <Input
                type="number"
                min="1"
                value={draft.quantity}
                onChange={(e) => onChange({ quantity: e.target.value })}
                placeholder="1"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Référence produit
              </label>
              <Input
                value={draft.product_reference}
                onChange={(e) => onChange({ product_reference: e.target.value })}
                placeholder="SKU / référence"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Prix HT
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={draft.price_excl_tax}
                onChange={(e) => handleHtChange(e.target.value)}
                placeholder="auto"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                TVA (%)
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={draft.tax_rate}
                onChange={(e) => handleTaxRateChange(e.target.value)}
                placeholder="8.1"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Montant TVA
              </label>
              <div
                className="flex h-10 w-full items-center rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground tabular-nums"
                title="Calculé automatiquement : prix TTC − prix HT"
              >
                {taxAmount !== null ? `${taxAmount} ${currency}` : "—"}
              </div>
            </div>
            <div className="sm:col-span-3">
              <DocSlot
                label="Photo du produit"
                icon={<Camera className="h-3.5 w-3.5" />}
                value={draft.photo}
                onChange={(v) => onChange({ photo: v })}
                dialogTitle="Sélectionner une photo"
                imageOnly
              />
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Digital-specific (license / voucher / ticket) ---------------- */}
      {isDigital && (
        <div className="space-y-3 rounded-md border bg-card/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {draft.item_kind === "ticket" ? "Détails billet" : "Détails digital"}
          </p>

          {/* Secret code (license key / voucher code / ticket code). Stored as
              an encrypted text attachment by the wizard on submit. */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" />
              Code / clé (chiffré sur disque)
            </label>
            <textarea
              value={draft.code}
              onChange={(e) => onChange({ code: e.target.value })}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              placeholder="(optionnel)"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Date d'expiration
              </label>
              <Input
                type="date"
                value={draft.expiration_date}
                onChange={(e) => onChange({ expiration_date: e.target.value })}
              />
            </div>

            {(draft.item_kind === "license" || draft.item_kind === "voucher") && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <LinkIcon className="h-3.5 w-3.5" />
                  URL d'utilisation
                </label>
                <Input
                  type="url"
                  value={draft.redemption_url}
                  onChange={(e) => onChange({ redemption_url: e.target.value })}
                  placeholder="https://..."
                />
              </div>
            )}

            {draft.item_kind === "ticket" && (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Date événement
                  </label>
                  <Input
                    type="datetime-local"
                    value={draft.event_datetime}
                    onChange={(e) => onChange({ event_datetime: e.target.value })}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    Lieu événement
                  </label>
                  <Input
                    value={draft.event_location}
                    onChange={(e) => onChange({ event_location: e.target.value })}
                    placeholder="Ex: Stade de Suisse, Berne"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Notes — always available. */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Notes (cet article uniquement)
        </label>
        <textarea
          value={draft.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          rows={2}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="(optionnel)"
        />
      </div>
    </div>
  )
}
