import { useEffect, useRef, useState } from "react"
import * as api from "@/lib/tauri"

/// Calcule la projection à mesure que l'utilisateur tape.
///
/// Le calcul part en base (barèmes, surcharges, barème cantonal) : on le
/// débounce, et on ignore toute réponse dépassée. Sans ce garde-fou, une
/// requête lente pour « 8 00 » écraserait le résultat de « 8 000 ».
export function useNetFromGross(req: api.NetFromGrossRequest | null, delayMs = 300) {
  const [result, setResult] = useState<api.NetFromGrossResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const key = req ? JSON.stringify(req) : null

  useEffect(() => {
    if (!key) {
      setResult(null)
      setError(null)
      setLoading(false)
      return
    }
    const ticket = ++latest.current
    setLoading(true)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const r = await api.computeNetFromGross(JSON.parse(key) as api.NetFromGrossRequest)
          if (ticket !== latest.current) return
          setResult(r)
          setError(null)
        } catch (e) {
          if (ticket !== latest.current) return
          setError(String(e))
          setResult(null)
        } finally {
          if (ticket === latest.current) setLoading(false)
        }
      })()
    }, delayMs)
    return () => clearTimeout(timer)
  }, [key, delayMs])

  return { result, loading, error }
}
