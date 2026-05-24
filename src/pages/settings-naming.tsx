import { useEffect, useState } from "react"
import { Loader2, RotateCcw, Save, FileSignature, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import {
  ATTACHMENT_TYPE_KEYS,
  ATTACHMENT_TYPE_LABELS,
  DEFAULT_TEMPLATES,
  invalidateTemplateCache,
  previewName,
  type AttachmentTypeKey,
  type TemplateContext,
} from "@/lib/filename-template"
import * as api from "@/lib/tauri"

/** Example data used to live-preview each template in this page. */
const EXAMPLE_CTX: TemplateContext = {
  merchant: "Aldi Suisse",
  date: "2024-05-22",
  invoice_number: "F-12345",
  product_reference: "MBP14-M3",
  quantity: 1,
  description: "MacBook Pro 14 pouces",
  item_kind: "physical",
  event_datetime: "2024-06-15",
  event_location: "Paléo Festival",
  currency: "CHF",
  ext: "pdf",
}

const EXAMPLE_ORIGINAL = "facture_originale.pdf"
const EXAMPLE_ID_HINT = "abc123"

export function NamingSettings() {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<Record<AttachmentTypeKey, string>>(
    () => ({ ...DEFAULT_TEMPLATES }),
  )
  // Track which types have a user override (so we know whether the "Reset to
  // default" button should hit the API or just refresh state).
  const [overridden, setOverridden] = useState<Set<AttachmentTypeKey>>(new Set())
  const [loading, setLoading] = useState(true)
  const [savingType, setSavingType] = useState<AttachmentTypeKey | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const rows = await api.listFilenameTemplates()
      const next: Record<AttachmentTypeKey, string> = { ...DEFAULT_TEMPLATES }
      const overrides = new Set<AttachmentTypeKey>()
      for (const row of rows) {
        if ((ATTACHMENT_TYPE_KEYS as string[]).includes(row.attachment_type)) {
          const key = row.attachment_type as AttachmentTypeKey
          next[key] = row.template
          overrides.add(key)
        }
      }
      setTemplates(next)
      setOverridden(overrides)
    } catch {
      // Browser mode or no vault — just show defaults.
      setTemplates({ ...DEFAULT_TEMPLATES })
      setOverridden(new Set())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const handleChange = (type: AttachmentTypeKey, value: string) => {
    setTemplates((prev) => ({ ...prev, [type]: value }))
  }

  const handleSave = async (type: AttachmentTypeKey) => {
    setSavingType(type)
    try {
      await api.setFilenameTemplate(type, templates[type])
      invalidateTemplateCache()
      setOverridden((prev) => new Set(prev).add(type))
      toast(`Template enregistré pour « ${ATTACHMENT_TYPE_LABELS[type]} »`, "success")
    } catch (err) {
      toast(`Échec de l'enregistrement : ${err}`, "error")
    } finally {
      setSavingType(null)
    }
  }

  const handleReset = async (type: AttachmentTypeKey) => {
    setSavingType(type)
    try {
      if (overridden.has(type)) {
        await api.resetFilenameTemplate(type)
      }
      invalidateTemplateCache()
      setTemplates((prev) => ({ ...prev, [type]: DEFAULT_TEMPLATES[type] }))
      setOverridden((prev) => {
        const next = new Set(prev)
        next.delete(type)
        return next
      })
      toast(`Défaut restauré pour « ${ATTACHMENT_TYPE_LABELS[type]} »`, "success")
    } catch (err) {
      toast(`Échec : ${err}`, "error")
    } finally {
      setSavingType(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <FileSignature className="h-5 w-5 text-primary" />
          Nommage harmonisé des pièces jointes
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Définit le nom calculé pour chaque type de fichier au moment où il est attaché à un achat,
          une commande ou un abonnement (utilise les données scannées : marchand, date, n° facture…).
          Les anciens fichiers ne sont pas modifiés.
        </p>
      </div>

      <div className="space-y-3">
        {ATTACHMENT_TYPE_KEYS.map((type) => {
          const template = templates[type]
          const isOverridden = overridden.has(type)
          const isDefault = template === DEFAULT_TEMPLATES[type]
          const isSaving = savingType === type
          const preview = (() => {
            try {
              return previewName(type, template, EXAMPLE_CTX, EXAMPLE_ORIGINAL, EXAMPLE_ID_HINT)
            } catch (err) {
              return `[erreur: ${err}]`
            }
          })()

          return (
            <Card key={type}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2">
                    {ATTACHMENT_TYPE_LABELS[type]}
                    {isOverridden && (
                      <Badge variant="secondary" className="text-[10px]">Personnalisé</Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <code className="rounded bg-muted px-1.5 py-0.5">{type}</code>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Pattern</label>
                  <Input
                    value={template}
                    onChange={(e) => handleChange(type, e.target.value)}
                    placeholder={DEFAULT_TEMPLATES[type]}
                    className="font-mono text-sm"
                    disabled={isSaving}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Aperçu</label>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 font-mono text-sm break-all">
                    {preview || <span className="text-muted-foreground italic">[vide]</span>}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleReset(type)}
                    disabled={isSaving || (isDefault && !isOverridden)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restaurer le défaut
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleSave(type)}
                    disabled={isSaving || (isDefault && !isOverridden) || template.trim() === ""}
                  >
                    {isSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Enregistrer
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader
          className="pb-3 cursor-pointer select-none"
          onClick={() => setShowHelp((v) => !v)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Aide : variables et filtres</CardTitle>
            <ChevronDown className={`h-4 w-4 transition-transform ${showHelp ? "rotate-180" : ""}`} />
          </div>
          <CardDescription>
            Syntaxe : <code>{"{variable|filtre|filtre:arg}"}</code>. Variables vides → le segment disparaît proprement.
          </CardDescription>
        </CardHeader>
        {showHelp && (
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-medium mb-1">Variables disponibles</p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground font-mono text-xs">
                <li><code>{"{merchant}"}</code> — nom du marchand</li>
                <li><code>{"{date}"}</code> — date d'achat (ISO)</li>
                <li><code>{"{invoice_number}"}</code> — n° de facture</li>
                <li><code>{"{product_reference}"}</code> — référence produit</li>
                <li><code>{"{quantity}"}</code> — quantité</li>
                <li><code>{"{description}"}</code> — libellé de l'article</li>
                <li><code>{"{item_kind}"}</code> — type d'item</li>
                <li><code>{"{event_datetime}"}</code> — date d'événement (billet)</li>
                <li><code>{"{event_location}"}</code> — lieu d'événement</li>
                <li><code>{"{currency}"}</code> — devise</li>
                <li><code>{"{ext}"}</code> — extension du fichier d'origine</li>
              </ul>
            </div>
            <div>
              <p className="font-medium mb-1">Filtres</p>
              <ul className="space-y-1 text-muted-foreground text-xs">
                <li><code className="font-mono">slug</code> — minuscules ASCII, espaces → tirets (ex: « Aldi Suisse » → <code>aldi-suisse</code>)</li>
                <li><code className="font-mono">clean</code> — garde les accents, retire seulement les caractères interdits</li>
                <li><code className="font-mono">upper</code> / <code className="font-mono">lower</code> — change la casse</li>
                <li><code className="font-mono">YYYY-MM-DD</code> / <code className="font-mono">YYYYMMDD</code> / <code className="font-mono">YYYY-MM</code> / <code className="font-mono">YYYY</code> — reformate une date</li>
                <li><code className="font-mono">truncate:N</code> — tronque à N caractères (sur la coupure de mot quand possible)</li>
                <li><code className="font-mono">pad:N</code> — zéro-padding sur les nombres</li>
                <li><code className="font-mono">{"or:'fallback'"}</code> — valeur de repli si la variable est vide</li>
              </ul>
            </div>
            <div>
              <p className="font-medium mb-1">Exemple</p>
              <p className="text-xs text-muted-foreground">
                <code className="font-mono">{"{date|YYYY-MM-DD}_{merchant|slug}_facture_{invoice_number|or:'sans-num'}.{ext}"}</code>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                →&nbsp;<code className="font-mono">2024-05-22_aldi-suisse_facture_F-12345-abc123.pdf</code>
              </p>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
