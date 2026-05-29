import { useEffect, useMemo, useState } from "react"
import { Plus, Trash2, Code, ListChecks } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface ClausesEditorProps {
  /// Raw JSON string stored in engagements.clauses_json. `null` or empty
  /// string both mean "no clauses".
  value: string | null
  onChange: (raw: string | null) => void
  /// Read-only mode (overview tab). Hides the editing controls and just
  /// renders the parsed clauses as a definition list.
  readOnly?: boolean
}

type Row = { id: number; key: string; value: string }

const COMMON_TEMPLATES: Array<{ key: string; placeholder: string }> = [
  { key: "Franchise", placeholder: "ex: 500" },
  { key: "Plafond annuel", placeholder: "ex: 50000" },
  { key: "Options", placeholder: "Vol, Bris de glace, Casco" },
  { key: "Conditions", placeholder: "Conducteur principal, kilométrage…" },
  { key: "Période de couverture", placeholder: "01/01 - 31/12" },
]

/// Parse a clauses_json blob into editable rows. Robust to malformed input:
/// returns an empty list if JSON.parse throws, so the editor never crashes
/// on legacy data.
function parseRows(raw: string | null): Row[] {
  if (!raw) return []
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return []
    return Object.entries(obj).map(([key, val], idx) => ({
      id: idx,
      key,
      value: typeof val === "number" ? String(val) : Array.isArray(val) ? val.join(", ") : String(val ?? ""),
    }))
  } catch {
    return []
  }
}

/// Serialize rows back to JSON. Coerce strings that look numeric (`100`,
/// `49.50`) into numbers so analytics can sum them later; everything else
/// stays a string. Empty rows (no key) are dropped.
function rowsToJson(rows: Row[]): string | null {
  const cleaned = rows.filter((r) => r.key.trim().length > 0)
  if (cleaned.length === 0) return null
  const obj: Record<string, string | number> = {}
  for (const r of cleaned) {
    const v = r.value.trim()
    if (/^-?\d+(\.\d+)?$/.test(v)) {
      obj[r.key.trim()] = parseFloat(v)
    } else {
      obj[r.key.trim()] = v
    }
  }
  return JSON.stringify(obj)
}

export function ClausesEditor({ value, onChange, readOnly = false }: ClausesEditorProps) {
  const [mode, setMode] = useState<"structured" | "raw">("structured")
  const [rows, setRows] = useState<Row[]>(() => parseRows(value))
  const [nextId, setNextId] = useState(() => rows.length)
  const [rawDraft, setRawDraft] = useState(value ?? "")
  const [rawError, setRawError] = useState<string | null>(null)

  // External value change (e.g. when loading a different engagement) resets
  // both modes' local state. Without this, swapping between engagements
  // would show the previous one's rows.
  useEffect(() => {
    setRows(parseRows(value))
    setRawDraft(value ?? "")
    setNextId(parseRows(value).length)
    setRawError(null)
  }, [value])

  const updateRow = (id: number, patch: Partial<Row>) => {
    const next = rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    setRows(next)
    onChange(rowsToJson(next))
  }

  const addRow = (key = "") => {
    const next = [...rows, { id: nextId, key, value: "" }]
    setRows(next)
    setNextId(nextId + 1)
    onChange(rowsToJson(next))
  }

  const removeRow = (id: number) => {
    const next = rows.filter((r) => r.id !== id)
    setRows(next)
    onChange(rowsToJson(next))
  }

  const handleRawBlur = () => {
    const trimmed = rawDraft.trim()
    if (!trimmed) {
      setRawError(null)
      onChange(null)
      return
    }
    try {
      JSON.parse(trimmed)
      setRawError(null)
      onChange(trimmed)
      setRows(parseRows(trimmed))
    } catch (e) {
      setRawError(String(e))
    }
  }

  // Suggestions are templates the user hasn't used yet. Avoids cluttering
  // the UI with already-added keys.
  const suggestions = useMemo(
    () => COMMON_TEMPLATES.filter((tpl) => !rows.some((r) => r.key === tpl.key)),
    [rows]
  )

  // Read-only view used by the engagement overview tab.
  if (readOnly) {
    if (rows.length === 0) {
      return <p className="text-sm text-muted-foreground italic">Aucune clause renseignée</p>
    }
    return (
      <dl className="grid gap-2 sm:grid-cols-2 text-sm">
        {rows.map((r) => (
          <div key={r.id} className="rounded-md border bg-muted/30 p-2">
            <dt className="text-xs font-medium text-muted-foreground">{r.key}</dt>
            <dd className="font-medium break-words">{r.value || "—"}</dd>
          </div>
        ))}
      </dl>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={mode === "structured" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("structured")}
        >
          <ListChecks className="h-4 w-4" />
          Champs
        </Button>
        <Button
          type="button"
          variant={mode === "raw" ? "default" : "outline"}
          size="sm"
          onClick={() => { setRawDraft(rowsToJson(rows) ?? ""); setMode("raw") }}
        >
          <Code className="h-4 w-4" />
          JSON brut
        </Button>
      </div>

      {mode === "structured" ? (
        <div className="space-y-2">
          {rows.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              Ajoutez des clauses du contrat (franchise, plafond, options…).
            </p>
          )}
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-2">
              <Input
                value={r.key}
                onChange={(e) => updateRow(r.id, { key: e.target.value })}
                placeholder="Nom"
                className="w-48 shrink-0"
              />
              <Input
                value={r.value}
                onChange={(e) => updateRow(r.id, { value: e.target.value })}
                placeholder="Valeur"
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(r.id)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => addRow()}>
              <Plus className="h-4 w-4" />Champ libre
            </Button>
            {suggestions.map((s) => (
              <Button
                key={s.key}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addRow(s.key)}
              >
                + {s.key}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={rawDraft}
            onChange={(e) => setRawDraft(e.target.value)}
            onBlur={handleRawBlur}
            className="font-mono text-xs w-full min-h-[160px] rounded-md border border-input bg-background px-3 py-2"
            placeholder='{"Franchise": 500, "Plafond annuel": 50000}'
          />
          {rawError && (
            <p className="text-xs text-destructive">JSON invalide : {rawError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Le JSON est validé à la perte de focus. Les champs structurés sont
            recalculés automatiquement à partir du contenu valide.
          </p>
        </div>
      )}
    </div>
  )
}
