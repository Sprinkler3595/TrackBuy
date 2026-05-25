import { useState } from "react"
import { ArrowDown, ArrowUp, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatPrice, formatDate } from "@/lib/utils"
import { useToast } from "@/components/ui/toast"
import * as api from "@/lib/tauri"

/// Drag-and-drop / file-picker import of an ISO 20022 camt.053 statement.
/// Parsing is delegated to the Rust side (no XML lib in the frontend) and
/// the result is shown in a preview table — the user confirms before
/// anything is written to the database.
interface Props {
  onClose: () => void
}

export function Camt053Import({ onClose }: Props) {
  const { toast } = useToast()
  const [statement, setStatement] = useState<api.CamtStatement | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleFile(file: File) {
    setBusy(true)
    try {
      const text = await file.text()
      const parsed = await api.parseCamt053(text)
      setStatement(parsed)
    } catch (e) {
      toast(String(e), "error")
    } finally {
      setBusy(false)
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border bg-card shadow-lg">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">Import CamT.053</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {!statement ? (
            <div
              className="rounded-lg border-2 border-dashed p-12 text-center transition-colors hover:border-primary/50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
            >
              <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                Glissez votre fichier .xml ici
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Exporté depuis votre e-banking (UBS, PostFinance, Raiffeisen, ZKB,
                BCV…) sous le format ISO 20022 camt.053.
              </p>
              <div className="mt-4">
                <label className="inline-block">
                  <input
                    type="file"
                    accept=".xml,application/xml,text/xml"
                    className="hidden"
                    onChange={onInputChange}
                  />
                  <span className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
                    {busy ? "Lecture…" : "Choisir un fichier"}
                  </span>
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Compte</div>
                    <div className="font-mono text-xs">
                      {statement.account_iban ?? "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Transactions</div>
                    <div className="text-lg font-semibold">
                      {statement.transactions.length}
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Contrepartie</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.transactions.map((tx, i) => (
                      <tr key={i} className="border-t">
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          {tx.booking_date ? formatDate(tx.booking_date) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {tx.counterparty_name ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {tx.counterparty_iban && (
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {tx.counterparty_iban}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {tx.description || (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {tx.reference && (
                            <div className="font-mono text-[10px] text-muted-foreground">
                              Réf : {tx.reference}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                          <Badge
                            variant={tx.direction === "credit" ? "default" : "secondary"}
                            className="gap-1"
                          >
                            {tx.direction === "credit" ? (
                              <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUp className="h-3 w-3" />
                            )}
                            {formatPrice(tx.amount, tx.currency)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-lg border bg-amber-500/5 p-3 text-xs text-muted-foreground">
                <strong>Note :</strong> cet aperçu confirme que le fichier a bien
                été parsé. L'import définitif dans <code>bank_statement_transactions</code>{" "}
                avec rapprochement automatique sera branché dans une prochaine
                itération sur la page Banque.
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t p-4">
          {statement && (
            <Button variant="outline" onClick={() => setStatement(null)}>
              Charger un autre fichier
            </Button>
          )}
          <Button onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </div>
  )
}
