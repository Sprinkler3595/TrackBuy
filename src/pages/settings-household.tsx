import { useEffect, useState } from "react"
import { Plus, Trash2, Users } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import * as api from "@/lib/tauri"

const RELATIONS: { value: api.HouseholdRelation; label: string }[] = [
  { value: "self", label: "Moi-même" },
  { value: "spouse", label: "Conjoint·e" },
  { value: "child", label: "Enfant" },
  { value: "parent", label: "Parent à charge" },
  { value: "other", label: "Autre" },
]

const RELATION_LABEL = Object.fromEntries(RELATIONS.map((r) => [r.value, r.label])) as Record<
  api.HouseholdRelation,
  string
>

export function HouseholdSettings() {
  const { toast } = useToast()
  const [members, setMembers] = useState<api.HouseholdMember[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [relation, setRelation] = useState<api.HouseholdRelation>("spouse")
  const [birthDate, setBirthDate] = useState("")
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)

  async function load() {
    try {
      const m = await api.listHouseholdMembers()
      setMembers(m)
    } catch (e) {
      toast(String(e), "error")
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function add() {
    if (!name.trim()) return
    try {
      await api.createHouseholdMember({
        name: name.trim(),
        relation,
        birth_date: birthDate || null,
      })
      setName("")
      setBirthDate("")
      setRelation("spouse")
      setAdding(false)
      await load()
      toast("Membre ajouté", "success")
    } catch (e) {
      toast(String(e), "error")
    }
  }

  async function remove(id: string) {
    setRemoveTarget(id)
  }

  async function confirmRemove() {
    if (!removeTarget) return
    try {
      await api.deleteHouseholdMember(removeTarget)
      await load()
    } catch (e) {
      toast(String(e), "error")
    } finally {
      setRemoveTarget(null)
    }
  }

  async function runSeed() {
    try {
      const result = await api.seedSwissCreditors()
      toast(
        `${result.inserted} créanciers ajoutés (${result.skipped} déjà présents)`,
        "success",
      )
    } catch (e) {
      toast(String(e), "error")
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Users className="h-5 w-5" />
          Membres du ménage
        </h2>
        <p className="text-sm text-muted-foreground">
          Attribuez achats, engagements et primes LAMal à chaque membre. Utile
          pour le décompte annuel et la déclaration d'impôt commune ou séparée.
        </p>
      </div>

      <div className="space-y-2">
        {members.map((m) => (
          <Card key={m.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-muted-foreground">
                  {RELATION_LABEL[m.relation] ?? m.relation}
                  {m.birth_date && ` • Né·e le ${m.birth_date}`}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(m.id)}
                aria-label="Supprimer"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
        {members.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Aucun membre encore enregistré.
          </p>
        )}
      </div>

      {adding ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="text-xs font-medium">Nom</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Marie Dupont"
                />
              </div>
              <div>
                <label className="text-xs font-medium">Date de naissance</label>
                <Input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Relation</label>
              <select
                value={relation}
                onChange={(e) => setRelation(e.target.value as api.HouseholdRelation)}
                className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
              >
                {RELATIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAdding(false)}>
                Annuler
              </Button>
              <Button onClick={add} disabled={!name.trim()}>
                Ajouter
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => setAdding(true)} variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Ajouter un membre
        </Button>
      )}

      <div className="rounded-lg border bg-muted/30 p-4">
        <h3 className="text-sm font-semibold">Pré-remplir les créanciers suisses</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Ajoute ~120 créanciers fréquents (assureurs LAMal, télécoms, énergies,
          banques cantonales, administrations fiscales) pour gagner du temps au
          premier scan QR-facture. Sans doublons : ne touche pas aux créanciers
          déjà existants.
        </p>
        <Button onClick={runSeed} variant="outline" className="mt-3" size="sm">
          Importer la liste
        </Button>
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        title="Supprimer ce membre ?"
        message="Le membre sera retiré du ménage. Les revenus et engagements existants ne sont pas affectés."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  )
}
