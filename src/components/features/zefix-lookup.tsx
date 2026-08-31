import { useState } from "react"
import { AlertTriangle, Building2, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { getZefixSettings } from "@/lib/zefix-settings"
import * as api from "@/lib/tauri"

/// Chercher une entreprise dans le registre du commerce suisse, et en rapporter
/// l'IDE et l'adresse du siège.
///
/// Deux erreurs que rien ne rattrape ensuite disparaissent ici : un IDE mal
/// recopié — quinze caractères sans signification, personne ne relit — et une
/// adresse qui n'est pas celle du SIÈGE, alors que c'est le siège qui commande
/// les retenues sociales cantonales.
///
/// La recherche se fait en deux temps parce que l'API est ainsi faite : la
/// liste ne porte pas les adresses, seulement la commune du siège. C'est
/// suffisant pour distinguer deux homonymes, et le détail n'est demandé que
/// pour celle qu'on choisit.
///
/// Aucun réglage préalable : le registre est public et s'interroge tel quel.
/// Les identifiants des Paramètres, s'il y en a, sont posés par le back-end ;
/// et si le registre les réclame, c'est son message d'erreur qui y renvoie.
///
/// La licence de l'API est « OGD Open use. Must provide the source. » : citer
/// la source est une CONDITION de l'usage, pas un ornement. D'où la mention en
/// pied d'écran, qui n'est donc pas à retirer pour gagner trois lignes.

const statusLabel = (s: string | null): { text: string; variant: "success" | "secondary" } | null =>
  s === "ACTIVE"
    ? null
    : s === "CANCELLED"
      ? { text: "radiée", variant: "secondary" }
      : s === "BEING_CANCELLED"
        ? { text: "en liquidation", variant: "secondary" }
        : null

export function ZefixLookup({
  initialName,
  canton,
  onPicked,
  onClose,
}: {
  initialName?: string
  /// Restreint au canton du siège quand on le connaît déjà — deux « Migros »
  /// dans deux cantons, c'est la seule chose qui les sépare vraiment.
  canton?: string | null
  onPicked: (company: api.ZefixCompany) => void
  onClose: () => void
}) {
  const settings = getZefixSettings()

  const [query, setQuery] = useState(initialName ?? "")
  const [results, setResults] = useState<api.ZefixMatch[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    setBusy(true)
    setError(null)
    try {
      setResults(await api.zefixSearch(settings, query, canton ?? null))
    } catch (e) {
      setError(String(e))
      setResults(null)
    } finally {
      setBusy(false)
    }
  }

  const pick = async (m: api.ZefixMatch) => {
    if (!m.uid) {
      setError("Cette inscription n'a pas d'IDE : son adresse ne peut pas être récupérée.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      onPicked(await api.zefixCompany(settings, m.uid))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Building2 className="h-5 w-5" />
              Registre du commerce
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Le nom suffit : l'IDE et l'adresse du siège viennent de Zefix.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void search()
                }
              }}
              placeholder="Nom de l'entreprise"
              autoFocus
            />
            <Button onClick={search} disabled={busy || query.trim().length < 3}>
              <Search className="mr-1.5 h-4 w-4" />
              {busy ? "…" : "Chercher"}
            </Button>
          </div>
          {canton && (
            <p className="text-xs text-muted-foreground">
              Recherche limitée au canton {canton}.
            </p>
          )}

          {error && (
            <p className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span>{error}</span>
            </p>
          )}

          {results != null && results.length === 0 && !error && (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Aucune entreprise de ce nom. Essayez les premiers mots seulement — le
              registre cherche sur le début du nom, et « SA » ou « Sàrl » en fin de raison
              sociale peut suffire à faire échouer la recherche.
            </p>
          )}

          {results != null && results.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {results.map((m) => {
                const status = statusLabel(m.status)
                return (
                  <li key={`${m.uid}-${m.name}`}>
                    <button
                      type="button"
                      onClick={() => pick(m)}
                      disabled={busy}
                      className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-accent/40 disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{m.name}</span>
                          {m.legal_form && (
                            <span className="text-xs text-muted-foreground">{m.legal_form}</span>
                          )}
                          {status && <Badge variant={status.variant}>{status.text}</Badge>}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {m.legal_seat ?? "siège inconnu"}
                          {m.uid && ` · ${m.uid}`}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Source : Zefix — Office fédéral du registre du commerce (OFRC).
        </p>
      </div>
    </div>
  )
}
