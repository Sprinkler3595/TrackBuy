import { NavLink } from "react-router-dom"
import {
  Home,
  Inbox,
  FileText,
  Landmark,
  Receipt,
  Settings,
  Lock,
  Moon,
  Sun,
  Monitor,
  ShoppingBag,
  Shield,
  Ticket,
  HandCoins,
  Undo2,
  ScanLine,
  LineChart,
  LayoutDashboard,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/hooks/use-theme"
import { useI18n, type TranslationKeys } from "@/lib/i18n"
import { Button } from "@/components/ui/button"

// Three-section navigation. Previously the sidebar exposed only six entries
// while the app had 30+ pages — most were reachable only via deep links.
type NavItem = { to: string; icon: typeof Home; labelKey: keyof TranslationKeys }
type NavSection = { headingKey: keyof TranslationKeys | null; items: NavItem[] }

const navSections: NavSection[] = [
  {
    headingKey: null,
    items: [
      { to: "/ce-mois", icon: Home, labelKey: "nav.thisMonth" },
      { to: "/inbox", icon: Inbox, labelKey: "nav.inbox" },
      { to: "/engagements", icon: FileText, labelKey: "nav.engagements" },
      { to: "/banque", icon: Landmark, labelKey: "nav.bank" },
      { to: "/impots", icon: Receipt, labelKey: "nav.taxes" },
    ],
  },
  {
    headingKey: "nav.section.library",
    items: [
      { to: "/items", icon: ShoppingBag, labelKey: "nav.items" },
      { to: "/warranties", icon: Shield, labelKey: "nav.warranties" },
      // Module Abonnements déprécié au profit des Engagements : retiré de la
      // navigation. La page reste accessible (/subscriptions) le temps de la
      // migration, proposée via une bannière sur la page Engagements.
      { to: "/tickets", icon: Ticket, labelKey: "nav.tickets" },
      { to: "/incomes", icon: HandCoins, labelKey: "nav.incomes" },
      { to: "/reimbursements", icon: Undo2, labelKey: "nav.reimbursements" },
    ],
  },
  {
    headingKey: "nav.section.tools",
    items: [
      { to: "/scan", icon: ScanLine, labelKey: "nav.scan" },
      { to: "/finances", icon: LineChart, labelKey: "nav.finances" },
      { to: "/dashboard", icon: LayoutDashboard, labelKey: "nav.dashboard" },
    ],
  },
]

interface SidebarProps {
  onLock: () => void
  vaultName: string
}

export function Sidebar({ onLock, vaultName }: SidebarProps) {
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()

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
