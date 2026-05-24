export type AiProvider = "infomaniak" | "ollama"

export interface AiSettings {
  enabled: boolean
  provider: AiProvider
  apiKey: string
  infomaniakProductId: string
  ollamaUrl: string
  model: string
}

const STORAGE_KEY = "trackbuy-ai-settings"

export function defaultAiSettings(provider: AiProvider = "ollama"): AiSettings {
  return {
    enabled: false,
    provider,
    apiKey: "",
    infomaniakProductId: "",
    ollamaUrl: "http://localhost:11434",
    model: provider === "infomaniak" ? "mixtral" : "llama3.1",
  }
}

export function getAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultAiSettings()
    const parsed = JSON.parse(raw)
    return { ...defaultAiSettings(parsed.provider ?? "ollama"), ...parsed }
  } catch {
    return defaultAiSettings()
  }
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}
