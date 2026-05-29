import { useEffect, useMemo, useState } from "react"
import { FileDown, Printer, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { formatDate, formatPrice } from "@/lib/utils"
import { itemsToCsv, downloadExport } from "@/lib/export"
import * as api from "@/lib/tauri"

/// Home-contents insurance inventory.
///
/// After a burglary or water damage, the household insurer asks for proof of
/// ownership. The app already holds the items, prices, dates, merchants and
/// (often) the invoices — this turns them into a dated, printable inventory
/// the user can hand over. Loads physical items independently of the Items
/// page filters so the inventory is always complete.
export function InsuranceInventoryModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const [allItems, setAllItems] = useState<api.Item[]>([])
  const [loading, setLoading] = useState(true)
  const [threshold, setThreshold] = useState("100")
  const [onlyActive, setOnlyActive] = useState(true)
  const [owner, setOwner] = useState("")

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const list = await api.getItems({ kind: "physical" })
        if (alive) setAllItems(list)
      } catch (e) {
        if (alive) toast(String(e), "error")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [toast])

  const minValue = Number.parseFloat(threshold) || 0

  const items = useMemo(() => {
    return allItems
      .filter((i) => (onlyActive ? i.status === "active" : true))
      .filter((i) => i.purchase_price >= minValue)
      .sort((a, b) => b.purchase_price - a.purchase_price)
  }, [allItems, onlyActive, minValue])

  // Totals are grouped by currency so a stray EUR item doesn't silently
  // inflate a CHF sum.
  const totals = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) m.set(i.currency, (m.get(i.currency) ?? 0) + i.purchase_price)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [items])

  async function exportCsv() {
    const ok = await downloadExport(
      itemsToCsv(items),
      `inventaire-assurance-${new Date().toISOString().slice(0, 10)}.csv`,
    )
    if (ok) toast("Inventaire CSV exporté.", "success")
  }

  function printReport() {
    const frame = document.createElement("iframe")
    frame.style.position = "fixed"
    frame.style.right = "0"
    frame.style.bottom = "0"
    frame.style.width = "0"
    frame.style.height = "0"
    frame.style.border = "0"
    document.body.appendChild(frame)
    const doc = frame.contentWindow?.document
    if (!doc) {
      document.body.removeChild(frame)
      toast("Impression indisponible.", "error")
      return
    }

    const esc = (s: string | null | undefined) =>
      (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

    const generatedAt = new Intl.DateTimeFormat("fr-CH", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date())

    const rows = items
      .map(
        (i) => `<tr>
          <td>${esc(i.description)}</td>
          <td>${esc(formatDate(i.purchase_date))}</td>
          <td>${esc(i.merchant_name)}</td>
          <td>${esc(i.invoice_number)}</td>
          <td class="num">${esc(formatPrice(i.purchase_price, i.currency))}</td>
        </tr>`,
      )
      .join("")

    const totalsHtml = totals
      .map(([cur, sum]) => `<div><strong>Total estimé (${esc(cur)}) :</strong> ${esc(formatPrice(sum, cur))}</div>`)
      .join("")

    doc.open()
    doc.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>Inventaire des biens</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#111;margin:2cm;}
        h1{font-size:18pt;margin:0 0 4px;}
        .meta{color:#444;font-size:10pt;margin-bottom:16px;}
        table{width:100%;border-collapse:collapse;margin-top:12px;}
        th,td{border:1px solid #999;padding:6px 8px;text-align:left;vertical-align:top;}
        th{background:#f0f0f0;font-size:10pt;}
        td.num,th.num{text-align:right;white-space:nowrap;}
        .totals{margin-top:14px;font-size:11pt;}
        .footer{margin-top:24px;color:#666;font-size:9pt;border-top:1px solid #ccc;padding-top:8px;}
      </style></head><body>
      <h1>Inventaire des biens</h1>
      <div class="meta">
        ${owner ? `Titulaire : ${esc(owner)}<br>` : ""}
        Établi le ${esc(generatedAt)}${minValue > 0 ? ` · biens d'une valeur ≥ ${esc(formatPrice(minValue, "CHF"))}` : ""}
        · ${items.length} article(s)
      </div>
      <table>
        <thead><tr>
          <th>Article</th><th>Date d'achat</th><th>Marchand</th>
          <th>N° facture / ticket</th><th class="num">Prix payé</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals">${totalsHtml}</div>
      <div class="footer">
        Document généré par TrackBuy à des fins de preuve de possession.
        Les prix indiqués sont les prix d'achat ; ils ne préjugent pas de la
        valeur de remplacement retenue par l'assurance.
      </div>
      </body></html>`)
    doc.close()
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => document.body.removeChild(frame), 1000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-4">
          <div>
            <h2 className="text-lg font-semibold">Inventaire pour l'assurance ménage</h2>
            <p className="text-sm text-muted-foreground">
              Un récapitulatif daté de vos biens, à conserver ou à remettre à
              votre assurance en cas de sinistre.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Options */}
        <div className="grid gap-3 border-b p-4 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Valeur minimale (CHF)
            </span>
            <Input
              type="number"
              min="0"
              step="10"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Titulaire (optionnel)
            </span>
            <Input
              placeholder="Prénom Nom"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
            />
            <span>Exclure les articles archivés</span>
          </label>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Chargement…</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aucun bien ne correspond (essayez d'abaisser la valeur minimale).
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Article</th>
                  <th className="py-2 pr-2 font-medium">Acheté le</th>
                  <th className="py-2 pr-2 font-medium">Marchand</th>
                  <th className="py-2 pl-2 text-right font-medium">Prix</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="py-2 pr-2">{i.description}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{formatDate(i.purchase_date)}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{i.merchant_name ?? "—"}</td>
                    <td className="py-2 pl-2 text-right tabular-nums">
                      {formatPrice(i.purchase_price, i.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4">
          <div className="text-sm">
            {totals.map(([cur, sum]) => (
              <span key={cur} className="mr-3 font-medium tabular-nums">
                Total {cur} : {formatPrice(sum, cur)}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={items.length === 0}>
              <FileDown className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button onClick={printReport} disabled={items.length === 0}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimer / PDF
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
