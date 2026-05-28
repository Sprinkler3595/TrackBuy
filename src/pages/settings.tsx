import { NavLink, Outlet } from "react-router-dom"
import {
  Settings as SettingsIcon,
  Store,
  MapPin,
  CreditCard,
  Vault,
  FileSignature,
  Landmark,
  Users,
  ShoppingBag,
  Ticket,
  Shield,
  Repeat,
  HandCoins,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"

export function SettingsPage() {
  const { locale, t } = useI18n()

  const tabs = [
    {
      to: "/settings",
      end: true,
      icon: SettingsIcon,
      label: locale === "fr" ? "Général" : "General",
    },
    { to: "/settings/menage", end: false, icon: Users, label: locale === "fr" ? "Ménage" : "Household" },
    { to: "/settings/marchands", end: false, icon: Store, label: locale === "fr" ? "Marchands" : "Merchants" },
    { to: "/settings/creanciers", end: false, icon: Landmark, label: locale === "fr" ? "Créanciers" : "Creditors" },
    { to: "/settings/lieux", end: false, icon: MapPin, label: locale === "fr" ? "Lieux" : "Locations" },
    { to: "/settings/cartes", end: false, icon: CreditCard, label: locale === "fr" ? "Cartes" : "Cards" },
    { to: "/settings/coffres", end: false, icon: Vault, label: locale === "fr" ? "Coffres" : "Vaults" },
    { to: "/settings/nommage", end: false, icon: FileSignature, label: locale === "fr" ? "Nommage" : "Naming" },
    { to: "/items", end: false, icon: ShoppingBag, label: locale === "fr" ? "Achats" : "Items" },
    { to: "/tickets", end: false, icon: Ticket, label: locale === "fr" ? "Billets & Codes" : "Tickets & Codes" },
    { to: "/warranties", end: false, icon: Shield, label: locale === "fr" ? "Garanties" : "Warranties" },
    { to: "/subscriptions", end: false, icon: Repeat, label: locale === "fr" ? "Abonnements" : "Subscriptions" },
    { to: "/incomes", end: false, icon: HandCoins, label: locale === "fr" ? "Revenus" : "Incomes" },
    { to: "/reimbursements", end: false, icon: HandCoins, label: locale === "fr" ? "Remboursements" : "Reimbursements" },
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
