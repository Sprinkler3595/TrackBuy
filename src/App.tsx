import { useState, useEffect, useCallback, useMemo } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AppLayout } from "@/components/layout/app-layout"
import { ToastProvider } from "@/components/ui/toast"
import { ErrorBoundary } from "@/components/error-boundary"
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
import { IncomesPage } from "@/pages/incomes"
import { IncomeDetailPage } from "@/pages/income-detail"
import { ReimbursementsPage } from "@/pages/reimbursements"
import { FinancesPage } from "@/pages/finances"
import { BankStatementsPage } from "@/pages/bank-statements"
import { BankStatementReviewPage } from "@/pages/bank-statement-review"
import { SettingsPage } from "@/pages/settings"
import { GeneralSettings } from "@/pages/settings-general"
import { NamingSettings } from "@/pages/settings-naming"
import { HouseholdSettings } from "@/pages/settings-household"
import { MerchantRulesSettings } from "@/pages/settings-merchant-rules"
import { ScanPage } from "@/pages/scan"
import { ScanReviewPage } from "@/pages/scan-review"
import { CeMoisPage } from "@/pages/ce-mois"
import { InboxPage } from "@/pages/inbox"
import { TaxesPage } from "@/pages/taxes"
import { BanquePage } from "@/pages/banque"
import { useWarrantyNotifications } from "@/hooks/use-notifications"
import { useSubscriptionNotifications } from "@/hooks/use-subscription-notifications"
import { useEngagementNotifications } from "@/hooks/use-engagement-notifications"
import { useCancellationNotifications } from "@/hooks/use-cancellation-notifications"
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

  // Activate warranty + subscription + engagement notifications when unlocked.
  // Gating on `unlocked` avoids firing IPC against a closed vault and
  // schedules the first check immediately after unlock instead of up to 6h
  // later.
  useWarrantyNotifications(unlocked)
  useSubscriptionNotifications(unlocked)
  useEngagementNotifications(unlocked)
  useCancellationNotifications(unlocked)

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
      // the user sees a current view from the first paint. Log failures so
      // a silent skip doesn't quietly make "Ce mois" show zero charges due.
      try { await api.rollForwardDueSubscriptions() } catch (e) {
        console.error("rollForwardDueSubscriptions failed", e)
      }
      try { await api.rollForwardDueEngagements() } catch (e) {
        console.error("rollForwardDueEngagements failed", e)
      }
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
    try {
      await api.switchVault(name, password)
      setVaultName(name)
    } catch (err) {
      // switch_vault locks the old vault before unlocking the new one; if the
      // new unlock fails (wrong password, missing salt…) the app is left in
      // a zombie "unlocked=true" state pointing at nothing. Fall back to the
      // unlock screen so the user can retry cleanly instead of chasing
      // mysterious "Vault not unlocked" errors on every page.
      setUnlocked(false)
      setError(String(err))
      throw err
    }
  }, [])

  // The backend emits `vault-locked` when restore_backup nukes the currently
  // active vault. Without this hook the front-end keeps thinking it's
  // unlocked and every subsequent IPC call fails with a cryptic message.
  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    ;(async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event")
        const off = await listen<string>("vault-locked", () => {
          setUnlocked(false)
        })
        if (cancelled) off()
        else unlisten = off
      } catch {
        /* event API not available in browser mode */
      }
    })()
    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
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
          <Route path="/ce-mois" element={<ErrorBoundary><CeMoisPage /></ErrorBoundary>} />
          <Route path="/inbox" element={<ErrorBoundary><InboxPage /></ErrorBoundary>} />
          <Route path="/impots" element={<ErrorBoundary><TaxesPage /></ErrorBoundary>} />
          <Route path="/banque" element={<ErrorBoundary><BanquePage /></ErrorBoundary>} />
          <Route path="/bank-statements/:id/review" element={<ErrorBoundary><BankStatementReviewPage /></ErrorBoundary>} />
          <Route path="/dashboard" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
          <Route path="/scan" element={<ErrorBoundary><ScanPage /></ErrorBoundary>} />
          <Route path="/scan-review" element={<ErrorBoundary><ScanReviewPage /></ErrorBoundary>} />
          <Route path="/items" element={<ErrorBoundary><ItemsPage /></ErrorBoundary>} />
          <Route path="/items/:id" element={<ErrorBoundary><ItemDetailPage /></ErrorBoundary>} />
          <Route path="/tickets" element={<ErrorBoundary><TicketsPage /></ErrorBoundary>} />
          <Route path="/subscriptions" element={<ErrorBoundary><SubscriptionsPage /></ErrorBoundary>} />
          <Route path="/subscriptions/:id" element={<ErrorBoundary><SubscriptionDetailPage /></ErrorBoundary>} />
          <Route path="/engagements" element={<ErrorBoundary><EngagementsPage /></ErrorBoundary>} />
          <Route path="/engagements/:id" element={<ErrorBoundary><EngagementDetailPage /></ErrorBoundary>} />
          <Route path="/incomes" element={<ErrorBoundary><IncomesPage /></ErrorBoundary>} />
          <Route path="/incomes/:id" element={<ErrorBoundary><IncomeDetailPage /></ErrorBoundary>} />
          <Route path="/reimbursements" element={<ErrorBoundary><ReimbursementsPage /></ErrorBoundary>} />
          <Route path="/finances" element={<ErrorBoundary><FinancesPage /></ErrorBoundary>} />
          <Route path="/bank-statements" element={<ErrorBoundary><BankStatementsPage /></ErrorBoundary>} />
          <Route path="/warranties" element={<ErrorBoundary><WarrantiesPage /></ErrorBoundary>} />
          <Route path="/settings" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>}>
            <Route index element={<ErrorBoundary><GeneralSettings /></ErrorBoundary>} />
            <Route path="menage" element={<ErrorBoundary><HouseholdSettings /></ErrorBoundary>} />
            <Route path="marchands" element={<ErrorBoundary><MerchantsPage /></ErrorBoundary>} />
            <Route path="creanciers" element={<ErrorBoundary><CreditorsPage /></ErrorBoundary>} />
            <Route path="lieux" element={<ErrorBoundary><LocationsPage /></ErrorBoundary>} />
            <Route path="cartes" element={<ErrorBoundary><CardsPage /></ErrorBoundary>} />
            <Route path="coffres" element={<ErrorBoundary><VaultsPage onSwitchVault={handleSwitchVault} /></ErrorBoundary>} />
            <Route path="nommage" element={<ErrorBoundary><NamingSettings /></ErrorBoundary>} />
            <Route path="regles-marchand" element={<ErrorBoundary><MerchantRulesSettings /></ErrorBoundary>} />
          </Route>
          <Route path="/merchants" element={<Navigate to="/settings/marchands" replace />} />
          <Route path="/locations" element={<Navigate to="/settings/lieux" replace />} />
          <Route path="/cards" element={<Navigate to="/settings/cartes" replace />} />
          <Route path="/vaults" element={<Navigate to="/settings/coffres" replace />} />
          <Route path="*" element={<Navigate to="/ce-mois" replace />} />
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
