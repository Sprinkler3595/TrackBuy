import { useEffect, useState } from "react"
import {
  DEDUCTION_FIELDS,
  EXPENSE_FIELDS,
  GROSS_FIELDS,
} from "@/components/features/payslip-form-state"
import { formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// Le décompte d'un versement déjà enregistré, présenté comme une fiche de
/// salaire : le brut poste par poste, la barre des retenues, ce qui s'ajoute
/// après, le net.
///
/// La liste des versements dit combien on a touché ; elle ne disait pas d'où
/// venait le chiffre. Or c'est la seule question qu'on se pose en rouvrant un
/// mois — « pourquoi celui-là est plus bas ? ».
///
/// Les libellés viennent de `payslip-form-state` : un même poste ne doit pas
/// porter deux noms selon qu'on le saisit ou qu'on le relit.

function Row({
  label,
  amount,
  currency,
  hint,
  strong,
  negative,
}: {
  label: string
  amount: number
  currency: string
  hint?: string
  strong?: boolean
  negative?: boolean
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={`min-w-0 text-sm ${strong ? "font-medium" : ""}`}>
        {label}
        {hint && <span className="ml-1.5 text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className={`shrink-0 text-sm tabular-nums ${strong ? "font-medium" : ""}`}>
        {negative ? "− " : ""}
        {formatPrice(amount, currency)}
      </span>
    </li>
  )
}

export function ReceiptBreakdown({ receipt }: { receipt: api.IncomeReceipt }) {
  const currency = receipt.currency
  const [supplements, setSupplements] = useState<api.ReceiptSupplement[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await api.getReceiptSupplements(receipt.id)
        if (!cancelled) setSupplements(list)
      } catch {
        if (!cancelled) setSupplements([])
      }
    })()
    return () => { cancelled = true }
  }, [receipt.id])

  const grossLines = GROSS_FIELDS.map((f) => ({
    key: f.key as string,
    label: f.label,
    amount: receipt[f.key],
  })).filter((l) => l.amount != null && l.amount !== 0)

  const deductionLines = DEDUCTION_FIELDS.map((f) => ({
    label: f.label,
    amount: receipt[f.key],
  })).filter((l) => l.amount != null && l.amount !== 0)

  const afterLines = EXPENSE_FIELDS.map((f) => ({
    label: f.label,
    amount: receipt[f.key],
  })).filter((l) => l.amount != null && l.amount !== 0)

  const family = receipt.family_allowance_amount ?? 0
  const grossSum = grossLines.reduce((s, l) => s + (l.amount as number), 0) + family
  // Le brut imprimé fait foi quand il est renseigné : c'est ce que porte la
  // fiche, et un écart avec la somme des postes est justement ce que le
  // contrôle de conformité signale.
  const grossTotal = receipt.gross_amount ?? grossSum
  const deductionsTotal = deductionLines.reduce((s, l) => s + (l.amount as number), 0)

  if (grossLines.length === 0 && deductionLines.length === 0 && family === 0) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        Ce versement n'a que son montant net. Ouvrez-le en modification pour détailler le brut
        et les retenues.
      </p>
    )
  }

  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-2">
      <ul className="divide-y">
        {grossLines.map((l) => (
          <Row
            key={l.key}
            label={l.label}
            amount={l.amount as number}
            currency={currency}
            hint={
              // Le détail d'« Autre élément de salaire » est le seul qui ne se
              // devine pas : sans lui, 780 CHF ne disent pas une semaine
              // d'astreinte et deux dimanches.
              l.key === "other_gross_amount" && supplements.length > 0
                ? supplements
                    .map((s) => `${s.quantity} × ${s.label.toLowerCase()}`)
                    .join(", ")
                : undefined
            }
          />
        ))}
        {family > 0 && (
          <Row
            label="Allocations familiales"
            amount={family}
            currency={currency}
            hint="hors assiette AVS"
          />
        )}
        <Row label="Brut total" amount={grossTotal} currency={currency} strong />

        {deductionLines.map((l) => (
          <Row
            key={l.label}
            label={l.label}
            amount={l.amount as number}
            currency={currency}
            negative
          />
        ))}
        {deductionsTotal > 0 && (
          <Row
            label="Total des retenues"
            amount={deductionsTotal}
            currency={currency}
            negative
            strong
          />
        )}

        {afterLines.map((l) => (
          <Row key={l.label} label={l.label} amount={l.amount as number} currency={currency} />
        ))}

        <Row label="Net versé" amount={receipt.amount} currency={currency} strong />
      </ul>
    </div>
  )
}
