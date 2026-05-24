import { useEffect, useRef, useState } from "react"

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
] as const

/**
 * Auto-lock the app after `timeoutMs` of inactivity.
 * Pass `enabled = false` to disable (e.g. when the vault is already locked).
 * `timeoutMs <= 0` also disables auto-lock.
 */
export function useIdleLock(
  onLock: () => void,
  timeoutMs: number,
  enabled: boolean,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onLockRef = useRef(onLock)

  // Keep the latest onLock without forcing the effect to re-attach listeners.
  useEffect(() => {
    onLockRef.current = onLock
  }, [onLock])

  useEffect(() => {
    if (!enabled || timeoutMs <= 0) return

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => onLockRef.current(), timeoutMs)
    }

    reset()
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, reset, { passive: true })
    }
    document.addEventListener("visibilitychange", reset)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, reset)
      }
      document.removeEventListener("visibilitychange", reset)
    }
  }, [timeoutMs, enabled])
}

const STORAGE_KEY = "trackbuy-idle-lock-minutes"
const CHANGE_EVENT = "trackbuy-idle-lock-changed"
const DEFAULT_MINUTES = 10

export function getIdleLockMinutes(): number {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return DEFAULT_MINUTES
  const n = parseInt(raw, 10)
  if (Number.isNaN(n) || n < 0) return DEFAULT_MINUTES
  return n
}

export function setIdleLockMinutes(minutes: number) {
  localStorage.setItem(STORAGE_KEY, String(minutes))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

/** React state synced with the persisted auto-lock minutes setting. */
export function useIdleLockMinutes(): number {
  const [minutes, setMinutes] = useState<number>(() => getIdleLockMinutes())
  useEffect(() => {
    const handler = () => setMinutes(getIdleLockMinutes())
    window.addEventListener(CHANGE_EVENT, handler)
    return () => window.removeEventListener(CHANGE_EVENT, handler)
  }, [])
  return minutes
}
