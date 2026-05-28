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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/hooks/use-theme"
import { Button } from "@/components/ui/button"

// Swiss-first navigation (six entries) replacing the old eleven-entry layout.
// Items, Tickets, Warranties, Subscriptions, Reimbursements et l'ancien
// dashboard sont accessibles via les sous-vues de Ce mois / Banque / Réglages.
type NavItem = { to: string; icon: typeof Home; label: string }

const navItems: NavItem[] = [
  { to: "/ce-mois", icon: Home, label: "Ce mois" },
  { to: "/inbox", icon: Inbox, label: "Inbox" },
  { to: "/engagements", icon: FileText, label: "Engagements" },
  { to: "/banque", icon: Landmark, label: "Banque" },
  { to: "/impots", icon: Receipt, label: "Impôts" },
  { to: "/settings", icon: Settings, label: "Réglages" },
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
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map(({ to, icon: Icon, label }) => (
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
