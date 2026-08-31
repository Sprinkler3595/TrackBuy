import { useEffect, useState } from "react"
import { Moon, Sun, Monitor, Languages, Lock, Database, FolderOpen, Copy, Check, Sparkles, Eye, EyeOff, KeyRound, AlertTriangle, Building2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useTheme } from "@/hooks/use-theme"
import { getIdleLockMinutes, setIdleLockMinutes } from "@/hooks/use-idle-lock"
import { useI18n } from "@/lib/i18n"
import { getActiveVaultLocation, openActiveVaultFolder, type VaultLocation } from "@/lib/tauri"
import * as api from "@/lib/tauri"
import { useToast } from "@/components/ui/toast"
import {
  type AiSettings,
  type AiProvider,
  getAiSettings,
  saveAiSettings,
  defaultAiSettings,
  isCloudProvider,
} from "@/lib/ai-settings"
import {
  type ZefixSettings,
  getZefixSettings,
  saveZefixSettings,
  hasZefixCredentials,
} from "@/lib/zefix-settings"

function formatBytes(n: number, locale: "fr" | "en"): string {
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB"]
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const formatted = v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)
  return `${locale === "fr" ? formatted.replace(".", ",") : formatted} ${units[i]}`
}

/// "2026-07" → "juillet 2026" / "July 2026". Falls back to the raw string.
function formatMonth(month: string, locale: "fr" | "en"): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return month
  const date = new Date(Number(m[1]), Number(m[2]) - 1, 1)
  return date.toLocaleDateString(locale === "fr" ? "fr-CH" : "en-GB", {
    month: "long",
    year: "numeric",
  })
}

/// Group thousands with a locale-appropriate separator (e.g. "12 345").
function formatCount(n: number, locale: "fr" | "en"): string {
  return n.toLocaleString(locale === "fr" ? "fr-CH" : "en-GB")
}

