import { useEffect, useState } from "react"
import { Moon, Sun, Monitor, Languages, Lock, Database, FolderOpen, Copy, Check, Sparkles, Eye, EyeOff, KeyRound } from "lucide-react"
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
} from "@/lib/ai-settings"

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
    return () => {
      cancelled = true
    }
  }, [])

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
