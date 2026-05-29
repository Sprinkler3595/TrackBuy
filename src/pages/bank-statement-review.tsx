import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import * as pdfjsLib from "pdfjs-dist"
import { ArrowLeft, Sparkles, Search, Check, X, Lightbulb, Wand2, ShoppingBag, FileQuestion } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/components/ui/toast"
import { formatPrice, formatDate, cn } from "@/lib/utils"
import { getAiSettings } from "@/lib/ai-settings"
import { findMerchantByName } from "@/lib/fuzzy-match"
import * as api from "@/lib/tauri"

// Use the same pdfjs worker config as scan.tsx — the URL is rewritten by
// Vite at build time, so this is the canonical pattern.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString()

/// Build a single text block out of a PDF document while preserving the
/// table structure. Bank statements use a column layout (Date / Texte /
/// Crédit / Débit / Valeur / Solde) — flattening every text item into a
/// single space-separated blob destroys that structure and the LLM ends
/// up inventing transactions instead of extracting them (observed with
/// PostFinance statements via ministral-3:8b).
///
/// We sort each page's items by Y descending then X ascending, and insert
/// a newline every time Y drops below the previous item's Y minus half the
/// font height — that's a robust heuristic for "next line" across all
/// Swiss bank statement layouts I've sampled.
///
/// Uses streamTextContent() + reader.read() instead of getTextContent(),
/// because pdfjs-dist v5's getTextContent() does
/// `for await (const v of readableStream)` which requires
/// `ReadableStream[Symbol.asyncIterator]` — missing in the WebKit shipped
/// with macOS Tauri webview (and webkit2gtk on Linux).
async function extractPdfText(base64: string): Promise<string> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise
  const pages: string[] = []

  type Item = { x: number; y: number; h: number; str: string }

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const stream = page.streamTextContent({}) as ReadableStream<{
      items: Array<{
        str?: string
        transform?: number[]
        height?: number
      }>
    }>
    const reader = stream.getReader()
    const items: Item[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || !Array.isArray(value.items)) continue
      for (const it of value.items) {
        if (!it || typeof it.str !== "string") continue
        if (!it.str.trim() && it.str !== " ") continue
        // transform = [a, b, c, d, e=x, f=y] (PDF matrix). y origin is at
        // the page bottom; we'll sort descending to read top-to-bottom.
        const x = it.transform?.[4] ?? 0
        const y = it.transform?.[5] ?? 0
        const h = it.height ?? 10
        items.push({ x, y, h, str: it.str })
      }
    }

    // Group items into lines by Y coordinate. A new line starts whenever
    // the current item's Y is more than half a font-height below the line
    // we're currently building.
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const lines: { y: number; items: Item[] }[] = []
    for (const it of items) {
      const tol = Math.max(it.h / 2, 3)
      const last = lines[lines.length - 1]
      if (last && Math.abs(last.y - it.y) <= tol) {
        last.items.push(it)
      } else {
        lines.push({ y: it.y, items: [it] })
      }
    }

    // Inside each line, sort by X and join with single spaces — large
    // X jumps (column gaps) are preserved by emitting multiple spaces
    // proportional to the gap, so the model sees something close to a
    // monospaced table.
    const pageLines = lines.map((line) => {
      line.items.sort((a, b) => a.x - b.x)
      let out = ""
      let prevEnd = -Infinity
      for (const it of line.items) {
        if (out === "") {
          out = it.str
        } else {
          const gap = it.x - prevEnd
          // Approximate space width as ~5 PDF units. Cap at 8 spaces to
          // avoid pathological cases where a single line of metadata
          // explodes into a wall of whitespace.
          const spaces = Math.min(8, Math.max(1, Math.round(gap / 5)))
          out += " ".repeat(spaces) + it.str
        }
        prevEnd = it.x + it.str.length * 5
      }
      return out
    })
    pages.push(pageLines.join("\n"))
  }
  return pages.join("\n\n--- PAGE BREAK ---\n\n")
}

