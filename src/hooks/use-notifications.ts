import { useEffect, useCallback } from "react"
import * as api from "@/lib/tauri"

/**
 * Lazily resolve OS notification permission once per call cycle and dispatch
 * a notification if granted. Shared between warranty and digital-item
 * reminders so we don't re-prompt the user twice.
 */
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

export function useWarrantyNotifications() {
  const checkAll = useCallback(async () => {
    // Warranties expiring in ≤ 7 days
    try {
      const expiring = await api.getExpiringWarranties(7)
      if (expiring.length === 1) {
        await notify(
          "TrackBuyV2 — Garanties",
          `La garantie de "${expiring[0].item_description}" expire bientôt!`,
        )
      } else if (expiring.length > 1) {
        await notify(
          "TrackBuyV2 — Garanties",
          `${expiring.length} garanties expirent dans les 7 prochains jours!`,
        )
      }
    } catch {
      /* silent */
    }

    // Upcoming events + voucher/license expirations in ≤ 7 days
    try {
      const reminders = await api.getUpcomingReminders(7)
      if (reminders.length === 0) return
      if (reminders.length === 1) {
        const r = reminders[0]
        const verb = r.reminder_type === "event" ? "Événement" : "Expiration"
        await notify(
          `TrackBuyV2 — ${verb}`,
          `${r.description} — dans ${r.days_until} jour(s)`,
        )
      } else {
        await notify(
          "TrackBuyV2 — Rappels",
          `${reminders.length} rappels dans les 7 prochains jours!`,
        )
      }
    } catch {
      /* silent */
    }
  }, [])

  useEffect(() => {
    // Check on mount
    checkAll()

    // Check every 6 hours
    const interval = setInterval(checkAll, 6 * 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [checkAll])
}
