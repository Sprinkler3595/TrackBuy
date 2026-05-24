import { useEffect, useState } from "react"
import { ShoppingBag } from "lucide-react"
import * as api from "@/lib/tauri"

type Size = "sm" | "md" | "lg"

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-10 w-10",
  md: "h-14 w-14",
  lg: "h-20 w-20",
}

const ICON_SIZES: Record<Size, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
}

// Module-scope cache: itemId → resolved data URL (or null if no image).
// Avoids re-decrypting the same image when navigating between list and detail
// or when the list re-renders. Cleared only on full reload.
const cache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()

export function invalidateThumbnail(itemId: string) {
  cache.delete(itemId)
  inflight.delete(itemId)
}

async function resolveThumbnail(itemId: string): Promise<string | null> {
  if (cache.has(itemId)) return cache.get(itemId) ?? null
  if (inflight.has(itemId)) return inflight.get(itemId)!

  const promise = (async () => {
    try {
      const atts = await api.getAttachments(itemId)
      const images = atts.filter((a) => a.mime_type.startsWith("image/"))
      // Prefer attachments tagged "photo" (the actual product photo) over
      // image-typed receipts/invoices that happen to be JPG/PNG.
      const image = images.find((a) => a.attachment_type === "photo") ?? images[0]
      if (!image) {
        cache.set(itemId, null)
        return null
      }
      const dataUrl = await api.getAttachmentData(image.id)
      cache.set(itemId, dataUrl)
      return dataUrl
    } catch {
      cache.set(itemId, null)
      return null
    } finally {
      inflight.delete(itemId)
    }
  })()

  inflight.set(itemId, promise)
  return promise
}

interface ItemThumbnailProps {
  itemId: string
  size?: Size
}

export function ItemThumbnail({ itemId, size = "md" }: ItemThumbnailProps) {
  const [src, setSrc] = useState<string | null>(() => cache.get(itemId) ?? null)
  const [loading, setLoading] = useState(() => !cache.has(itemId))

  useEffect(() => {
    let cancelled = false
    if (cache.has(itemId)) {
      setSrc(cache.get(itemId) ?? null)
      setLoading(false)
      return
    }
    setLoading(true)
    resolveThumbnail(itemId).then((url) => {
      if (cancelled) return
      setSrc(url)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [itemId])

  const sizeClass = SIZE_CLASSES[size]
  const iconClass = ICON_SIZES[size]

  if (src) {
    return (
      <div className={`${sizeClass} shrink-0 overflow-hidden rounded-md border bg-muted`}>
        <img src={src} alt="" className="h-full w-full object-cover" />
      </div>
    )
  }

  return (
    <div className={`${sizeClass} shrink-0 flex items-center justify-center rounded-md border bg-muted`}>
      {loading ? (
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
      ) : (
        <ShoppingBag className={`${iconClass} text-muted-foreground/40`} />
      )}
    </div>
  )
}