export function GeneralSettings() {
  const { theme, setTheme } = useTheme()
  const { locale, setLocale, t } = useI18n()
  const [idleMinutes, setIdleMinutesState] = useState<number>(() => getIdleLockMinutes())
  const [vaultLoc, setVaultLoc] = useState<VaultLocation | null>(null)
  const [vaultLocError, setVaultLocError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [ai, setAi] = useState<AiSettings>(() => getAiSettings())
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [aiUsage, setAiUsage] = useState<api.AiUsageMonth[]>([])
  const [zefix, setZefix] = useState<ZefixSettings>(() => getZefixSettings())
  const [showZefixPwd, setShowZefixPwd] = useState(false)
  const [zefixTesting, setZefixTesting] = useState(false)
  // Rotation du mot de passe maître.
  const [oldPwd, setOldPwd] = useState("")
  const [newPwd, setNewPwd] = useState("")
  const [confirmPwd, setConfirmPwd] = useState("")
  const [showPwd, setShowPwd] = useState(false)
  const [rotating, setRotating] = useState(false)
  const { toast } = useToast()

  const changePassword = async () => {
    if (newPwd.length < 8) {
      toast(
        locale === "fr"
          ? "Le nouveau mot de passe doit contenir au moins 8 caractères."
          : "The new password must be at least 8 characters.",
        "error",
      )
      return
    }
    if (newPwd !== confirmPwd) {
      toast(
        locale === "fr" ? "La confirmation ne correspond pas." : "Confirmation does not match.",
        "error",
      )
      return
    }
    if (newPwd === oldPwd) {
      toast(
        locale === "fr"
          ? "Le nouveau mot de passe doit être différent de l'ancien."
          : "The new password must differ from the old one.",
        "error",
      )
      return
    }
    setRotating(true)
    try {
      await api.changeMasterPassword(oldPwd, newPwd)
      setOldPwd("")
      setNewPwd("")
      setConfirmPwd("")
      toast(
        locale === "fr"
          ? "Mot de passe maître changé. La base et les pièces jointes ont été re-chiffrées."
          : "Master password changed. Database and attachments were re-encrypted.",
        "success",
      )
    } catch (e) {
      toast(`${locale === "fr" ? "Échec" : "Failed"}: ${e}`, "error")
    } finally {
      setRotating(false)
    }
  }

  const updateIdle = (minutes: number) => {
    setIdleLockMinutes(minutes)
    setIdleMinutesState(minutes)
  }

  useEffect(() => {
    let cancelled = false
    getActiveVaultLocation()
      .then((loc) => {
        if (!cancelled) setVaultLoc(loc)
      })
      .catch((e) => {
        if (!cancelled) setVaultLocError(typeof e === "string" ? e : String(e))
      })
    api.getAiUsage()
      .then((u) => {
        if (!cancelled) setAiUsage(u)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const refreshAiUsage = () => {
    api.getAiUsage().then(setAiUsage).catch(() => undefined)
  }

  const revealFolder = async () => {
    if (!vaultLoc) return
    try {
      await openActiveVaultFolder()
    } catch (e) {
      console.error("Failed to open folder", e)
      setVaultLocError(typeof e === "string" ? e : String(e))
    }
  }

  const copyPath = async () => {
    if (!vaultLoc) return
    try {
      await navigator.clipboard.writeText(vaultLoc.vault_dir)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.error("Clipboard write failed", e)
    }
  }

  const updateAi = (patch: Partial<AiSettings>) => {
    setAi((prev) => {
      const next = { ...prev, ...patch }
      saveAiSettings(next)
      return next
    })
  }

  const switchProvider = (provider: AiProvider) => {
    const defaults = defaultAiSettings(provider)
    setAi((prev) => {
      const next: AiSettings = { ...defaults, enabled: prev.enabled, provider }
      saveAiSettings(next)
      return next
    })
  }

  const testConnection = async () => {
    setTesting(true)
    try {
      const reply = await api.aiTestConnection(ai)
      toast(
        locale === "fr"
          ? `Connexion OK — ${reply.slice(0, 60)}`
          : `Connection OK — ${reply.slice(0, 60)}`,
        "success",
      )
    } catch (e) {
      toast(`${locale === "fr" ? "Échec" : "Failed"}: ${e}`, "error")
    } finally {
      setTesting(false)
      refreshAiUsage()
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.appearance")}</CardTitle>
          <CardDescription>
            {locale === "fr" ? "Choisissez le thème de l'application" : "Choose the application theme"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {([
              { value: "light" as const, icon: Sun, label: t("settings.light") },
              { value: "dark" as const, icon: Moon, label: t("settings.dark") },
              { value: "system" as const, icon: Monitor, label: t("settings.system") },
            ]).map(({ value, icon: Icon, label }) => (
              <Button
                key={value}
                variant={theme === value ? "default" : "outline"}
                className="flex-1"
                onClick={() => setTheme(value)}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Languages className="h-5 w-5" />
            {t("settings.language")}
          </CardTitle>
          <CardDescription>
            {locale === "fr" ? "Choisissez la langue de l'interface" : "Choose the interface language"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Button
              variant={locale === "fr" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setLocale("fr")}
            >
              Français
            </Button>
            <Button
              variant={locale === "en" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setLocale("en")}
            >
              English
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {locale === "fr" ? "Verrouillage auto" : "Auto-lock"}
          </CardTitle>
          <CardDescription>
            {locale === "fr"
              ? "Verrouille automatiquement le coffre après une période d'inactivité"
              : "Automatically locks the vault after a period of inactivity"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 5, 10, 30, 60].map((m) => (
              <Button
                key={m}
                variant={idleMinutes === m ? "default" : "outline"}
                onClick={() => updateIdle(m)}
              >
                {m === 0
                  ? locale === "fr" ? "Jamais" : "Never"
                  : `${m} min`}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {locale === "fr" ? "IA scanner" : "AI scanner"}
          </CardTitle>
          <CardDescription>
            {locale === "fr"
              ? "Améliore l'extraction des reçus avec une IA. Le texte OCR est envoyé au modèle qui retourne les champs structurés."
              : "Improves receipt extraction with an AI model. OCR text is sent to the model which returns structured fields."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={ai.enabled}
              onChange={(e) => updateAi({ enabled: e.target.checked })}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <span className="text-sm font-medium">
              {locale === "fr" ? "Utiliser l'IA pour le scanner" : "Use AI for the scanner"}
            </span>
          </label>

          {ai.enabled && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {locale === "fr" ? "Fournisseur" : "Provider"}
                </label>
                <div className="flex gap-2">
                  <Button
                    variant={ai.provider === "infomaniak" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => switchProvider("infomaniak")}
                  >
                    Infomaniak
                  </Button>
                  <Button
                    variant={ai.provider === "ollama" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => switchProvider("ollama")}
                  >
                    Ollama
                  </Button>
                </div>
              </div>

              {isCloudProvider(ai.provider) && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {locale === "fr"
                      ? "Fournisseur cloud : l'image et le texte des reçus/relevés sont envoyés à un service distant (Infomaniak). Cela sort du modèle « 100 % local ». Pour rester local, utilise Ollama. N'active l'IA cloud que pour des documents non sensibles."
                      : "Cloud provider: receipt/statement image and text are sent to a remote service (Infomaniak). This leaves the “100% local” model. Use Ollama to stay local. Only enable cloud AI for non-sensitive documents."}
                  </span>
                </div>
              )}

              {ai.provider === "infomaniak" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">Product ID</label>
                    <Input
                      value={ai.infomaniakProductId}
                      onChange={(e) => updateAi({ infomaniakProductId: e.target.value })}
                      placeholder="123456"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">
                      {locale === "fr" ? "Clé API" : "API key"}
                    </label>
                    <div className="flex gap-2">
                      <Input
                        type={showApiKey ? "text" : "password"}
                        value={ai.apiKey}
                        onChange={(e) => updateAi({ apiKey: e.target.value })}
                        placeholder="sk-..."
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">
                      {locale === "fr" ? "Modèle" : "Model"}
                    </label>
                    <Input
                      value={ai.model}
                      onChange={(e) => updateAi({ model: e.target.value })}
                      placeholder="mixtral"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">URL</label>
                    <Input
                      value={ai.ollamaUrl}
                      onChange={(e) => updateAi({ ollamaUrl: e.target.value })}
                      placeholder="http://localhost:11434"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">
                      {locale === "fr" ? "Modèle" : "Model"}
                    </label>
                    <Input
                      value={ai.model}
                      onChange={(e) => updateAi({ model: e.target.value })}
                      placeholder="llama3.1"
                    />
                  </div>
                </div>
              )}

              <div>
                <Button variant="outline" onClick={testConnection} disabled={testing}>
                  {testing
                    ? (locale === "fr" ? "Test en cours..." : "Testing...")
                    : (locale === "fr" ? "Tester la connexion" : "Test connection")}
                </Button>
              </div>
            </>
          )}

          {aiUsage.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <div className="text-sm font-medium">
                {locale === "fr" ? "Consommation (tokens)" : "Usage (tokens)"}
              </div>
              <p className="text-xs text-muted-foreground">
                {locale === "fr"
                  ? "Tokens envoyés (entrée) et reçus (sortie) par mois, pour ce coffre."
                  : "Tokens sent (input) and received (output) per month, for this vault."}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">{locale === "fr" ? "Mois" : "Month"}</th>
                      <th className="py-1 px-3 text-right font-medium">{locale === "fr" ? "Envoyés" : "Sent"}</th>
                      <th className="py-1 px-3 text-right font-medium">{locale === "fr" ? "Reçus" : "Received"}</th>
                      <th className="py-1 px-3 text-right font-medium">Total</th>
                      <th className="py-1 pl-3 text-right font-medium">{locale === "fr" ? "Appels" : "Calls"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiUsage.map((u) => (
                      <tr key={u.month} className="border-t">
                        <td className="py-1 pr-3 font-medium">{formatMonth(u.month, locale)}</td>
                        <td className="py-1 px-3 text-right tabular-nums">{formatCount(u.prompt_tokens, locale)}</td>
                        <td className="py-1 px-3 text-right tabular-nums">{formatCount(u.completion_tokens, locale)}</td>
                        <td className="py-1 px-3 text-right tabular-nums font-medium">
                          {formatCount(u.prompt_tokens + u.completion_tokens, locale)}
                        </td>
                        <td className="py-1 pl-3 text-right tabular-nums text-muted-foreground">
                          {formatCount(u.calls, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {locale === "fr" ? "Registre du commerce (Zefix)" : "Commercial register (Zefix)"}
          </CardTitle>
          <CardDescription>
            {locale === "fr"
              ? "Retrouve l'IDE et l'adresse du siège d'une entreprise à partir de son nom, lors de la création d'un revenu ou d'un contrat."
              : "Looks up a company's UID and registered address from its name, when creating an income or a contract."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {locale === "fr" ? (
              <>
                L'accès à l'API est <strong>gratuit</strong>, mais nominatif : il se demande par
                courriel à{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">zefix@bj.admin.ch</code>.
                Aucun identifiant n'est livré avec l'application — il serait alors partagé entre
                tous ses utilisateurs, ce que les conditions d'accès n'autorisent pas.
              </>
            ) : (
              <>
                API access is <strong>free</strong> but personal: request it by email from{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">zefix@bj.admin.ch</code>.
                No credentials ship with the app — they would be shared between all its users,
                which the terms of access do not allow.
              </>
            )}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {locale === "fr" ? "Identifiant" : "Username"}
              </label>
              <Input
                value={zefix.username}
                onChange={(e) => setZefix({ ...zefix, username: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {locale === "fr" ? "Mot de passe" : "Password"}
              </label>
              <div className="flex gap-2">
                <Input
                  type={showZefixPwd ? "text" : "password"}
                  value={zefix.password}
                  onChange={(e) => setZefix({ ...zefix, password: e.target.value })}
                  autoComplete="off"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowZefixPwd((v) => !v)}
                  aria-label={
                    showZefixPwd
                      ? locale === "fr" ? "Masquer" : "Hide"
                      : locale === "fr" ? "Afficher" : "Show"
                  }
                >
                  {showZefixPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                saveZefixSettings(zefix)
                toast(locale === "fr" ? "Identifiants enregistrés" : "Credentials saved", "success")
              }}
            >
              {locale === "fr" ? "Enregistrer" : "Save"}
            </Button>
            <Button
              variant="outline"
              disabled={zefixTesting || !hasZefixCredentials(zefix)}
              onClick={async () => {
                setZefixTesting(true)
                try {
                  // Une recherche réelle est le seul test qui prouve quelque
                  // chose : l'API ne propose pas de point d'entrée « qui
                  // suis-je », et un mot de passe faux ne se voit qu'au
                  // premier appel. « Migros » a l'avantage de renvoyer à coup
                  // sûr des résultats.
                  const hits = await api.zefixSearch(zefix, "Migros", null)
                  toast(
                    locale === "fr"
                      ? `Connexion établie — ${hits.length} résultat(s) pour un essai.`
                      : `Connected — ${hits.length} result(s) for a test query.`,
                    "success",
                  )
                } catch (e) {
                  toast(`${e}`, "error")
                } finally {
                  setZefixTesting(false)
                }
              }}
            >
              {zefixTesting
                ? locale === "fr" ? "Test en cours…" : "Testing…"
                : locale === "fr" ? "Tester la connexion" : "Test connection"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Database className="h-5 w-5" />
            {t("settings.dataLocation")}
          </CardTitle>
          <CardDescription>{t("settings.dataLocationDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {vaultLocError && (
            <p className="text-destructive">{vaultLocError}</p>
          )}
          {vaultLoc && (
            <>
              <div className="grid gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">{t("settings.activeVault")}</span>
                  <span className="font-medium">{vaultLoc.vault_name}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">{t("settings.vaultFolder")}</span>
                  <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                    {vaultLoc.vault_dir}
                  </code>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">{t("settings.dbFile")}</span>
                  <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                    {vaultLoc.db_file}
                  </code>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">{t("settings.attachmentsFolder")}</span>
                  <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                    {vaultLoc.attachments_dir}
                  </code>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">{t("settings.dbSize")}</span>
                  <span className="font-medium">{formatBytes(vaultLoc.db_size_bytes, locale)}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="default" onClick={revealFolder}>
                  <FolderOpen className="h-4 w-4" />
                  {t("settings.openFolder")}
                </Button>
                <Button variant="outline" onClick={copyPath}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? t("settings.copied") : t("settings.copyPath")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {locale === "fr" ? "Mot de passe maître" : "Master password"}
          </CardTitle>
          <CardDescription>
            {locale === "fr"
              ? "Change le mot de passe du coffre actif. La base et toutes les pièces jointes sont re-chiffrées ; en cas d'interruption, le coffre reste utilisable avec l'ancien mot de passe."
              : "Changes the active vault's password. The database and all attachments are re-encrypted; if interrupted, the vault stays usable with the old password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {locale === "fr" ? "Mot de passe actuel" : "Current password"}
            </label>
            <Input
              type={showPwd ? "text" : "password"}
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {locale === "fr" ? "Nouveau mot de passe" : "New password"}
            </label>
            <div className="flex gap-2">
              <Input
                type={showPwd ? "text" : "password"}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                autoComplete="new-password"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowPwd(!showPwd)}
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {locale === "fr" ? "Confirmer le nouveau mot de passe" : "Confirm new password"}
            </label>
            <Input
              type={showPwd ? "text" : "password"}
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {locale === "fr"
              ? "Conseil : effectuez une sauvegarde avant de changer le mot de passe."
              : "Tip: make a backup before changing the password."}
          </p>
          <Button
            onClick={changePassword}
            disabled={rotating || !oldPwd || !newPwd || !confirmPwd}
          >
            {rotating
              ? locale === "fr"
                ? "Re-chiffrement en cours..."
                : "Re-encrypting..."
              : locale === "fr"
                ? "Changer le mot de passe"
                : "Change password"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.security")}</CardTitle>
          <CardDescription>
            {locale === "fr" ? "Chiffrement de bout en bout" : "End-to-end encryption"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{locale === "fr" ? "Base de données" : "Database"} : <strong>SQLCipher AES-256</strong></p>
          <p>{locale === "fr" ? "Pièces jointes" : "Attachments"} : <strong>ChaCha20-Poly1305</strong></p>
          <p>{locale === "fr" ? "Dérivation clé" : "Key derivation"} : <strong>Argon2id (64 MiB / t=3 / p=4)</strong></p>
          <p>{locale === "fr" ? "Effacement clé en RAM" : "Key zeroization"} : <strong>zeroize</strong></p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.about")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>TrackBuy v0.1.0</p>
          <p>Tauri v2 + React 19 + SQLCipher</p>
        </CardContent>
      </Card>
    </div>
  )
}
