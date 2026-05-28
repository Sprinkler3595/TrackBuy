import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Plus, Vault, Check, Download, Upload, AlertTriangle, Check as CheckIcon, X as XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { evaluatePassword } from "@/lib/password"
import * as api from "@/lib/tauri"

interface VaultsPageProps {
  onSwitchVault: (name: string, password: string) => Promise<void>
}

export function VaultsPage({ onSwitchVault }: VaultsPageProps) {
  const [vaults, setVaults] = useState<api.VaultInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [switchPassword, setSwitchPassword] = useState("")
  const [switchTarget, setSwitchTarget] = useState<string | null>(null)
  const [restoreState, setRestoreState] = useState<
    | null
    | {
        source: string
        info: api.BackupInfo
        targetName: string
        confirmOverwrite: boolean
        busy: boolean
      }
  >(null)

  const { toast } = useToast()
  const navigate = useNavigate()

  // Same rule as the primary unlock screen — secondary vaults must not be
  // protected by a weaker password than the first one.
  const pwdEval = useMemo(() => evaluatePassword(newPassword), [newPassword])

  const load = async () => { try { setVaults(await api.listVaults()) } catch (e) { console.error(e) } finally { setLoading(false) } }

  const handleBackup = async () => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog")
      const destination = await save({
        title: "Sauvegarder le coffre",
        filters: [{ name: "TrackBuy Backup", extensions: ["tbvbak"] }],
      })
      if (destination) {
        const path = await api.backupVault(destination)
        toast(`Sauvegarde créée: ${path}`, "success")
      }
    } catch (e) { toast(`Erreur: ${e}`, "error") }
  }

  const handlePickImport = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const selected = await open({
        multiple: false,
        title: "Importer une sauvegarde",
        filters: [
          { name: "TrackBuy Backup", extensions: ["tbvbak", "db", "zip"] },
          { name: "Tous les fichiers", extensions: ["*"] },
        ],
      })
      if (!selected || typeof selected !== "string") return
      toast("Lecture de la sauvegarde…", "success")
      const info = await api.inspectBackup(selected)
      setRestoreState({
        source: selected,
        info,
        targetName: info.vault_name,
        confirmOverwrite: false,
        busy: false,
      })
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleConfirmRestore = async () => {
    if (!restoreState) return
    const { source, info, targetName, confirmOverwrite } = restoreState
    const willOverwrite = info.exists_locally && targetName === info.vault_name
    if (willOverwrite && !confirmOverwrite) {
      toast("Coche la case pour confirmer l'écrasement.", "error")
      return
    }
    setRestoreState({ ...restoreState, busy: true })
    try {
      const finalName = await api.restoreBackup(
        source,
        targetName.trim() || null,
        willOverwrite,
      )
      toast(`Coffre « ${finalName} » restauré. Déverrouille-le avec son mot de passe d'origine.`, "success")
      setRestoreState(null)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
      setRestoreState({ ...restoreState, busy: false })
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pwdEval.ok) {
      toast("Mot de passe trop faible : voir les règles ci-dessous.", "error")
      return
    }
    try {
      await api.createVault(newName, newPassword)
      setShowCreate(false); setNewName(""); setNewPassword("")
      await load()
      toast(`Coffre « ${newName} » créé`, "success")
    } catch (e) {
      toast(`Erreur création: ${e}`, "error")
    }
  }

  const handleSwitch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!switchTarget) return
    try {
      await onSwitchVault(switchTarget, switchPassword)
      const target = switchTarget
      setSwitchTarget(null); setSwitchPassword("")
      toast(`Basculé sur « ${target} »`, "success")
      // Navigate away from any stale detail URL that might reference items
      // from the previous vault. /ce-mois is the canonical landing page in
      // the new IA — /dashboard is kept reachable but is no longer the home.
      navigate("/ce-mois", { replace: true })
    } catch (e) {
      toast(`Mot de passe incorrect ou erreur: ${e}`, "error")
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-3xl font-bold tracking-tight">Coffres</h2><p className="text-muted-foreground">{vaults.length} coffre(s)</p></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePickImport}><Upload className="h-4 w-4" />Importer</Button>
          <Button variant="outline" onClick={handleBackup}><Download className="h-4 w-4" />Sauvegarder</Button>
          <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" />Nouveau coffre</Button>
        </div>
      </div>

      {restoreState && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Restaurer une sauvegarde
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Coffre d'origine :</span>{" "}
                <span className="font-medium">{restoreState.info.vault_name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Créé le :</span>{" "}
                <span className="font-medium">
                  {restoreState.info.created_at
                    ? new Date(restoreState.info.created_at).toLocaleString("fr-CA")
                    : "—"}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Restaurer sous le nom</label>
              <Input
                value={restoreState.targetName}
                onChange={(e) =>
                  setRestoreState({
                    ...restoreState,
                    targetName: e.target.value,
                    confirmOverwrite: false,
                  })
                }
                placeholder={restoreState.info.vault_name}
              />
              <p className="text-xs text-muted-foreground">
                Laisse le nom d'origine pour remplacer, ou tape un autre nom pour créer une copie côte à côte.
              </p>
            </div>

            {restoreState.info.exists_locally &&
              restoreState.targetName === restoreState.info.vault_name && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-2">
                  <div className="flex items-center gap-2 font-medium text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Un coffre nommé « {restoreState.info.vault_name} » existe déjà
                  </div>
                  <p className="text-xs text-destructive/90">
                    Il sera <strong>complètement remplacé</strong>. Toutes les données actuelles seront perdues.
                  </p>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={restoreState.confirmOverwrite}
                      onChange={(e) =>
                        setRestoreState({ ...restoreState, confirmOverwrite: e.target.checked })
                      }
                      className="h-4 w-4 rounded accent-primary"
                    />
                    Je confirme vouloir écraser le coffre existant
                  </label>
                </div>
              )}

            <div className="flex gap-2">
              <Button onClick={handleConfirmRestore} disabled={restoreState.busy}>
                {restoreState.busy ? "Restauration..." : "Restaurer"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRestoreState(null)}
                disabled={restoreState.busy}
              >
                Annuler
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showCreate && (
        <Card><CardHeader><CardTitle className="text-lg">Nouveau coffre</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><label className="text-sm font-medium">Nom *</label><Input value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus /></div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Mot de passe *</label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={12} />
                {newPassword.length > 0 && (
                  <ul className="space-y-1 pt-1">
                    {pwdEval.checks.map((c) => (
                      <li
                        key={c.label}
                        className={`flex items-center gap-1.5 text-xs ${
                          c.ok ? "text-green-600 dark:text-green-500" : "text-muted-foreground"
                        }`}
                      >
                        {c.ok ? <CheckIcon className="h-3 w-3" /> : <XIcon className="h-3 w-3" />}
                        {c.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={!pwdEval.ok}>Créer</Button>
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Annuler</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {switchTarget && (
        <Card><CardHeader><CardTitle className="text-lg">Basculer vers « {switchTarget} »</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSwitch} className="flex gap-4 items-end">
              <div className="flex-1 space-y-2"><label className="text-sm font-medium">Mot de passe</label><Input type="password" value={switchPassword} onChange={(e) => setSwitchPassword(e.target.value)} required autoFocus /></div>
              <Button type="submit">Basculer</Button><Button type="button" variant="outline" onClick={() => setSwitchTarget(null)}>Annuler</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {vaults.map((v) => (
          <Card key={v.name} className={`hover:shadow-md transition-shadow ${v.is_active ? "ring-2 ring-primary" : ""}`}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Vault className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="flex items-center gap-2"><p className="font-medium">{v.name}</p>{v.is_active && <Badge variant="success" className="text-[10px]"><Check className="h-3 w-3 mr-0.5" />Actif</Badge>}</div>
                </div>
              </div>
              {!v.is_active && <Button variant="outline" size="sm" onClick={() => setSwitchTarget(v.name)}>Basculer</Button>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
