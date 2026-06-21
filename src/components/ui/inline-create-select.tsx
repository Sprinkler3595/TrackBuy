import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/// A `<select>` of existing options with a "+" to create a new one inline,
/// without leaving the form. Keeps only the transient create-UI state; the
/// parent owns the option list and the actual creation (so it can persist the
/// new entity, append it to its own state, and decide the entity type).
///
/// `onCreate` does the create + returns the new option (or null on failure, in
/// which case the parent should have surfaced the error and we stay in edit
/// mode). The new option is then auto-selected.

export interface InlineOption {
  id: string
  name: string
}

interface InlineCreateSelectProps {
  value: string
  onChange: (id: string) => void
  options: InlineOption[]
  onCreate: (name: string) => Promise<InlineOption | null>
  /// Placeholder for the inline name field.
  placeholder?: string
  /// Tooltip on the "+" button.
  createTitle?: string
  fr?: boolean
}

const FIELD_CLS = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"

export function InlineCreateSelect({
  value,
  onChange,
  options,
  onCreate,
  placeholder,
  createTitle,
  fr = true,
}: InlineCreateSelectProps) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  async function submit() {
    const nm = name.trim()
    if (!nm || saving) return
    setSaving(true)
    try {
      const opt = await onCreate(nm)
      if (!opt) return // creation failed — parent surfaced the error; keep editing
      onChange(opt.id)
      setCreating(false)
      setName("")
    } finally {
      setSaving(false)
    }
  }

  if (creating) {
    return (
      <div className="flex gap-2">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submit()
            }
          }}
        />
        <Button type="button" size="sm" onClick={submit} disabled={saving || !name.trim()}>
          {fr ? "Ajouter" : "Add"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setCreating(false)
            setName("")
          }}
        >
          {fr ? "Annuler" : "Cancel"}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <select className={FIELD_CLS} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <Button type="button" variant="outline" size="icon" title={createTitle} onClick={() => setCreating(true)}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}
