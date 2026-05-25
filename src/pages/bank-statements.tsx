import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Plus, Trash2, Banknote, FileText, CheckCircle2, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatDate } from "@/lib/utils"
import * as api from "@/lib/tauri"

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function BankStatementsPage() {
  const [statements, setStatements] = useState<api.BankStatement[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const { toast } = useToast()
  const navigate = useNavigate()

  const load = async () => {
    try {
      setStatements(await api.listBankStatements())
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const handleImport = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const selected = await open({
        multiple: false,
        title: "Importer un relevé bancaire",
        filters: [{ name: "Documents", extensions: ["pdf", "png", "jpg", "jpeg"] }],
      })
      if (!selected || Array.isArray(selected)) return
      const filename = selected.split("/").pop() || selected.split("\\").pop() || "Relevé"
      const stmt = await api.addBankStatement(selected, filename)
      toast("Relevé importé", "success")
      await load()
      // The next step is extraction — we redirect right into the review
      // page so the user can launch the AI parser straight away. Use the
      // router's navigate(), not window.location.hash, since we run under
      // BrowserRouter (history API) — a hash change wouldn't trigger a
      // route match here.
      navigate(`/bank-statements/${stmt.id}/review`)
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteBankStatement(deleteTarget)
      toast("Relevé supprimé", "success")
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const statusBadge = (s: api.BankStatementStatus) => {
    if (s === "extracted")  return <Badge variant="warning"><Clock className="h-3 w-3" /> À revoir</Badge>
    if (s === "reviewed")   return <Badge variant="success"><CheckCircle2 className="h-3 w-3" /> Revu</Badge>
    if (s === "archived")   return <Badge variant="secondary">Archivé</Badge>
    return <Badge variant="secondary">À extraire</Badge>
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Relevés bancaires</h2>
          <p className="text-muted-foreground">
            Scan mensuel — extraction IA + matching automatique vers engagements, revenus, achats
          </p>
        </div>
        <Button onClick={handleImport}>
          <Plus className="h-4 w-4" />Importer un relevé
        </Button>
      </div>

      <div className="grid gap-3">
        {statements.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
              <Banknote className="h-12 w-12 mb-4 opacity-20" />
              <p>Aucun relevé importé.</p>
              <p className="text-xs mt-1">Importe un PDF mensuel de ta banque (UBS, PostFinance, Raiffeisen…) pour démarrer.</p>
            </CardContent>
          </Card>
        ) : statements.map((s) => (
          <Card key={s.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <Link to={`/bank-statements/${s.id}/review`} className="flex-1 min-w-0 flex items-center gap-3">
                  <FileText className="h-8 w-8 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{s.label || s.original_name}</p>
                      {statusBadge(s.status)}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {s.bank_name && <span>{s.bank_name}</span>}
                      {s.period_start && s.period_end && <span>· {formatDate(s.period_start)} → {formatDate(s.period_end)}</span>}
                      <span>· {formatFileSize(s.size_bytes)}</span>
                      <span>· importé le {formatDate(s.created_at)}</span>
                    </div>
                  </div>
                </Link>
                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(s.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer le relevé"
        message="Ce relevé, ses transactions extraites et le PDF chiffré seront supprimés définitivement."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
