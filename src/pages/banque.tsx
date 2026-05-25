import { useState } from "react"
import { Banknote, FileText, Landmark, Upload } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { BankStatementsPage } from "@/pages/bank-statements"
import { FinancesPage } from "@/pages/finances"
import { Camt053Import } from "@/components/features/camt053-import"

type Tab = "overview" | "statements"

/// Lightweight tabbed shell that fuses the existing finances overview and
/// bank statements list under a single "Banque" entry. Adds the CamT.053
/// importer in the toolbar — recommended path versus the PDF + AI fallback.
export function BanquePage() {
  const [tab, setTab] = useState<Tab>("overview")
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
            Vue d'ensemble financière et imports de relevés.
          </p>
        </div>
        <Button onClick={() => setCamtOpen(true)} variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Importer CamT.053
        </Button>
      </div>

      <div className="flex gap-2 border-b">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          <Banknote className="mr-2 inline h-4 w-4" />
          Vue d'ensemble
        </TabButton>
        <TabButton active={tab === "statements"} onClick={() => setTab("statements")}>
          <FileText className="mr-2 inline h-4 w-4" />
          Relevés
        </TabButton>
      </div>

      {tab === "overview" ? (
        <Card>
          <CardContent className="p-0">
            <FinancesPage />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <BankStatementsPage />
          </CardContent>
        </Card>
      )}

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
