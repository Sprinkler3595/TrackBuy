import { NavLink, Outlet } from "react-router-dom"
import {
  Settings as SettingsIcon,
  Vault,
  FileSignature,
  Percent,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"

export function SettingsPage() {
  const { locale, t } = useI18n()

  // Only the settings that configure the app itself. The domain lists (achats,
  // billets, garanties, revenus, remboursements) live in the sidebar, not here.
  const tabs = [
    {
      to: "/settings",
      end: true,
      icon: SettingsIcon,
      label: locale === "fr" ? "Général" : "General",
    },
    { to: "/settings/coffres", end: false, icon: Vault, label: locale === "fr" ? "Coffres" : "Vaults" },
    { to: "/settings/nommage", end: false, icon: FileSignature, label: locale === "fr" ? "Nommage" : "Naming" },
    { to: "/settings/baremes", end: false, icon: Percent, label: locale === "fr" ? "Barèmes" : "Rates" },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t("settings.title")}</h2>
        <p className="text-muted-foreground">
          {locale === "fr" ? "Configurez votre application" : "Configure your application"}
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map(({ to, end, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted",
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  )
}
