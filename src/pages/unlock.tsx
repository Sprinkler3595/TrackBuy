import { useMemo, useState } from "react"
import { Lock, Plus, Eye, EyeOff, ShieldCheck, Check, X, Sun, Moon, Monitor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { evaluatePassword } from "@/lib/password"
import { useTheme, type Theme } from "@/hooks/use-theme"
import { useI18n, type Locale } from "@/lib/i18n"

interface UnlockPageProps {
  onUnlock: (vaultName: string, password: string) => Promise<void>
  onCreate: (vaultName: string, password: string) => Promise<void>
  vaultExists: boolean
  defaultVault: string
  availableVaults?: string[]
  error: string | null
}

export function UnlockPage({ onUnlock, onCreate, vaultExists, defaultVault, availableVaults = [], error }: UnlockPageProps) {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [vaultName, setVaultName] = useState(defaultVault)
  const [showPassword, setShowPassword] = useState(false)
  const [isCreating, setIsCreating] = useState(!vaultExists)
  const [loading, setLoading] = useState(false)

  const pwdEval = useMemo(() => evaluatePassword(password), [password])
  const { theme, setTheme } = useTheme()
  const { t, locale, setLocale } = useI18n()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return

    if (isCreating) {
      if (password !== confirmPassword) return
      if (!pwdEval.ok) return
      setLoading(true)
      try {
        await onCreate(vaultName, password)
      } finally {
        setLoading(false)
      }
    } else {
      setLoading(true)
      try {
        await onUnlock(vaultName, password)
      } finally {
        setLoading(false)
      }
    }
  }

  const passwordMismatch = isCreating && confirmPassword.length > 0 && password !== confirmPassword
  const pwdInvalid = isCreating && password.length > 0 && !pwdEval.ok

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      {/* Theme + locale switchers (top-right). The locale switch must live
          here so a non-French-speaking user can pick EN before unlocking. */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border bg-card/80 p-1 shadow-sm backdrop-blur">
          {(["fr", "en"] as Locale[]).map((lng) => (
            <button
              key={lng}
              type="button"
              onClick={() => setLocale(lng)}
              aria-pressed={locale === lng}
              className={`flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[11px] font-semibold uppercase transition-colors ${
                locale === lng
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {lng}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-full border bg-card/80 p-1 shadow-sm backdrop-blur">
          {(
            [
              { value: "light",  Icon: Sun,     label: t("settings.light") },
              { value: "system", Icon: Monitor, label: t("settings.system") },
              { value: "dark",   Icon: Moon,    label: t("settings.dark") },
            ] as { value: Theme; Icon: typeof Sun; label: string }[]
          ).map(({ value, Icon, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              title={label}
              aria-label={label}
              aria-pressed={theme === value}
              className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                theme === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">TrackBuy</h1>
          <p className="text-muted-foreground">
            {t("unlock.subtitle")}
          </p>
        </div>

        {/* Card */}
        <Card className="shadow-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              {isCreating ? t("unlock.createCard") : t("unlock.unlock")}
            </CardTitle>
            <CardDescription>
              {isCreating
                ? t("unlock.createDesc")
                : t("unlock.unlockDesc").replace("{vault}", vaultName)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isCreating ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("unlock.vaultName")}</label>
                  <Input
                    value={vaultName}
                    onChange={(e) => setVaultName(e.target.value)}
                    placeholder={t("unlock.vaultPlaceholder")}
                    required
                  />
                </div>
              ) : availableVaults.length > 1 ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("unlock.vault")}</label>
                  <select
                    value={vaultName}
                    onChange={(e) => setVaultName(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {availableVaults.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("unlock.masterPassword")}</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoFocus
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {isCreating && password.length > 0 && (
                  <>
                    {/* Strength bar — gives an at-a-glance signal independent
                        from the boolean rules below. */}
                    <div className="flex items-center gap-2 pt-1">
                      <div className="flex flex-1 gap-1">
                        {[1, 2, 3, 4].map((seg) => {
                          const filled = pwdEval.score >= seg
                          const tone =
                            pwdEval.score >= 4 ? "bg-green-500" :
                            pwdEval.score >= 3 ? "bg-emerald-500" :
                            pwdEval.score >= 2 ? "bg-amber-500" :
                            "bg-destructive"
                          return (
                            <div
                              key={seg}
                              className={`h-1 flex-1 rounded ${filled ? tone : "bg-muted"}`}
                            />
                          )
                        })}
                      </div>
                      <span className="text-[10px] font-medium text-muted-foreground tabular-nums w-12 text-right">
                        {pwdEval.score >= 4 ? t("unlock.strength.strong") :
                         pwdEval.score >= 3 ? t("unlock.strength.good") :
                         pwdEval.score >= 2 ? t("unlock.strength.fair") :
                         t("unlock.strength.weak")}
                      </span>
                    </div>
                    <ul className="space-y-1 pt-1">
                      {pwdEval.checks.map((c) => (
                        <li
                          key={c.label}
                          className={`flex items-center gap-1.5 text-xs ${
                            c.ok ? "text-green-600 dark:text-green-500" : "text-muted-foreground"
                          }`}
                        >
                          {c.ok ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                          {c.label}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {isCreating && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("unlock.confirmPassword")}</label>
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                  {passwordMismatch && (
                    <p className="text-xs text-destructive">{t("unlock.mismatch")}</p>
                  )}
                </div>
              )}

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={loading || passwordMismatch || pwdInvalid}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {isCreating ? t("unlock.creating") : t("unlock.unlocking")}
                  </span>
                ) : isCreating ? (
                  <span className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    {t("unlock.createCard")}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    {t("unlock.unlock")}
                  </span>
                )}
              </Button>
            </form>

            {vaultExists && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setIsCreating(!isCreating)}
                >
                  {isCreating ? t("unlock.existingVault") : t("unlock.newVault")}
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Security info */}
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3 w-3" />
          <span>{t("unlock.cryptoLabel")}</span>
        </div>
      </div>
    </div>
  )
}
