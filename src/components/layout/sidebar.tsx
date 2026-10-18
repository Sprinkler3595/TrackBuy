import { useEffect, useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import {
  Home,
  Inbox,
  FileText,
  Settings,
  HelpCircle,
  Lock,
  Moon,
  Sun,
  Monitor,
  ShoppingBag,
  Shield,
  Ticket,
  HandCoins,
  Undo2,
  Car,
  CalendarClock,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/hooks/use-theme"
import { useI18n, type TranslationKeys } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { getHealthSeason } from "@/lib/tauri"

// Two-section navigation. The app deliberately exposes only the flows that are
// fully built: the daily view + the three guided domains on top, the reference
// lists below. Anything else is reachable from inside those pages.
type NavItem = { to: string; icon: typeof Home; labelKey: keyof TranslationKeys }
type NavSection = { headingKey: keyof TranslationKeys | null; items: NavItem[] }

const navSections: NavSection[] = [
  {
    headingKey: null,
    items: [
      { to: "/ce-mois", icon: Home, labelKey: "nav.thisMonth" },
      { to: "/inbox", icon: Inbox, labelKey: "nav.inbox" },
      { to: "/engagements", icon: FileText, labelKey: "nav.engagements" },
      { to: "/vehicules", icon: Car, labelKey: "nav.vehicles" },
    ],
  },
  {
    headingKey: "nav.section.library",
    items: [
      { to: "/items", icon: ShoppingBag, labelKey: "nav.items" },
      { to: "/warranties", icon: Shield, labelKey: "nav.warranties" },
      { to: "/tickets", icon: Ticket, labelKey: "nav.tickets" },
      { to: "/incomes", icon: HandCoins, labelKey: "nav.incomes" },
      { to: "/reimbursements", icon: Undo2, labelKey: "nav.reimbursements" },
    ],
  },
]

interface SidebarProps {
  onLock: () => void
  vaultName: string
}

/// The premium-season module only exists in the navigation while it is
/// useful: from the publication of the premiums to 31 December, and only for
/// a household with health insurance. Re-read on every navigation, so the
/// "to decide" count follows what was just saved.
function useHealthSeasonEntry(): { year: number; pending: number } | null {
  const location = useLocation()
  const [entry, setEntry] = useState<{ year: number; pending: number } | null>(null)
  useEffect(() => {
    let alive = true
    getHealthSeason()
      .then((s) => {
        if (!alive) return
        if (!s.open || s.policies.length === 0) { setEntry(null); return }
        setEntry({ year: s.season_year + 1, pending: s.policies.filter((p) => !p.notice || p.notice.decision === "pending").length })
      })
      .catch(() => alive && setEntry(null))
    return () => { alive = false }
  }, [location.pathname])
  return entry
}

export function Sidebar({ onLock, vaultName }: SidebarProps) {
  const { theme, setTheme } = useTheme()
  const { t, locale } = useI18n()
  const season = useHealthSeasonEntry()

  const nextTheme = () => {
    const order: Array<"light" | "dark" | "system"> = ["light", "dark", "system"]
    const idx = order.indexOf(theme)
    setTheme(order[(idx + 1) % order.length])
  }

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor
  const themeLabel =
    theme === "dark"
      ? t("settings.dark")
      : theme === "light"
        ? t("settings.light")
        : t("settings.system")

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">
          T
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">TrackBuy</h1>
          <p className="text-xs text-muted-foreground">{vaultName}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-3 overflow-y-auto p-3">
        {navSections.map((section, i) => (
          <div key={i} className="space-y-1">
            {section.headingKey && (
              <h2 className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {t(section.headingKey)}
              </h2>
            )}
            {section.items.map(({ to, icon: Icon, labelKey }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {t(labelKey)}
              </NavLink>
            ))}
            {i === 0 && season && (
              <NavLink
                to="/saison-primes"
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-primary hover:bg-sidebar-accent",
                  )
                }
              >
                <CalendarClock className="h-4 w-4" />
                {locale === "fr" ? `Primes ${season.year}` : `${season.year} premiums`}
                {season.pending > 0 && (
                  <span className="ml-auto rounded-full bg-amber-500/15 px-2 text-xs text-amber-700 dark:text-amber-400">{season.pending}</span>
                )}
              </NavLink>
            )}
          </div>
        ))}
        <div className="space-y-1 pt-1">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )
            }
          >
            <Settings className="h-4 w-4" />
            {t("nav.settings")}
          </NavLink>
          {/* L'aide vit à côté des réglages, en bas : on la cherche quand on
              bloque, pas quand on navigue. */}
          <NavLink
            to="/aide"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )
            }
          >
            <HelpCircle className="h-4 w-4" />
            {locale === "fr" ? "Aide" : "Help"}
          </NavLink>
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t p-3 space-y-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={nextTheme}
        >
          <ThemeIcon className="h-4 w-4" />
          {themeLabel}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive"
          onClick={onLock}
        >
          <Lock className="h-4 w-4" />
          {t("nav.lock")}
        </Button>
      </div>
    </aside>
  )
}
