import { NavLink } from "react-router-dom"
import {
  LayoutDashboard,
  ShoppingBag,
  Shield,
  Settings,
  Lock,
  Moon,
  Sun,
  Monitor,
  ScanLine,
  Ticket,
  Repeat,
  FileText,
  TrendingUp,
  HandCoins,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/hooks/use-theme"
import { Button } from "@/components/ui/button"

type NavSection = { label?: string; items: { to: string; icon: typeof LayoutDashboard; label: string }[] }

const navSections: NavSection[] = [
  {
    items: [
      { to: "/dashboard", icon: LayoutDashboard, label: "Tableau de bord" },
      { to: "/scan", icon: ScanLine, label: "Scanner un reçu" },
    ],
  },
  {
    label: "Achats",
    items: [
      { to: "/items", icon: ShoppingBag, label: "Achats" },
      { to: "/tickets", icon: Ticket, label: "Billets & Codes" },
      { to: "/warranties", icon: Shield, label: "Garanties" },
    ],
  },
  {
    label: "Finances",
    items: [
      { to: "/engagements", icon: FileText, label: "Engagements" },
      { to: "/subscriptions", icon: Repeat, label: "Abonnements en ligne" },
      { to: "/incomes", icon: TrendingUp, label: "Revenus" },
      { to: "/reimbursements", icon: HandCoins, label: "Remboursements" },
    ],
  },
  {
    items: [
      { to: "/settings", icon: Settings, label: "Paramètres" },
    ],
  },
]

interface SidebarProps {
  onLock: () => void
  vaultName: string
}

export function Sidebar({ onLock, vaultName }: SidebarProps) {
  const { theme, setTheme } = useTheme()

  const nextTheme = () => {
    const order: Array<"light" | "dark" | "system"> = ["light", "dark", "system"]
    const idx = order.indexOf(theme)
    setTheme(order[(idx + 1) % order.length])
  }

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor

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
      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        {navSections.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {section.label && (
              <p className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.label}
              </p>
            )}
            {section.items.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </div>
        ))}
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
          {theme === "dark" ? "Sombre" : theme === "light" ? "Clair" : "Système"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive"
          onClick={onLock}
        >
          <Lock className="h-4 w-4" />
          Verrouiller
        </Button>
      </div>
    </aside>
  )
}
