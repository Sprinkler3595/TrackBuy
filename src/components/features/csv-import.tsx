import { useState } from "react"
import { Upload, X, FileText, CheckCircle2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import * as api from "@/lib/tauri"

interface CsvImportProps {
  onComplete: () => void
  onCancel: () => void
}

interface CsvRow {
  description: string
  purchase_date: string
  purchase_price: number
  currency?: string
  merchant?: string
  location?: string
  notes?: string
  invoice_number?: string
  product_reference?: string
  quantity?: number
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else cur += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === "," || ch === ";") { out.push(cur); cur = "" }
      else cur += ch
    }
  }
  out.push(cur)
  return out.map(s => s.trim())
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase())
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n)
      if (i >= 0) return i
    }
    return -1
  }
  const iDesc = idx("description", "nom", "item", "article")
  const iDate = idx("date", "purchase_date", "date_achat")
  const iPrice = idx("prix", "price", "purchase_price", "montant")
  const iCurr = idx("devise", "currency")
  const iMerch = idx("marchand", "merchant", "vendeur")
  const iLoc = idx("lieu", "location")
  const iNotes = idx("notes", "remarques")
  const iInv = idx("facture", "invoice", "invoice_number")
  const iRef = idx("reference", "référence", "product_reference")
  const iQty = idx("quantite", "quantité", "quantity", "qte")

  const rows: CsvRow[] = []
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li])
    const desc = iDesc >= 0 ? cols[iDesc] : ""
    const date = iDate >= 0 ? cols[iDate] : ""
    const priceStr = iPrice >= 0 ? cols[iPrice] : ""
    const price = parseFloat(priceStr.replace(/\s/g, "").replace(",", "."))
    if (!desc || !date || Number.isNaN(price)) continue
    rows.push({
      description: desc,
      purchase_date: date,
      purchase_price: price,
      currency: iCurr >= 0 ? cols[iCurr] || undefined : undefined,
      merchant: iMerch >= 0 ? cols[iMerch] || undefined : undefined,
      location: iLoc >= 0 ? cols[iLoc] || undefined : undefined,
      notes: iNotes >= 0 ? cols[iNotes] || undefined : undefined,
      invoice_number: iInv >= 0 ? cols[iInv] || undefined : undefined,
      product_reference: iRef >= 0 ? cols[iRef] || undefined : undefined,
      quantity: iQty >= 0 ? parseInt(cols[iQty]) || undefined : undefined,
    })
  }
  return rows
}

export function CsvImport({ onComplete, onCancel }: CsvImportProps) {
  const [rows, setRows] = useState<CsvRow[]>([])
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const { toast } = useToast()

  const handlePickFile = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const { readTextFile } = await import("@/lib/tauri")
      const selected = await open({
        multiple: false,
        title: "Importer un fichier CSV",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      })
      if (selected) {
        const text = await readTextFile(selected as string)
        const parsed = parseCsv(text)
        setRows(parsed)
        if (parsed.length === 0) {
          toast("Aucune ligne valide trouvée dans le CSV", "error")
        }
      }
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleImport = async () => {
    if (rows.length === 0) return
    setImporting(true)
    setImported(0)
    setErrors([])
    const errs: string[] = []

    let merchants: api.Merchant[] = []
    let locations: api.Location[] = []
    try {
      merchants = await api.getMerchants()
      locations = await api.getLocations()
    } catch { /* ignore */ }

    const findOrCreateMerchant = async (name: string): Promise<string | undefined> => {
      const trimmed = name.trim()
      if (!trimmed) return undefined
      const existing = merchants.find(m => m.name.toLowerCase() === trimmed.toLowerCase())
      if (existing) return existing.id
      try {
        const created = await api.createMerchant({ name: trimmed })
        merchants.push(created)
        return created.id
      } catch { return undefined }
    }

    const findOrCreateLocation = async (name: string): Promise<string | undefined> => {
      const trimmed = name.trim()
      if (!trimmed) return undefined
      const existing = locations.find(l => l.name.toLowerCase() === trimmed.toLowerCase())
      if (existing) return existing.id
      try {
        const created = await api.createLocation({ name: trimmed })
        locations.push(created)
        return created.id
      } catch { return undefined }
    }

    let done = 0
    for (const row of rows) {
      try {
        const merchant_id = row.merchant
          ? await findOrCreateMerchant(row.merchant)
          : undefined
        const location_id = row.location
          ? await findOrCreateLocation(row.location)
          : undefined
        if (!merchant_id) {
          errs.push(`Ligne "${row.description}": marchand requis`)
          continue
        }
        if (!location_id) {
          errs.push(`Ligne "${row.description}": lieu requis`)
          continue
        }
        await api.createItem({
          description: row.description,
          purchase_date: row.purchase_date,
          purchase_price: row.purchase_price,
          currency: row.currency,
          merchant_id,
          location_id,
          notes: row.notes,
          status: "owned",
          invoice_number: row.invoice_number,
          product_reference: row.product_reference,
          quantity: row.quantity,
        })
        done++
        setImported(done)
      } catch (e) {
        errs.push(`Ligne "${row.description}": ${e}`)
      }
    }
    setErrors(errs)
    setImporting(false)
    if (errs.length === 0) {
      toast(`${done} articles importés`, "success")
      onComplete()
    } else {
      toast(`${done} importés, ${errs.length} erreurs`, errs.length > done ? "error" : "success")
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" /> Importer un CSV
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              Colonnes attendues (séparateur <code>,</code> ou <code>;</code>) :
              <br />
              <code className="text-xs">description, date, prix, marchand, lieu, devise, notes, facture, reference, quantite</code>
              <br />
              Les colonnes <strong>description</strong>, <strong>date</strong> et <strong>prix</strong> sont obligatoires.
            </p>
            <Button onClick={handlePickFile} className="gap-2">
              <Upload className="h-4 w-4" /> Choisir un fichier CSV
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {rows.length} ligne{rows.length > 1 ? "s" : ""} à importer
              </p>
              {importing && (
                <p className="text-sm text-muted-foreground">
                  {imported}/{rows.length} importé{imported > 1 ? "s" : ""}…
                </p>
              )}
            </div>
            <div className="max-h-60 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">Description</th>
                    <th className="px-2 py-1 text-left font-medium">Date</th>
                    <th className="px-2 py-1 text-right font-medium">Prix</th>
                    <th className="px-2 py-1 text-left font-medium">Marchand</th>
                    <th className="px-2 py-1 text-left font-medium">Lieu</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1">{r.description}</td>
                      <td className="px-2 py-1">{r.purchase_date}</td>
                      <td className="px-2 py-1 text-right">{r.purchase_price.toFixed(2)}</td>
                      <td className="px-2 py-1">{r.merchant ?? "—"}</td>
                      <td className="px-2 py-1">{r.location ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {errors.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 max-h-40 overflow-auto">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive mb-1">
                  <AlertCircle className="h-4 w-4" /> Erreurs ({errors.length})
                </div>
                <ul className="text-xs space-y-0.5 text-destructive/90">
                  {errors.slice(0, 30).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
            {imported > 0 && errors.length === 0 && !importing && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" /> {imported} article{imported > 1 ? "s" : ""} importé{imported > 1 ? "s" : ""}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={onCancel} disabled={importing}>
                Annuler
              </Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? `Import en cours… (${imported}/${rows.length})` : `Importer ${rows.length} ligne${rows.length > 1 ? "s" : ""}`}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
