import { useState, useEffect, useCallback, useMemo } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AppLayout } from "@/components/layout/app-layout"
import { ToastProvider } from "@/components/ui/toast"
import { UnlockPage } from "@/pages/unlock"
import { DashboardPage } from "@/pages/dashboard"
import { ItemsPage } from "@/pages/items"
import { ItemDetailPage } from "@/pages/item-detail"
import { TicketsPage } from "@/pages/tickets"
import { WarrantiesPage } from "@/pages/warranties"
import { MerchantsPage } from "@/pages/merchants"
import { LocationsPage } from "@/pages/locations"
import { CardsPage } from "@/pages/cards"
import { VaultsPage } from "@/pages/vaults"
import { SubscriptionsPage } from "@/pages/subscriptions"
import { SubscriptionDetailPage } from "@/pages/subscription-detail"
import { EngagementsPage } from "@/pages/engagements"
import { EngagementDetailPage } from "@/pages/engagement-detail"
import { CreditorsPage } from "@/pages/creditors"
import { SettingsPage } from "@/pages/settings"
import { GeneralSettings } from "@/pages/settings-general"
import { NamingSettings } from "@/pages/settings-naming"
import { ScanPage } from "@/pages/scan"
import { ScanReviewPage } from "@/pages/scan-review"
import { useWarrantyNotifications } from "@/hooks/use-notifications"
import { useSubscriptionNotifications } from "@/hooks/use-subscription-notifications"
import { useIdleLock, useIdleLockMinutes } from "@/hooks/use-idle-lock"
import { I18nContext, getTranslation, type Locale } from "@/lib/i18n"
import * as api from "@/lib/tauri"

const LAST_VAULT_KEY = "trackbuy-last-vault"

function AppContent() {
  const [unlocked, setUnlocked] = useState(false)
  const [vaultName, setVaultName] = useState("Maison")
  const [availableVaults, setAvailableVaults] = useState<string[]>([])
  const [defaultUnlockVault, setDefaultUnlockVault] = useState("Maison")
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  // Activate warranty + subscription notifications when unlocked
  useWarrantyNotifications()
  useSubscriptionNotifications()

  useEffect(() => {
    async function check() {
      try {
        const list = await api.listVaults()
        const names = list.map((v) => v.name).sort((a, b) => a.localeCompare(b))
        setAvailableVaults(names)
        // Pick the last-used vault if it still exists, else the first one
        // listed, else fall back to "Maison" (which triggers the create flow
        // for fresh installs).
        const last = localStorage.getItem(LAST_VAULT_KEY)
        if (last && names.includes(last)) {
          setDefaultUnlockVault(last)
          setVaultName(last)
        } else if (names.length > 0) {
          setDefaultUnlockVault(names[0])
          setVaultName(names[0])
        }
      } catch {
        console.warn("Tauri API not available - running in browser mode")
      } finally {
        setChecking(false)
      }
    }
    check()
  }, [])

  const handleUnlock = useCallback(async (name: string, password: string) => {
    setError(null)
    try {
      await api.unlockVault(name, password)
      // Catch up any missed renewal cycles before the dashboard renders, so
      // the user sees a current view from the first paint.
      try { await api.rollForwardDueSubscriptions() } catch { /* non-fatal */ }
      try { await api.rollForwardDueEngagements() } catch { /* non-fatal */ }
      setVaultName(name)
      setUnlocked(true)
      localStorage.setItem(LAST_VAULT_KEY, name)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  const handleCreate = useCallback(async (name: string, password: string) => {
    setError(null)
    try {
      await api.createVault(name, password)
      setVaultName(name)
      setUnlocked(true)
      localStorage.setItem(LAST_VAULT_KEY, name)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  const handleLock = useCallback(async () => {
    try { await api.lockVault() } catch { /* ignore */ }
    setUnlocked(false)
    setError(null)
  }, [])

  // Auto-lock after N minutes of inactivity (default 10 min, 0 = disabled).
  const idleMinutes = useIdleLockMinutes()
  useIdleLock(handleLock, idleMinutes * 60_000, unlocked)

  const handleSwitchVault = useCallback(async (name: string, password: string) => {
    await api.switchVault(name, password)
    setVaultName(name)
  }, [])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!unlocked) {
    return (
      <UnlockPage
        onUnlock={handleUnlock}
        onCreate={handleCreate}
        vaultExists={availableVaults.length > 0}
        defaultVault={defaultUnlockVault}
        availableVaults={availableVaults}
        error={error}
      />
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout onLock={handleLock} vaultName={vaultName} />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/scan-review" element={<ScanReviewPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/items/:id" element={<ItemDetailPage />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/subscriptions" element={<SubscriptionsPage />} />
          <Route path="/subscriptions/:id" element={<SubscriptionDetailPage />} />
          <Route path="/engagements" element={<EngagementsPage />} />
          <Route path="/engagements/:id" element={<EngagementDetailPage />} />
          <Route path="/warranties" element={<WarrantiesPage />} />
          <Route path="/settings" element={<SettingsPage />}>
            <Route index element={<GeneralSettings />} />
            <Route path="marchands" element={<MerchantsPage />} />
            <Route path="creanciers" element={<CreditorsPage />} />
            <Route path="lieux" element={<LocationsPage />} />
            <Route path="cartes" element={<CardsPage />} />
            <Route path="coffres" element={<VaultsPage onSwitchVault={handleSwitchVault} />} />
            <Route path="nommage" element={<NamingSettings />} />
          </Route>
          <Route path="/merchants" element={<Navigate to="/settings/marchands" replace />} />
          <Route path="/locations" element={<Navigate to="/settings/lieux" replace />} />
          <Route path="/cards" element={<Navigate to="/settings/cartes" replace />} />
          <Route path="/vaults" element={<Navigate to="/settings/coffres" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    return (localStorage.getItem("trackbuy-locale") as Locale) || "fr"
  })

  const i18nValue = useMemo(() => ({
    locale,
    setLocale: (l: Locale) => {
      setLocale(l)
      localStorage.setItem("trackbuy-locale", l)
    },
    t: getTranslation(locale),
  }), [locale])

  return (
    <I18nContext.Provider value={i18nValue}>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </I18nContext.Provider>
  )
}

export default App
