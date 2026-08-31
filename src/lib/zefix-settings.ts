/// Les identifiants d'accès au registre du commerce suisse (Zefix).
///
/// FACULTATIFS. L'API publique de Zefix s'interroge sans authentification :
/// dans le cas ordinaire, ce fichier ne contient rien et la recherche marche
/// quand même. Ils ne servent qu'aux accès nominatifs, que l'OFRC délivre
/// gratuitement contre un courriel à zefix@bj.admin.ch, si le registre venait
/// à refuser les appels anonymes.
///
/// Aucun identifiant n'est livré avec l'application : un compte nominatif
/// embarqué serait partagé entre tous ses utilisateurs, ce que les conditions
/// d'accès n'autorisent pas.
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
