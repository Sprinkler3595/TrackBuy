/// Les identifiants d'accès au registre du commerce suisse (Zefix).
///
/// L'API publique de Zefix exige une authentification HTTP Basic. L'accès est
/// gratuit mais NOMINATIF : il s'obtient en écrivant à zefix@bj.admin.ch.
/// Aucun identifiant n'est donc livré avec l'application — en embarquer un le
/// partagerait entre tous les utilisateurs, ce que les conditions d'accès
/// n'autorisent pas.
///
/// Ils vivent dans le stockage local du navigateur, comme les réglages d'IA :
/// ce sont des identifiants de service, pas des données personnelles, et les
/// mettre dans le coffre chiffré obligerait à le déverrouiller pour une simple
/// recherche de raison sociale.

export interface ZefixSettings {
  username: string
  password: string
}

const STORAGE_KEY = "trackbuy-zefix-settings"

export const emptyZefixSettings = (): ZefixSettings => ({ username: "", password: "" })

export function getZefixSettings(): ZefixSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyZefixSettings()
    const parsed = JSON.parse(raw) as Partial<ZefixSettings>
    return {
      username: typeof parsed.username === "string" ? parsed.username : "",
      password: typeof parsed.password === "string" ? parsed.password : "",
    }
  } catch {
    return emptyZefixSettings()
  }
}

export function saveZefixSettings(s: ZefixSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* stockage indisponible : la recherche le dira au premier appel */
  }
}

/// Vrai quand une recherche a une chance d'aboutir. Sert à proposer le bouton
/// plutôt qu'à le griser en silence.
export const hasZefixCredentials = (s: ZefixSettings): boolean =>
  s.username.trim().length > 0 && s.password.length > 0
