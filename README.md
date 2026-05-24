# TrackBuyV2

> Suivi d'achats personnel desktop, chiffré de bout en bout, 100 % local-first.

**Version** : `0.1.0` (alpha) — **Identifier** : `com.trackbuy.v2` — **Plateformes** : macOS, Linux, Windows (via Tauri v2)

TrackBuyV2 est une application desktop qui centralise tes achats, factures, garanties, abonnements et pièces jointes. Toutes les données restent sur ta machine, chiffrées via une clé dérivée d'un mot de passe maître. Aucune donnée ne quitte l'appareil, sauf si tu actives explicitement l'extraction de reçus par IA (qui appelle un LLM distant configurable).

---

## Sommaire

- [Stack technique](#stack-technique)
- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Arborescence du projet](#arborescence-du-projet)
- [Commandes Tauri exposées](#commandes-tauri-exposées)
- [Sécurité & chiffrement](#sécurité--chiffrement)
- [Format de backup `.tbvbak`](#format-de-backup-tbvbak)
- [Développement](#développement)
- [Roadmap / état du projet](#roadmap--état-du-projet)

---

## Stack technique

| Couche       | Technologie                                                              |
|--------------|--------------------------------------------------------------------------|
| Desktop      | Tauri v2 (Rust edition 2024)                                             |
| Frontend     | React 19 + TypeScript 5.9 + Vite 8                                       |
| UI           | Tailwind CSS 4 + shadcn/ui (Radix patterns) + lucide-react               |
| Routing      | react-router-dom v7                                                      |
| Base de données | SQLCipher (SQLite + AES-256), via `rusqlite` (`bundled-sqlcipher-vendored-openssl`) |
| Chiffrement fichiers | ChaCha20-Poly1305 (AEAD, nonce aléatoire 12 B + tag 16 B)         |
| Dérivation clé | Argon2id (m = 64 MiB, t = 3, p = 4)                                    |
| Sauvegarde   | ZIP (`zip` crate v2) — extension `.tbvbak`                                |
| OCR          | Tesseract.js (offline, traineddata `eng` + `fra` téléchargés + vérifiés SHA-256) |
| PDF          | pdfjs-dist 5                                                              |
| Plugins Tauri | dialog, notification, shell                                              |

---

## Fonctionnalités

### Suivi d'achats
- Items physiques, tickets, vouchers, licences (catégorisation par `kind`)
- Prix, date, marchand, lieu, carte de paiement utilisée
- Recherche full-text via tables virtuelles **FTS5** (`items_fts`, `subscriptions_fts`)
- Export CSV ([src/lib/export.ts](src/lib/export.ts))

### Abonnements
- Renouvellements à venir, log de paiements (`subscription_payments`)
- Roll-forward automatique des échéances dépassées
- Membres partagés (cas familles / colocs)

### Garanties
- Alertes d'expiration (`get_expiring_warranties`)
- Notifications natives via plugin Tauri

### Pièces jointes
- Tickets, factures, photos chiffrés individuellement sur disque (ChaCha20-Poly1305)
- Stockés hors base, référencés par identifiant
- Lecture/écriture passe systématiquement par le backend Rust (pas d'accès FS depuis le front)

### Multi-coffres (vaults)
- Plusieurs coffres isolés, chacun avec son propre mot de passe et salt
- Switch à chaud, ouverture du dossier vault depuis la sidebar
- Stockage : `~/.app-data/vaults/{vault_name}/`

### OCR & extraction IA
- **OCR offline** : Tesseract.js avec preprocessing (grayscale + contraste)
- **IA optionnelle** : `ai_extract_receipt` envoie l'image à un LLM distant configurable, prompt système en français, retour JSON structuré ([src/lib/ai-settings.ts](src/lib/ai-settings.ts), [src-tauri/src/commands/ai.rs](src-tauri/src/commands/ai.rs))
- Page de revue (`scan-review.tsx`) pour affiner les données avant insertion

### Sauvegarde & restauration
- Archive `.tbvbak` (ZIP) avec base SQLCipher + pièces jointes encore chiffrées + manifest
- Inspection sans déchiffrement (`inspect_backup`)

### UI
- Dark mode (light / dark / system) — [src/hooks/use-theme.ts](src/hooks/use-theme.ts)
- Internationalisation FR / EN complète — [src/lib/i18n.ts](src/lib/i18n.ts)
- Verrouillage automatique sur inactivité — [src/hooks/use-idle-lock.ts](src/hooks/use-idle-lock.ts)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React 19 + Vite, sandboxed WebView)             │
│  - Pages, hooks, i18n, lecture/écriture par invoke()        │
└─────────────────────────────────────────────────────────────┘
                │  Tauri IPC (typed via src/lib/tauri.ts)
                ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend Rust (~40 commandes, src-tauri/src/commands/)      │
│  ─ crypto::derive_key (Argon2id)                            │
│  ─ crypto::encrypt_data / decrypt_data (ChaCha20-Poly1305)  │
│  ─ db::Database (SQLCipher, WAL, FTS5)                      │
│  ─ storage::{save,read,delete}_attachment                   │
│  ─ util::path::ensure_within (anti path-traversal)          │
│  ─ util::secure_delete::shred_and_remove                    │
└─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  Système de fichiers chiffré                                │
│  ~/.app-data/vaults/{name}/                                 │
│    ├─ vault.db              (SQLCipher AES-256)             │
│    ├─ salt.bin              (Argon2id salt)                 │
│    ├─ argon2_params.json    (m_cost, t_cost, p_cost, ver)   │
│    └─ files/{id}.enc        (ChaCha20-Poly1305 par fichier) │
└─────────────────────────────────────────────────────────────┘
```

Trois principes :
1. **Pas d'accès FS depuis le front** — toute lecture/écriture passe par une commande Tauri qui valide les chemins.
2. **Clé dérivée uniquement en mémoire** — `Zeroizing<[u8; 32]>`, wipe au drop.
3. **CSP stricte** — `default-src 'self'` + `script-src 'self' 'wasm-unsafe-eval'` ([src-tauri/tauri.conf.json:27](src-tauri/tauri.conf.json:27)).

---

## Arborescence du projet

```
trackbuyv2/
├── src/                          # Frontend React
│   ├── App.tsx                   # Router (react-router v7) + I18n provider
│   ├── main.tsx                  # Entrypoint React
│   ├── index.css                 # Tailwind 4 + variables CSS
│   ├── pages/                    # 16 pages : dashboard, items, tickets,
│   │                             # warranties, subscriptions, scan, scan-review,
│   │                             # vaults, unlock, settings, etc.
│   ├── components/
│   │   ├── layout/               # AppLayout, Sidebar (theme switch, lock)
│   │   ├── ui/                   # Primitives shadcn (Button, Card, Toast…)
│   │   └── features/             # Scan review, kind selector
│   ├── hooks/                    # use-theme, use-idle-lock, use-notifications
│   └── lib/
│       ├── tauri.ts              # Wrappers typés des commandes Rust
│       ├── i18n.ts               # Traductions fr/en
│       ├── ai-settings.ts        # Config endpoint LLM
│       ├── password.ts           # Évaluation force du mot de passe
│       ├── export.ts             # Export CSV
│       ├── fuzzy-match.ts        # Matching marchands/lieux
│       └── utils.ts
│
├── src-tauri/                    # Backend Rust + config Tauri
│   ├── Cargo.toml                # Dépendances (rusqlite, argon2, chacha20poly1305, zip, zeroize…)
│   ├── tauri.conf.json           # Window, CSP, plugins, bundle
│   ├── build.rs
│   ├── capabilities/             # Permissions Tauri (scopées)
│   └── src/
│       ├── lib.rs                # invoke_handler (~40 commandes)
│       ├── main.rs
│       ├── commands/
│       │   ├── auth.rs           # create_vault, unlock_vault, switch_vault…
│       │   ├── items.rs          # CRUD items + recherche FTS5 + orders
│       │   ├── subscriptions.rs  # Renouvellements, paiements, membres
│       │   ├── warranties.rs     # CRUD + expiry alerts
│       │   ├── attachments.rs    # Chiffrement/déchiffrement fichiers
│       │   ├── backup.rs         # backup_vault, restore_backup, inspect_backup
│       │   ├── ai.rs             # ai_extract_receipt, ai_test_connection
│       │   ├── merchants.rs / locations.rs / cards.rs / reminders.rs
│       │   └── files.rs          # read/write texte & binaire (safe paths)
│       ├── db/
│       │   ├── mod.rs            # Database struct, ouverture SQLCipher, WAL
│       │   ├── models.rs         # Types métier
│       │   └── migrations.rs     # Schéma v1 + indices FTS5
│       ├── crypto/mod.rs         # Argon2id + ChaCha20-Poly1305
│       ├── storage/mod.rs        # Pièces jointes sur disque
│       └── util/
│           ├── path.rs           # ensure_within (anti path-traversal)
│           └── secure_delete.rs  # Overwrite 3× avant unlink
│
├── scripts/
│   └── fetch-tessdata.mjs        # Télécharge tessdata (eng+fra) + vérifie SHA-256
├── public/                       # Assets statiques (tessdata après fetch)
├── index.html
├── vite.config.ts                # Alias @/, plugin Tailwind, target Safari 13
└── package.json
```

---

## Commandes Tauri exposées

Environ 40 commandes, regroupées par domaine. Toutes sont typées côté front dans [src/lib/tauri.ts](src/lib/tauri.ts).

| Groupe          | Fichier                                              | Exemples                                              |
|-----------------|------------------------------------------------------|-------------------------------------------------------|
| Auth / vaults   | [auth.rs](src-tauri/src/commands/auth.rs)            | `create_vault`, `unlock_vault`, `lock_vault`, `list_vaults`, `switch_vault`, `get_active_vault_location` |
| Items           | [items.rs](src-tauri/src/commands/items.rs)          | `get_items` (+ recherche FTS5), `create_item`, `update_item`, `delete_item`, `create_order_with_items` |
| Abonnements    | [subscriptions.rs](src-tauri/src/commands/subscriptions.rs) | `get_upcoming_renewals`, `roll_forward_due_subscriptions`, `mark_renewed`, `log_subscription_payment`, `*_subscription_member` |
| Garanties       | [warranties.rs](src-tauri/src/commands/warranties.rs) | `get_warranties`, `get_expiring_warranties`, CRUD     |
| Pièces jointes  | [attachments.rs](src-tauri/src/commands/attachments.rs) | Upload chiffré, lecture déchiffrée, suppression sécurisée |
| Marchands / lieux / cartes / rappels | `merchants.rs` / `locations.rs` / `cards.rs` / `reminders.rs` | CRUD                       |
| Backup          | [backup.rs](src-tauri/src/commands/backup.rs)        | `backup_vault`, `inspect_backup`, `restore_backup`, `export_items_csv`, `get_stats` |
| IA              | [ai.rs](src-tauri/src/commands/ai.rs)                | `ai_extract_receipt`, `ai_test_connection`            |
| Fichiers        | [files.rs](src-tauri/src/commands/files.rs)          | `read_text_file`, `write_text_file`, `read_binary_file_base64` |

---

## Sécurité & chiffrement

### Dérivation de clé — Argon2id

- **Paramètres** : `m_cost = 64 MiB`, `t_cost = 3`, `p_cost = 4` (≈ 500 ms sur desktop moderne)
- **Sel** : 16 octets aléatoires (`OsRng`), stockés dans `salt.bin` (non secret)
- **Paramètres persistés** par vault dans `argon2_params.json` → upgrade futur possible sans casser les coffres existants
- Code : [src-tauri/src/crypto/mod.rs](src-tauri/src/crypto/mod.rs)

### Données au repos

- **Base SQLCipher** — AES-256, page-level, `PRAGMA cipher_memory_security`, mode WAL, foreign keys
  - La clé dérivée Argon2id est passée directement comme blob hex (pas de KDF additionnel côté SQLCipher)
- **Pièces jointes** — chaque fichier chiffré indépendamment via ChaCha20-Poly1305
  - Format : `nonce (12 B) || ciphertext || tag (16 B)`
  - Nonce aléatoire par fichier (`OsRng`), jamais réutilisé

### Sécurité mémoire & disque

- Clés en mémoire : `Zeroizing<[u8; 32]>` → wipe automatique au drop
- Suppression de fichier : overwrite 3 passes avant `unlink()` ([src-tauri/src/util/secure_delete.rs](src-tauri/src/util/secure_delete.rs)) — best-effort sur SSD TRIM

### Hardening Tauri

- **CSP stricte** ([src-tauri/tauri.conf.json:27](src-tauri/tauri.conf.json:27)) : `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`
- **Capabilities scopées** ([src-tauri/capabilities/](src-tauri/capabilities/)) — pas d'accès filesystem direct depuis la WebView
- **Validation de chemin** : `util::path::ensure_within` rejette `..`, séparateurs absolus, fichiers cachés (`.foo`)
- **IPC typé** : toutes les commandes passent par `tauri::command` et un wrapper TS unique

---

## Format de backup `.tbvbak`

Un backup est une archive ZIP standard, avec l'extension `.tbvbak`. Le contenu reste **chiffré au sein de l'archive** — aucun fichier en clair, le mot de passe maître est requis pour restaurer.

```
backup.tbvbak  (ZIP, deflate)
├── manifest.json            { format: "tbvbak", format_version: 1, vault_name, created_at: RFC3339 }
├── vault.db                 # Base SQLCipher chiffrée
├── salt.bin                 # 16 octets, sel Argon2id
├── argon2_params.json       # { m_cost_kib, t_cost, p_cost, version }
└── files/
    └── {attachment_id}.enc  # ChaCha20-Poly1305 (nonce + ciphertext + tag)
```

**Flow restauration** (`restore_backup`) :
1. Lecture du manifest, vérification version
2. Extraction dans un nouveau vault directory
3. Dérivation de la clé via `salt.bin` + `argon2_params.json` + mot de passe
4. Test d'ouverture SQLCipher → si succès, le vault est utilisable
5. Les pièces jointes restent chiffrées sur disque et sont déchiffrées à la volée à la lecture

Inspection sans déchiffrement disponible via `inspect_backup` (lit uniquement `manifest.json`).

---

## Développement

### Prérequis

- **Node.js** ≥ 22
- **Rust** ≥ 1.94 (édition 2024)
- Dépendances système Tauri : <https://tauri.app/start/prerequisites/>
- OpenSSL n'est **pas** requis : `rusqlite` est compilé avec `bundled-sqlcipher-vendored-openssl`

### Installation

```bash
# Dépendances npm
npm install

# Données Tesseract pour l'OCR — une seule fois (~14 MB, vérifie les SHA-256)
npm run fetch-tessdata
```

### Lancement

```bash
# Frontend seul (sans backend Rust, pour itérer sur l'UI)
npm run dev

# Application Tauri complète (front + backend Rust + fenêtre native)
npm run tauri dev
# ou : cargo tauri dev
```

### Build de production

```bash
npm run tauri build
# Produit les bundles dans src-tauri/target/release/bundle/
```

### Qualité

```bash
npm run lint        # ESLint flat config
npm run build       # tsc -b && vite build (typecheck strict)
```

---

## Roadmap / état du projet

**Statut actuel** : alpha (v0.1.0), utilisable au quotidien mais le format de schéma DB et de backup peuvent encore évoluer avant 1.0.

### Stable & implémenté

- Multi-coffres avec switch à chaud
- CRUD complet items / abonnements / garanties / marchands / lieux / cartes / rappels
- Recherche full-text FTS5
- Pièces jointes chiffrées par fichier
- Backup / restore / inspect
- OCR offline (Tesseract.js)
- Extraction IA optionnelle (LLM distant configurable)
- Dark mode, FR/EN, idle lock, notifications natives

### Partiel / à étendre

- **Extension de garantie via carte de paiement** : le champ `extended_warranty_months` existe sur les cartes, mais aucun calcul automatique n'est encore appliqué aux items achetés avec celles-ci
- **Migration de schéma** : seul `migrations v1` est défini — pas encore de chemin de migration multi-versions
- **Rotation de mot de passe maître** : non exposée pour l'instant

### Pistes futures

- Sync chiffrée optionnelle (E2E, multi-device)
- Import depuis exports bancaires
- Tableaux de bord analytiques (dépenses par catégorie / marchand)
- Migration de schéma versionnée + tests de migration

---

_Toutes les contributions, issues et retours sont les bienvenus tant que le projet est en alpha._
