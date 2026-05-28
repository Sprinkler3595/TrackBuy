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

/// Surfaces upcoming engagement charges (BVR / QR-bills awaiting payment)
/// as native notifications. Mirrors `useSubscriptionNotifications`: same
/// 7-day window, same 6-hour polling cadence. Auto-paid LSV/SEPA charges
/// are excluded automatically since the roll-forward inserts them with
/// status='paid' rather than 'scheduled'.
export function useEngagementNotifications(enabled: boolean) {
  const checkAll = useCallback(async () => {
    if (!enabled) return
    try {
      const upcoming = await api.getUpcomingEngagementCharges(7)
      if (upcoming.length === 1) {
        const c = upcoming[0]
        await notifyOnce(
          `charge:${c.id}:${c.due_date}`,
          "TrackBuy — Engagements",
          `Une facture arrive à échéance bientôt.`,
        )
      } else if (upcoming.length > 1) {
        const fp = `charges-batch:${upcoming.map((c) => c.id).sort().join(",")}`
        await notifyOnce(
          fp,
          "TrackBuy — Engagements",
          `${upcoming.length} factures à payer dans les 7 jours.`,
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
