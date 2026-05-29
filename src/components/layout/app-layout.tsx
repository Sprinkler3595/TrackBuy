import { Outlet } from "react-router-dom"
import { Sidebar } from "@/components/layout/sidebar"
import { OnboardingWizard } from "@/components/features/onboarding-wizard"

interface AppLayoutProps {
  onLock: () => void
  vaultName: string
}

export function AppLayout({ onLock, vaultName }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar onLock={onLock} vaultName={vaultName} />
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
      {/* First-run budget assistant — self-decides whether to show. */}
      <OnboardingWizard vaultName={vaultName} />
    </div>
  )
}
