import { useEffect, useState } from "react"
import { X, Store, MapPin, CreditCard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { useI18n } from "@/lib/i18n"
import * as api from "@/lib/tauri"

export type QuickCreateEntity = "merchant" | "location" | "card"

interface QuickCreateDialogProps {
  entity: QuickCreateEntity | null
  initialName?: string
  onClose: () => void
  onCreated: (entity: QuickCreateEntity, id: string) => void
}

export function QuickCreateDialog({ entity, initialName, onClose, onCreated }: QuickCreateDialogProps) {
  const { locale } = useI18n()
  const { toast } = useToast()
  const [name, setName] = useState(initialName ?? "")
  const [isCreditCard, setIsCreditCard] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (entity) {
      setName(initialName ?? "")
      setIsCreditCard(false)
    }
  }, [entity, initialName])

  if (!entity) return null

  const config = {
    merchant: {
      icon: Store,
      title: locale === "fr" ? "Nouveau marchand" : "New merchant",
      placeholder: locale === "fr" ? "Ex: Apple Store" : "e.g. Apple Store",
      successFr: "Marchand ajouté",
      successEn: "Merchant added",
    },
    location: {
      icon: MapPin,
      title: locale === "fr" ? "Nouveau lieu" : "New location",
      placeholder: locale === "fr" ? "Ex: Maison" : "e.g. Home",
      successFr: "Lieu ajouté",
      successEn: "Location added",
    },
    card: {
      icon: CreditCard,
      title: locale === "fr" ? "Nouvelle carte" : "New card",
      placeholder: locale === "fr" ? "Ex: Visa Premier" : "e.g. Visa Premier",
      successFr: "Carte ajoutée",
      successEn: "Card added",
    },
  }[entity]

  const Icon = config.icon

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      let id: string
      if (entity === "merchant") {
        const m = await api.createMerchant({ name: trimmed })
        id = m.id
      } else if (entity === "location") {
        const l = await api.createLocation({ name: trimmed })
        id = l.id
      } else {
        const c = await api.createCard({ name: trimmed, is_credit_card: isCreditCard })
        id = c.id
      }
      toast(locale === "fr" ? config.successFr : config.successEn, "success")
      onCreated(entity, id)
      onClose()
    } catch (err) {
      toast(`${locale === "fr" ? "Erreur" : "Error"}: ${err}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-50 w-full max-w-md rounded-xl border bg-card p-6 shadow-2xl animate-in zoom-in-95 fade-in">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
          type="button"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-4 mb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mt-1.5">{config.title}</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {locale === "fr" ? "Nom" : "Name"} *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={config.placeholder}
              required
              autoFocus
            />
          </div>

          {entity === "card" && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isCreditCard}
                onChange={(e) => setIsCreditCard(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <span className="text-sm font-medium">
                {locale === "fr" ? "Carte de crédit" : "Credit card"}
              </span>
            </label>
          )}

          <p className="text-xs text-muted-foreground">
            {locale === "fr"
              ? "Les détails complémentaires (email, adresse, garantie...) sont modifiables depuis Paramètres."
              : "Additional details (email, address, warranty...) can be edited from Settings."}
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {locale === "fr" ? "Annuler" : "Cancel"}
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting
                ? (locale === "fr" ? "Création..." : "Creating...")
                : (locale === "fr" ? "Créer" : "Create")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
