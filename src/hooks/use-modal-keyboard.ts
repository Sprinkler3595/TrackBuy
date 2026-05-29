import { useEffect } from "react"

/// Wire up Escape-to-close on a modal/dialog. Centralised so every modal
/// gets the same keyboard affordance — previously inbox, subscriptions,
/// reimbursements all required mouse-only dismissal.
export function useModalKeyboard(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [active, onClose])
}
