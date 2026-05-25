import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import * as pdfjsLib from "pdfjs-dist"
import { ArrowLeft, Sparkles, Search, Check, X, Lightbulb, Wand2, ShoppingBag, FileQuestion } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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

/// Build a single text block out of a PDF document by concatenating every
/// page's TextContent items. Bank statements are usually text-native (not
/// image scans) so this works directly. For image-only scans, the AI prompt
/// degrades gracefully — but the matching will be poor.
async function extractPdfText(base64: string): Promise<string> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise
  const parts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ")
    parts.push(text)
  }
  return parts.join("\n\n")
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
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

  // Candidate pool: we load every entity the user might want to match to.
  // Doing this once at mount lets the inline picker stay snappy without
  // round-tripping to the backend per row.
  const [candidates, setCandidates] = useState<TargetCandidate[]>([])
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null)
  const [pickerSearch, setPickerSearch] = useState("")
  const [learnRule, setLearnRule] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>("date")

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
      toast(`Erreur: ${err}`, "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [id])

  if (loading || !statement) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
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
    try {
      await api.createItemFromTransaction(createItemFor.id, {
        description: createItemForm.description.trim() || "Achat",
        purchase_date: createItemForm.purchase_date,
        purchase_price: price,
        currency: createItemForm.currency,
        merchant_id: createItemForm.merchant_id,
        location_id: createItemForm.location_id,
        payment_card_id: createItemForm.payment_card_id || undefined,
        notes: createItemForm.notes || undefined,
      })
      toast("Achat créé et rapproché", "success")
      cancelCreateItemForm()
      await load()
    } catch (err) {
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
    </div>
  )
}
