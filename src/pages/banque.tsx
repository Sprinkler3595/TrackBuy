import { useState } from "react"
import { Banknote, FileText, Landmark, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BankStatementsPage } from "@/pages/bank-statements"
import { FinancesPage } from "@/pages/finances"
import { Camt053Import } from "@/components/features/camt053-import"

type Tab = "overview" | "statements"

/// Lightweight tabbed shell that surfaces the existing finances overview and
/// bank statements list under a single "Banque" entry. The sub-pages keep
/// their own layouts — we render them straight (no wrapper Card) so any
/// internal links or in-page navigation behave exactly like on /finances and
/// /bank-statements respectively.
export function BanquePage() {
  const [tab, setTab] = useState<Tab>("statements")
  const [camtOpen, setCamtOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Landmark className="h-6 w-6" />
            Banque
          </h1>
          <p className="text-sm text-muted-foreground">
            Importez vos relevés et explorez votre vue d'ensemble financière.
          </p>
        </div>
        <Button onClick={() => setCamtOpen(true)} variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Importer CamT.053
        </Button>
      </div>

      <div className="flex gap-2 border-b">
        <TabButton active={tab === "statements"} onClick={() => setTab("statements")}>
          <FileText className="mr-2 inline h-4 w-4" />
          Relevés
        </TabButton>
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          <Banknote className="mr-2 inline h-4 w-4" />
          Vue d'ensemble
        </TabButton>
      </div>

      {tab === "overview" ? <FinancesPage /> : <BankStatementsPage />}

      {camtOpen && <Camt053Import onClose={() => setCamtOpen(false)} />}
    </div>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}
