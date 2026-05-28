import { useEffect, useCallback } from "react"
import * as api from "@/lib/tauri"

const DEDUP_KEY = "trackbuy-notifications-fired"
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const DEDUP_GC_MS = 30 * 24 * 60 * 60 * 1000 // 30d

type FingerprintEntry = { fp: string; firedAt: number }

function readFingerprints(): FingerprintEntry[] {
  try {
    const raw = localStorage.getItem(DEDUP_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as FingerprintEntry[]
    const cutoff = Date.now() - DEDUP_GC_MS
    return parsed.filter((e) => e.firedAt >= cutoff)
  } catch {
    return []
  }
}

function writeFingerprints(entries: FingerprintEntry[]): void {
  try {
    localStorage.setItem(DEDUP_KEY, JSON.stringify(entries))
  } catch {
    /* quota / private mode */
  }
}

/** Returns true if the fingerprint has been fired in the last 24h. */
export function shouldDedupNotification(fp: string): boolean {
  const entries = readFingerprints()
  const cutoff = Date.now() - DEDUP_TTL_MS
  return entries.some((e) => e.fp === fp && e.firedAt >= cutoff)
}

export function recordNotificationFired(fp: string): void {
  const entries = readFingerprints().filter((e) => e.fp !== fp)
  entries.push({ fp, firedAt: Date.now() })
  writeFingerprints(entries)
}

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

async function notifyOnce(fp: string, title: string, body: string): Promise<void> {
  if (shouldDedupNotification(fp)) return
  await notify(title, body)
  recordNotificationFired(fp)
}

export function useWarrantyNotifications(enabled: boolean) {
  const checkAll = useCallback(async () => {
    if (!enabled) return
    // Warranties expiring in ≤ 7 days. Fingerprint includes the id + expiry
    // so renewing a warranty (new expiry) triggers a fresh notification.
    try {
      const expiring = await api.getExpiringWarranties(7)
      if (expiring.length === 1) {
        const w = expiring[0]
        await notifyOnce(
          `warranty:${w.item_id}:${w.end_date ?? ""}`,
          "TrackBuy — Garanties",
          `La garantie de "${w.item_description}" expire bientôt!`,
        )
      } else if (expiring.length > 1) {
        const fp = `warranties-batch:${expiring.map((w) => w.item_id).sort().join(",")}`
        await notifyOnce(
          fp,
          "TrackBuy — Garanties",
          `${expiring.length} garanties expirent dans les 7 prochains jours!`,
        )
      }
    } catch {
      /* silent */
    }

    try {
      const reminders = await api.getUpcomingReminders(7)
      if (reminders.length === 0) return
      if (reminders.length === 1) {
        const r = reminders[0]
        const verb = r.reminder_type === "event" ? "Événement" : "Expiration"
        await notifyOnce(
          `reminder:${r.item_id}:${r.reminder_type}:${r.days_until}`,
          `TrackBuy — ${verb}`,
          `${r.description} — dans ${r.days_until} jour(s)`,
        )
      } else {
        const fp = `reminders-batch:${reminders.map((r) => `${r.item_id}:${r.reminder_type}`).sort().join(",")}`
        await notifyOnce(
          fp,
          "TrackBuy — Rappels",
          `${reminders.length} rappels dans les 7 prochains jours!`,
        )
      }
    } catch {
      /* silent */
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    // Check on mount + whenever we transition unlocked→true so the first
    // notification doesn't wait up to 6h.
    checkAll()
    const interval = setInterval(checkAll, 6 * 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [checkAll, enabled])
}
