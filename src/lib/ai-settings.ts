export type AiProvider = "infomaniak" | "ollama"

/**
 * Vrai si le fournisseur envoie les données à un service DISTANT (cloud).
 * Sert à avertir l'utilisateur que la promesse « 100 % local » ne tient plus
 * dès qu'un tel fournisseur est sélectionné. Ollama tourne en local ; seul un
 * `ollamaUrl` non-local ferait exception, traité à part au point d'appel.
 */
export function isCloudProvider(provider: AiProvider): boolean {
  return provider === "infomaniak"
}


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
