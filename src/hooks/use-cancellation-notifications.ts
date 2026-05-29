import { useEffect, useCallback } from "react"
import * as api from "@/lib/tauri"
import { getCancellationInfo } from "@/lib/cancellation"
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

/// How far ahead we warn that a cancellation notice is due. Wider than the
/// payment windows (30 days) because resignation letters often need lead time
/// for registered mail — but not the full 90-day on-screen lookahead, to keep
/// the notification timely rather than premature.
const NOTIFY_WINDOW_DAYS = 45

/// Proactively warns when an engagement's cancellation deadline (contract end
/// − notice period) is approaching, so the user doesn't get tacitly renewed by
/// missing it. Mirrors the cadence of the other engagement notification hooks
/// (check on unlock, then every 6h). Deduped per deadline so it fires once.
export function useCancellationNotifications(enabled: boolean) {
  const checkAll = useCallback(async () => {
    if (!enabled) return
    try {
      const engagements = await api.getEngagements({ status: "active" })
      const due = engagements
        .map((e) => ({ e, info: getCancellationInfo(e) }))
        .filter(
          ({ info }) =>
            info != null &&
            info.daysUntilDeadline >= 0 &&
            info.daysUntilDeadline <= NOTIFY_WINDOW_DAYS,
        )

      if (due.length === 1) {
        const { e, info } = due[0]
        await notifyOnce(
          `cancel:${e.id}:${info!.deadlineISO}`,
          "TrackBuy — Résiliation",
          `Pensez à résilier « ${e.name} » avant le ${info!.deadlineISO}.`,
        )
      } else if (due.length > 1) {
        const fp = `cancel-batch:${due
          .map(({ e, info }) => `${e.id}@${info!.deadlineISO}`)
          .sort()
          .join(",")}`
        await notifyOnce(
          fp,
          "TrackBuy — Résiliation",
          `${due.length} contrats sont bientôt à résilier si vous ne souhaitez pas les reconduire.`,
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
