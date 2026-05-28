import { useEffect, useCallback } from "react"
import * as api from "@/lib/tauri"
import { shouldDedupNotification, recordNotificationFired } from "./use-notifications"

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

async function notifyOnce(fp: string, title: string, body: string): Promise<void> {
  if (shouldDedupNotification(fp)) return
  await notify(title, body)
  recordNotificationFired(fp)
}

export function useSubscriptionNotifications(enabled: boolean) {
  const checkAll = useCallback(async () => {
    if (!enabled) return
    try {
      const upcoming = await api.getUpcomingRenewals(7)
      if (upcoming.length === 1) {
        const s = upcoming[0]
        await notifyOnce(
          `subscription:${s.id}:${s.next_renewal_date}`,
          "TrackBuy — Abonnements",
          `L'abonnement "${s.name}" se renouvelle bientôt!`,
        )
      } else if (upcoming.length > 1) {
        const fp = `subscriptions-batch:${upcoming.map((s) => s.id).sort().join(",")}`
        await notifyOnce(
          fp,
          "TrackBuy — Abonnements",
          `${upcoming.length} abonnements se renouvellent dans 7 jours!`,
        )
      }
    } catch {
      /* silent */
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    checkAll()
    const interval = setInterval(checkAll, 6 * 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [checkAll, enabled])
}
