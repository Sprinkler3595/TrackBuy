import { useEffect, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPrice } from "@/lib/utils"

const STORAGE_KEY = "trackbuy-incomes-visible"

/// Read/write the "income amounts visible" preference. Defaults to false
/// (masked) — incomes are the most sensitive numbers in the vault, so a
/// shoulder-surf is shielded by default. Persisted in localStorage so the
/// choice survives a reload but resets on a fresh install.
export function useAmountsVisible(): [boolean, (v: boolean) => void] {
  const [visible, setVisible] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1" } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, visible ? "1" : "0") } catch {}
  }, [visible])
  return [visible, setVisible]
}

interface MaskedAmountProps {
  amount: number | null | undefined
  currency: string
  visible: boolean
  className?: string
}

export function MaskedAmount({ amount, currency, visible, className }: MaskedAmountProps) {
  if (amount == null) return <span className={className}>—</span>
  if (visible) return <span className={className}>{formatPrice(amount, currency)}</span>
  // Match the formatted width roughly so the layout doesn't jump when
  // toggling visibility.
  return <span className={className}>••• {currency}</span>
}

interface VisibilityToggleProps {
  visible: boolean
  onChange: (v: boolean) => void
  labelShow: string
  labelHide: string
}

export function VisibilityToggle({ visible, onChange, labelShow, labelHide }: VisibilityToggleProps) {
  const Icon = visible ? EyeOff : Eye
  return (
    <Button variant="outline" size="sm" onClick={() => onChange(!visible)}>
      <Icon className="h-4 w-4" />
      {visible ? labelHide : labelShow}
    </Button>
  )
}
