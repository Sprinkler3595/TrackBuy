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

/// Surfaces upcoming engagement charges (BVR / QR-bills awaiting payment)
/// as native notifications. Mirrors `useSubscriptionNotifications`: same
/// 7-day window, same 6-hour polling cadence. Auto-paid LSV/SEPA charges
/// are excluded automatically since the roll-forward inserts them with
/// status='paid' rather than 'scheduled'.
export function useEngagementNotifications() {
  const checkAll = useCallback(async () => {
    try {
      const upcoming = await api.getUpcomingEngagementCharges(7)
      if (upcoming.length === 1) {
        await notify(
          "TrackBuy — Engagements",
          `Une facture arrive à échéance bientôt.`,
        )
      } else if (upcoming.length > 1) {
        await notify(
          "TrackBuy — Engagements",
          `${upcoming.length} factures à payer dans les 7 jours.`,
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