// Étiquettes FR pour les catégories renvoyées par le classifier Rust.
const CATEGORY_LABEL: Record<string, string> = {
  courses: "Courses",
  restaurant: "Restaurant",
  carburant: "Carburant",
  sante: "Santé",
  transport: "Transport",
  telecom: "Télécom",
  streaming: "Abonnement en ligne",
  shopping: "Shopping",
  loisirs: "Loisirs",
  maison: "Maison",
  habillement: "Habillement",
  retrait: "Retrait d'espèces",
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  apple_pay: "Apple Pay",
  twint: "Twint",
  qr_bill: "QR-facture",
  lsv: "LSV",
  withdrawal: "Retrait",
  credit_card: "Carte",
}

interface TargetCandidate {
  kind: api.BankTxTargetKind
  id: string
  label: string
  hint?: string
}

type SortKey = "date" | "amount" | "status"

/// Local form state for the "Créer un achat depuis cette transaction"
/// inline mini-form. Pre-filled from the orphan bank line; the user
/// picks merchant/location and submits.
interface CreateItemFormState {
  description: string
  purchase_date: string
  purchase_price: string
  currency: string
  merchant_id: string
  location_id: string
  payment_card_id: string
  notes: string
}

/// Add `±days` days to a YYYY-MM-DD string. Used to widen the statement
/// period when pre-filtering the item candidate pool client-side.
function shiftIsoDate(iso: string | null, days: number): string | null {
  if (!iso) return null
  const d = new Date(iso + "T00:00:00")
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function BankStatementReviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [statement, setStatement] = useState<api.BankStatement | null>(null)
  const [transactions, setTransactions] = useState<api.BankStatementTransaction[]>([])
  // Enrichissement marchand/catégorie/mode-paiement par transaction id —
  // remplit l'écart entre un libellé Apple Pay brut et ce que l'utilisateur
  // veut savoir d'un coup d'œil (« Migros · Courses · Marin-Epagnier »).
  const [classifications, setClassifications] = useState<Record<string, api.Classification>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  // Re-read on each render — cheap localStorage lookup, and lets the banner
  // disappear immediately once the user toggles the AI on in Settings.
  const aiEnabled = getAiSettings().enabled

  // Candidate pool: we load every entity the user might want to match to.
  // Doing this once at mount lets the inline picker stay snappy without
  // round-tripping to the backend per row.
  const [candidates, setCandidates] = useState<TargetCandidate[]>([])
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null)
  const [pickerSearch, setPickerSearch] = useState("")
  const [learnRule, setLearnRule] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>("date")
  // Message d'un doublon potentiel détecté à la création depuis une transaction.
  const [duplicatePrompt, setDuplicatePrompt] = useState<string | null>(null)

  // Reference data for the "Créer un achat" inline form on orphan
  // transactions. Loaded alongside the candidate pool so opening the
  // form is instant.
  const [merchants, setMerchants] = useState<api.Merchant[]>([])
  const [locations, setLocations] = useState<api.Location[]>([])
  const [cards, setCards] = useState<api.PaymentCard[]>([])
  const [createItemFor, setCreateItemFor] = useState<api.BankStatementTransaction | null>(null)
  const [createItemForm, setCreateItemForm] = useState<CreateItemFormState | null>(null)

  const load = async () => {
    if (!id) return
    setLoadError(null)
    try {
      const [s, txs, eng, subs, inc, items, reimb, mList, lList, cList] = await Promise.all([
        api.getBankStatement(id),
        api.listStatementTransactions(id),
        api.getEngagements({ status: "active" }),
        api.getSubscriptions({ status: "active" }),
        api.getIncomes({ status: "active" }),
        api.getItems(),
        api.listPendingReimbursements({ status: "claimed" }),
        api.getMerchants(),
        api.getLocations(),
        api.getCards(),
      ])
      setStatement(s)
      setTransactions(txs)
      setMerchants(mList)
      setLocations(lList)
      setCards(cList)

      // Lance la classification en arrière-plan dès qu'on a les
      // transactions. Pas bloquant — la liste s'affiche tout de suite et
      // les chips marchand/catégorie apparaissent progressivement.
      if (txs.length > 0) {
        api
          .classifyTransactions(
            txs.map((t) => ({ id: t.id, description: t.raw_description })),
          )
          .then((results) => {
            const map: Record<string, api.Classification> = {}
            for (const r of results) {
              const { id, ...rest } = r
              map[id] = rest
            }
            setClassifications(map)
          })
          .catch(() => {
            // Échec silencieux : la classification est un bonus, pas un
            // bloquant. La review reste utilisable sans.
          })
      }

      // Restrict the item pool to the statement period ±7 days — outside
      // that window an item can't reasonably correspond to a line on this
      // month's statement, and keeping the picker tight makes search fast.
      const lo = shiftIsoDate(s.period_start, -7)
      const hi = shiftIsoDate(s.period_end, 7)
      const filteredItems = lo && hi
        ? items.filter((it) => it.purchase_date >= lo && it.purchase_date <= hi)
        : items

      const pool: TargetCandidate[] = []
      for (const e of eng) pool.push({ kind: "engagement", id: e.id, label: e.name, hint: e.creditor_name ?? undefined })
      for (const sub of subs) pool.push({ kind: "subscription", id: sub.id, label: sub.name, hint: sub.merchant_name ?? undefined })
      for (const i of inc) pool.push({ kind: "income", id: i.id, label: i.name, hint: i.source_name ?? undefined })
      for (const it of filteredItems.slice(0, 500)) pool.push({ kind: "item", id: it.id, label: it.description, hint: formatDate(it.purchase_date) })
      for (const r of reimb) pool.push({ kind: "reimbursement", id: r.id, label: r.label })
      setCandidates(pool)
    } catch (err) {
      const msg = String(err)
      setLoadError(msg)
      toast(`Erreur: ${msg}`, "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [id])

  // All hooks must be declared before any early return — otherwise the
  // count of hooks differs between renders ("Rendered more hooks than
  // during the previous render") which throws inside React.
  const sortedTransactions = useMemo(() => {
    const copy = [...transactions]
    switch (sortKey) {
      case "date":   return copy.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
      case "amount": return copy.sort((a, b) => b.amount - a.amount)
      case "status": {
        const order: Record<api.BankTxMatchStatus, number> = {
          unmatched: 0, suggested: 1, confirmed: 2, created: 3, ignored: 4,
        }
        return copy.sort((a, b) => order[a.match_status] - order[b.match_status])
      }
    }
  }, [transactions, sortKey])

  const totals = useMemo(() => {
    let debit = 0, credit = 0, unmatched = 0, suggested = 0, confirmed = 0
    for (const t of transactions) {
      if (t.direction === "debit") debit += t.amount; else credit += t.amount
      if (t.match_status === "unmatched") unmatched++
      else if (t.match_status === "suggested") suggested++
      else if (t.match_status === "confirmed" || t.match_status === "created") confirmed++
    }
    return { debit, credit, unmatched, suggested, confirmed }
  }, [transactions])

  const filteredCandidates = useMemo(() => {
    const q = pickerSearch.toLowerCase().trim()
    if (!q) return candidates.slice(0, 30)
    return candidates
      .filter((c) => c.label.toLowerCase().includes(q) || (c.hint ?? "").toLowerCase().includes(q))
      .slice(0, 30)
  }, [candidates, pickerSearch])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (loadError || !statement) {
    return (
      <div className="space-y-4 p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/bank-statements")}>
          <ArrowLeft className="h-4 w-4" />
          Retour aux relevés
        </Button>
        <Card>
          <CardContent className="space-y-3 p-6">
            <h2 className="text-lg font-semibold text-destructive">
              Impossible de charger ce relevé
            </h2>
            <p className="text-sm text-muted-foreground">
              {loadError ?? "Le relevé n'a pas été trouvé. Il a peut-être été supprimé."}
            </p>
            <p className="text-xs text-muted-foreground">
              ID : <code className="rounded bg-muted px-1 font-mono">{id}</code>
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleExtract = async () => {
    if (!id) return
    const aiCfg = getAiSettings()
    if (!aiCfg.enabled) {
      toast("Active l'IA dans Paramètres → Général pour parser le relevé.", "error")
      return
    }
    setExtracting(true)
    try {
      const base64 = await api.getBankStatementData(id)
      const text = await extractPdfText(base64)
      if (text.trim().length < 50) {
        toast("Le PDF semble vide ou non-textuel. Un OCR préalable n'est pas encore implémenté pour les relevés.", "error")
        setExtracting(false)
        return
      }
      const result = await api.aiExtractBankStatement(text, {
        provider: aiCfg.provider,
        apiKey: aiCfg.apiKey,
        infomaniakProductId: aiCfg.infomaniakProductId,
        ollamaUrl: aiCfg.ollamaUrl,
        model: aiCfg.model,
      })
      if (result.length === 0) {
        toast("Aucune transaction détectée par l'IA.", "error")
        setExtracting(false)
        return
      }
      await api.saveExtractedTransactions(id, result.map((t) => ({
        transaction_date: t.date,
        booking_date: t.booking_date,
        raw_description: t.description,
        amount: t.amount,
        currency: t.currency,
        direction: t.direction,
        reference_number: t.reference,
        counterparty_iban: t.counterparty_iban,
      })))
      // Run the first round of suggestions right after extraction so the
      // user lands on a partially-filled review screen.
      const suggested = await api.suggestMatchesForStatement(id)
      toast(`${result.length} transactions extraites, ${suggested} suggestions auto.`, "success")
      await load()
    } catch (err) {
      toast(`Échec extraction: ${err}`, "error")
    } finally {
      setExtracting(false)
    }
  }

  const handleSuggest = async () => {
    if (!id) return
    setSuggesting(true)
    try {
      const updated = await api.suggestMatchesForStatement(id)
      toast(`${updated} suggestions mises à jour`, "success")
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    } finally {
      setSuggesting(false)
    }
  }

  const handleConfirm = async (txId: string) => {
    const tx = transactions.find((t) => t.id === txId)
    if (!tx || !tx.match_target_kind) return
    // item_group suggestions carry their item ids in match_group_ids and
    // expose a NULL match_target_id (the order_id is minted on confirm).
    if (tx.match_target_kind !== "item_group" && !tx.match_target_id) return
    try {
      await api.applyTransactionMatch(txId, tx.match_target_kind, tx.match_target_id ?? "", learnRule)
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const handleConfirmAllSuggested = async () => {
    if (!id) return
    const suggested = transactions.filter((t) => t.match_status === "suggested" && (t.match_confidence ?? 0) >= 0.7)
    try {
      for (const tx of suggested) {
        if (!tx.match_target_kind) continue
        if (tx.match_target_kind !== "item_group" && !tx.match_target_id) continue
        await api.applyTransactionMatch(tx.id, tx.match_target_kind, tx.match_target_id ?? "", learnRule)
      }
      toast(`${suggested.length} suggestions confirmées`, "success")
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  /// Open the inline "Créer un achat" form pre-filled from the orphan
  /// transaction. Merchant is guessed via fuzzy match on the libellé;
  /// location defaults to the first available (user can change).
  const openCreateItemForm = (tx: api.BankStatementTransaction) => {
    const guessedMerchant = findMerchantByName(tx.raw_description, merchants)
    setCreateItemFor(tx)
    setCreateItemForm({
      description: tx.raw_description.slice(0, 80),
      purchase_date: tx.transaction_date,
      purchase_price: tx.amount.toFixed(2),
      currency: tx.currency,
      merchant_id: guessedMerchant?.id ?? "",
      location_id: locations[0]?.id ?? "",
      payment_card_id: "",
      notes: `Créé depuis la transaction bancaire du ${formatDate(tx.transaction_date)}`,
    })
  }

  const cancelCreateItemForm = () => {
    setCreateItemFor(null)
    setCreateItemForm(null)
  }

  const submitCreateItemForm = async () => {
    if (!createItemFor || !createItemForm) return
    if (!createItemForm.merchant_id) {
      toast("Marchand requis", "error")
      return
    }
    if (!createItemForm.location_id) {
      toast("Lieu requis", "error")
      return
    }
    const price = parseFloat(createItemForm.purchase_price)
    if (Number.isNaN(price) || price <= 0) {
      toast("Prix invalide", "error")
      return
    }
    await createItemFromTx(false)
  }

  // Création effective ; `force` court-circuite le garde-fou anti-doublon.
  const createItemFromTx = async (force: boolean) => {
    if (!createItemFor || !createItemForm) return
    const price = parseFloat(createItemForm.purchase_price)
    try {
      await api.createItemFromTransaction(
        createItemFor.id,
        {
          description: createItemForm.description.trim() || "Achat",
          purchase_date: createItemForm.purchase_date,
          purchase_price: price,
          currency: createItemForm.currency,
          merchant_id: createItemForm.merchant_id,
          location_id: createItemForm.location_id,
          payment_card_id: createItemForm.payment_card_id || undefined,
          notes: createItemForm.notes || undefined,
        },
        force,
      )
      setDuplicatePrompt(null)
      toast("Achat créé et rapproché", "success")
      cancelCreateItemForm()
      await load()
    } catch (err) {
      const msg = String(err)
      // Doublon détecté : on propose à l'utilisateur de confirmer la création.
      const marker = "DUPLICATE:"
      const idx = msg.indexOf(marker)
      if (!force && idx >= 0) {
        setDuplicatePrompt(msg.slice(idx + marker.length).trim())
        return
      }
      toast(`Erreur: ${err}`, "error")
    }
  }

  const handleCreatePendingInvoice = async (tx: api.BankStatementTransaction) => {
    try {
      await api.createPendingInvoiceFromTransaction(tx.id)
      toast("Facture en attente créée. Importe le PDF depuis la page Factures.", "success")
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const handlePick = async (txId: string, c: TargetCandidate) => {
    try {
      await api.applyTransactionMatch(txId, c.kind, c.id, learnRule)
      setPickerOpenFor(null)
      setPickerSearch("")
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const handleIgnore = async (txId: string) => {
    try {
      await api.ignoreTransaction(txId)
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const candidateLabel = (kind: api.BankTxTargetKind | null, id: string | null, fallback?: string | null): string => {
    if (!kind || !id) return fallback ?? "—"
    const c = candidates.find((c) => c.kind === kind && c.id === id)
    return c?.label ?? fallback ?? "—"
  }

  const matchBadge = (t: api.BankStatementTransaction) => {
    if (t.match_status === "confirmed" || t.match_status === "created") return <Badge variant="success">Confirmé</Badge>
    if (t.match_status === "suggested") {
      const conf = Math.round((t.match_confidence ?? 0) * 100)
      return <Badge variant="warning">Suggéré {conf}%</Badge>
    }
    if (t.match_status === "ignored") return <Badge variant="secondary">Ignoré</Badge>
    return <Badge variant="secondary">À traiter</Badge>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/bank-statements")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold truncate">{statement.label || statement.original_name}</h2>
            <p className="text-sm text-muted-foreground">
              Statut : {statement.status} · {transactions.length} transaction(s)
              {transactions.length > 0 && (
                <> · {totals.confirmed} confirmées · {totals.suggested} suggérées · {totals.unmatched} à traiter</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={learnRule} onChange={(e) => setLearnRule(e.target.checked)} />
            Apprendre la règle
          </label>
          {transactions.length === 0 ? (
            <Button onClick={handleExtract} disabled={extracting}>
              <Sparkles className="h-4 w-4" />
              {extracting ? "Extraction…" : "Extraire avec IA"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleSuggest} disabled={suggesting}>
                <Lightbulb className="h-4 w-4" />
                {suggesting ? "Recherche…" : "Re-suggérer"}
              </Button>
              <Button onClick={handleConfirmAllSuggested}>
                <Wand2 className="h-4 w-4" />
                Tout confirmer (≥ 70%)
              </Button>
            </>
          )}
        </div>
      </div>

      {!aiEnabled && transactions.length === 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              ⚠ L'IA n'est pas configurée
            </p>
            <p className="text-muted-foreground">
              Pour extraire les transactions d'un PDF, activez d'abord un fournisseur
              (Infomaniak ou Ollama) dans <strong>Réglages → Général → Extraction IA</strong>.
              Sans cette étape, le bouton « Extraire avec IA » ne pourra pas parser le PDF.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/settings")}
            >
              Configurer l'IA
            </Button>
          </CardContent>
        </Card>
      )}

      {transactions.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Crédits</p>
              <p className="text-2xl font-bold text-green-600">{formatPrice(totals.credit)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Débits</p>
              <p className="text-2xl font-bold text-destructive">{formatPrice(totals.debit)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Solde net</p>
              <p className={cn("text-2xl font-bold", totals.credit - totals.debit < 0 ? "text-destructive" : "text-green-600")}>
                {formatPrice(totals.credit - totals.debit)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {transactions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Trier par :</span>
          {(["date", "amount", "status"] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={sortKey === k ? "default" : "outline"}
              onClick={() => setSortKey(k)}
            >
              {k === "date" ? "Date" : k === "amount" ? "Montant" : "Statut"}
            </Button>
          ))}
        </div>
      )}

      {transactions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Sparkles className="h-12 w-12 mb-4 mx-auto opacity-20" />
            <p>Aucune transaction extraite.</p>
            <p className="text-xs mt-1">Clique « Extraire avec IA » pour parser le PDF avec ton modèle configuré.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedTransactions.map((t) => {
            const isCredit = t.direction === "credit"
            return (
              <Card key={t.id} className={cn(t.match_status === "ignored" && "opacity-50")}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-24 text-xs text-muted-foreground shrink-0">{formatDate(t.transaction_date)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{t.raw_description}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {matchBadge(t)}
                        {/* Flag for "matched against an existing purchase" —
                            distinguishes item/item_group suggestions from the
                            libellé-based engagement/subscription matches. */}
                        {(t.match_target_kind === "item" || t.match_target_kind === "item_group") &&
                          (t.match_confidence ?? 0) >= 0.7 && (
                            <Badge variant="outline" className="text-[10px]">
                              {t.match_target_kind === "item_group" ? "Achats groupés" : "Achat existant"}
                            </Badge>
                          )}
                        {t.match_target_kind && (t.match_target_id || t.match_target_label) && (
                          <span className="text-xs text-muted-foreground truncate">
                            → {candidateLabel(t.match_target_kind, t.match_target_id, t.match_target_label)}
                            <span className="text-muted-foreground/60 ml-1">({t.match_target_kind})</span>
                          </span>
                        )}
                        {t.reference_number && <span className="text-xs text-muted-foreground/60 font-mono">{t.reference_number}</span>}
                      </div>
                      {/* Enrichissement auto-calculé : marchand canonique +
                          catégorie + mode de paiement détectés depuis le
                          libellé. Donne en un coup d'œil "Migros · Courses ·
                          Marin-Epagnier" là où le libellé brut PostFinance
                          enterre l'info dans 80 caractères de boilerplate. */}
                      {classifications[t.id] && (classifications[t.id].merchant || classifications[t.id].payment_method) && (
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          {classifications[t.id].merchant && (
                            <Badge variant="outline" className="text-[10px]">
                              {classifications[t.id].merchant}
                            </Badge>
                          )}
                          {classifications[t.id].category && (
                            <Badge variant="secondary" className="text-[10px]">
                              {CATEGORY_LABEL[classifications[t.id].category!] ?? classifications[t.id].category}
                            </Badge>
                          )}
                          {classifications[t.id].payment_method && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              {PAYMENT_METHOD_LABEL[classifications[t.id].payment_method!] ?? classifications[t.id].payment_method}
                            </Badge>
                          )}
                          {classifications[t.id].city && (
                            <span className="text-[10px] text-muted-foreground">
                              📍 {classifications[t.id].city}
                            </span>
                          )}
                          {classifications[t.id].tax_category && (
                            <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-300">
                              Déductible ({classifications[t.id].tax_category})
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <div className={cn("font-semibold shrink-0 tabular-nums", isCredit ? "text-green-600" : "text-destructive")}>
                      {isCredit ? "+" : "−"} {formatPrice(t.amount, t.currency)}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {t.match_target_kind && t.match_status === "suggested" && (
                        <Button variant="ghost" size="icon" onClick={() => handleConfirm(t.id)} title="Confirmer la suggestion">
                          <Check className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => { setPickerOpenFor(t.id); setPickerSearch(t.raw_description.slice(0, 30)) }} title="Choisir une cible">
                        <Search className="h-4 w-4" />
                      </Button>
                      {/* Orphan-line actions: appear only for unmatched debit
                          lines (credits aren't purchases). "Créer un achat"
                          pre-fills the form with the bank line's data;
                          "Facture en attente" enqueues a placeholder for a
                          PDF the user will upload later. */}
                      {t.match_status === "unmatched" && t.direction === "debit" && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openCreateItemForm(t)}
                            title="Créer un achat depuis cette transaction"
                          >
                            <ShoppingBag className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCreatePendingInvoice(t)}
                            title="Créer une facture en attente"
                          >
                            <FileQuestion className="h-4 w-4 text-amber-600" />
                          </Button>
                        </>
                      )}
                      {t.match_status !== "ignored" && (
                        <Button variant="ghost" size="icon" onClick={() => handleIgnore(t.id)} title="Ignorer">
                          <X className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {pickerOpenFor === t.id && (
                    <div className="mt-3 pt-3 border-t space-y-2">
                      <Input
                        autoFocus
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        placeholder="Rechercher engagement, abonnement, revenu, achat, remboursement…"
                      />
                      <div className="max-h-60 overflow-y-auto space-y-1">
                        {filteredCandidates.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">Aucun candidat. Crée d'abord l'entité dans le module correspondant.</p>
                        ) : filteredCandidates.map((c) => (
                          <button
                            key={`${c.kind}-${c.id}`}
                            type="button"
                            onClick={() => handlePick(t.id, c)}
                            className="w-full text-left flex items-center justify-between gap-3 rounded-md border bg-background hover:bg-accent px-3 py-2 text-sm"
                          >
                            <div className="min-w-0">
                              <p className="font-medium truncate">{c.label}</p>
                              {c.hint && <p className="text-xs text-muted-foreground truncate">{c.hint}</p>}
                            </div>
                            <Badge variant="secondary" className="shrink-0 text-xs">{c.kind}</Badge>
                          </button>
                        ))}
                      </div>
                      <div className="flex justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setPickerOpenFor(null)}>Fermer</Button>
                      </div>
                    </div>
                  )}

                  {createItemFor?.id === t.id && createItemForm && (
                    <div className="mt-3 pt-3 border-t space-y-3">
                      <p className="text-sm font-medium flex items-center gap-2">
                        <ShoppingBag className="h-4 w-4 text-blue-600" />
                        Nouvel achat depuis cette transaction
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-xs font-medium text-muted-foreground">Description</label>
                          <Input
                            value={createItemForm.description}
                            onChange={(e) => setCreateItemForm({ ...createItemForm, description: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Date</label>
                          <Input
                            type="date"
                            value={createItemForm.purchase_date}
                            onChange={(e) => setCreateItemForm({ ...createItemForm, purchase_date: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Prix</label>
                          <Input
                            type="number"
                            step="0.01"
                            value={createItemForm.purchase_price}
                            onChange={(e) => setCreateItemForm({ ...createItemForm, purchase_price: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Marchand</label>
                          <select
                            value={createItemForm.merchant_id}
                            onChange={(e) => setCreateItemForm({ ...createItemForm, merchant_id: e.target.value })}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            <option value="">Sélectionner...</option>
                            {merchants.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Lieu</label>
                          <select
                            value={createItemForm.location_id}
                            onChange={(e) => setCreateItemForm({ ...createItemForm, location_id: e.target.value })}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            <option value="">Sélectionner...</option>
                            {locations.map((l) => (
                              <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-xs font-medium text-muted-foreground">Carte de paiement (optionnel)</label>
                          <select
                            value={createItemForm.payment_card_id}
                            onChange={(e) => setCreateItemForm({ ...createItemForm, payment_card_id: e.target.value })}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            <option value="">Aucune</option>
                            {cards.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={cancelCreateItemForm}>Annuler</Button>
                        <Button size="sm" onClick={submitCreateItemForm}>
                          <Check className="h-4 w-4" />
                          Créer & rapprocher
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={duplicatePrompt !== null}
        title="Article similaire déjà saisi"
        message={`Un achat très proche existe déjà : ${duplicatePrompt ?? ""}.\n\nIl a peut-être déjà été enregistré via le scanner. Créer quand même un nouvel article ?`}
        confirmLabel="Créer quand même"
        cancelLabel="Annuler"
        onConfirm={() => createItemFromTx(true)}
        onCancel={() => setDuplicatePrompt(null)}
      />
    </div>
  )
}
