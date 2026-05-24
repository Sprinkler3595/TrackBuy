import { useEffect, useCallback } from "react"
import * as api from "@/lib/tauri"

async function notify(title: string, body: string): Promise<void> {
  try {
    const { sendNotification, isPermissionGranted, requestPermission } =
      await import("@tauri-apps/plugin-notification")

    let permission = await isPermissionGranted()
    if (!permission) {
      const result = await requestPermission()
      permission = result === "granted"
    }

    if (permission) {
      sendNotification({ title, body })
    }
  } catch {
    // Notification API not available (browser mode)
  }
}

export function useSubscriptionNotifications() {
  const checkAll = useCallback(async () => {
    try {
      const upcoming = await api.getUpcomingRenewals(7)
      if (upcoming.length === 1) {
        await notify(
          "TrackBuyV2 — Abonnements",
          `L'abonnement "${upcoming[0].name}" se renouvelle bientôt!`,
        )
      } else if (upcoming.length > 1) {
        await notify(
          "TrackBuyV2 — Abonnements",
          `${upcoming.length} abonnements se renouvellent dans 7 jours!`,
        )
      }
    } catch {
      /* silent */
    }
  }, [])

  useEffect(() => {
    checkAll()
    const interval = setInterval(checkAll, 6 * 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [checkAll])
}
