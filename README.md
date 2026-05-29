# TrackBuy

> Suivi d'achats et de finances personnelles desktop, chiffré de bout en bout, 100 % local-first.

**Version** : `0.1.0` (alpha) — **Identifier** : `com.trackbuy.v2` — **Plateformes** : macOS, Linux, Windows (via Tauri v2)

TrackBuy centralise tes achats, factures, garanties, abonnements, engagements récurrents (assurances, loyer, télécom, hypothèque…), revenus, remboursements, relevés bancaires et déclaration d'impôts. Toutes les données restent sur ta machine, chiffrées via une clé dérivée d'un mot de passe maître.

> **Confidentialité & IA** : aucune donnée ne quitte l'appareil, **sauf** si tu actives explicitement l'extraction par IA (`ai_extract_receipt`, extraction de relevé). Dans ce cas, image + texte sont envoyés à un LLM **distant configurable** (Infomaniak par défaut, ou un Ollama local). Pointé sur une API cloud, cela sort du modèle « 100 % local » — voir [Sécurité & chiffrement](#sécurité--chiffrement).

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
| Frontend     | React 19 + TypeScript 5.9 + Vite                                         |
| UI           | Tailwind CSS 4 + shadcn/ui (Radix patterns) + lucide-react               |
| Routing      | react-router-dom v7                                                      |
| Base de données | SQLCipher (SQLite + AES-256), via `rusqlite` (`bundled-sqlcipher-vendored-openssl`) |
| Chiffrement fichiers | ChaCha20-Poly1305 (AEAD, nonce aléatoire 12 B + tag 16 B)         |
| Dérivation clé | Argon2id (m = 64 MiB, t = 3, p = 4)                                    |
| Sauvegarde   | ZIP (`zip` crate v2) — extension `.tbvbak`                                |
| Banque       | Parsing CAMT.053 / QR-facture suisse (`quick-xml`)                        |
| IA (optionnelle) | `reqwest` (rustls) vers Infomaniak ou Ollama                         |
| OCR          | Tesseract.js (offline, traineddata `eng` + `fra` téléchargés + vérifiés SHA-256) |
| PDF          | pdfjs-dist                                                                |
| Plugins Tauri | dialog, notification, shell                                              |

---

## Fonctionnalités

### Suivi d'achats
- Items physiques, billets/tickets, vouchers, licences (catégorisation par `kind`)
- Prix, date, marchand, lieu, carte de paiement, n° facture, référence produit, TVA
- Recherche full-text via tables virtuelles **FTS5** (`items_fts`, `subscriptions_fts`)
- Commandes multi-articles (`orders`), export CSV ([src/lib/export.ts](src/lib/export.ts))

### Engagements récurrents (contrats)
- Assurances (dont LAMal : modèle, franchise), loyer, télécom, hypothèque (taux, amortissement), impôts, abonnements de services
- Échéancier de charges (`engagement_charges`), révisions de contrat (`engagement_revisions`)
- Roll-forward automatique des échéances dépassées, **statut « présumé / à confirmer »** sur les lignes auto-générées pour ne pas affirmer un débit non vérifié
- Créanciers (`creditors`), hiérarchie parent/enfant, délais de résiliation + génération de lettre de résiliation

### Abonnements (moteur historique)
- Renouvellements à venir, log de paiements (`subscription_payments`), période d'essai
- Roll-forward automatique (mêmes garde-fous « présumé ») et membres partagés (familles / colocs)
- Migration possible d'un abonnement vers un engagement (`migrate_subscription_to_engagement`)

### Revenus & remboursements
- Revenus récurrents (`incomes`) + fiches de paie détaillées (`income_receipts` : brut, AVS, 2e pilier, impôt source…)
- Remboursements en attente (`pending_reimbursements`) : assurance, employeur, garantie…

### Banque
- Import de relevés (PDF/OCR ou **CAMT.053** XML), extraction de transactions
- **Rapprochement** des transactions avec achats/engagements (`suggest_matches_for_statement`, subset-sum pour commandes groupées)
- Règles de matching réutilisables (`bank_match_rules`), création d'article/facture depuis une transaction (avec garde-fou anti-doublon)
- **QR-facture suisse** : lecture du QR-code de paiement

### Impôts (Suisse)
- Rubriques fiscales déductibles par achat/charge (`tax_category` : médical, dons, 3e pilier, formation, garde d'enfants…)
- Ménage (`household_members`) : attribution des dépenses par personne

### Garanties
- Alertes d'expiration (`get_expiring_warranties`), notifications natives

### Pièces jointes
- Tickets, factures, photos chiffrés **individuellement** sur disque (ChaCha20-Poly1305)
- Stockés hors base, référencés par identifiant ; lecture/écriture **toujours** via le backend Rust
- Modèles de nommage configurables (`filename_templates`)

### Multi-coffres (vaults)
- Plusieurs coffres isolés, chacun avec son mot de passe, son sel et ses paramètres Argon2id
- Switch à chaud, ouverture du dossier vault depuis l'app
- **Rotation du mot de passe maître** (`change_master_password`) : re-chiffre base + pièces jointes de façon rejouable
- Stockage : `~/.app-data/vaults/{vault_name}/`

### OCR & extraction IA
- **OCR offline** : Tesseract.js avec preprocessing (grayscale + contraste)
- **IA optionnelle** : envoie image/texte à un LLM **distant configurable** (Infomaniak / Ollama) — voir l'avertissement de confidentialité plus haut
- Page de revue (`scan-review.tsx`) pour affiner les données avant insertion ; la date d'achat non détectée reste **vide** (jamais inventée) et doit être confirmée

### Sauvegarde & restauration
- Archive `.tbvbak` (ZIP) : base SQLCipher + pièces jointes encore chiffrées + manifest
- Inspection sans déchiffrement (`inspect_backup`)

### UI
- Trois vues de synthèse : **Ce mois** (accueil), **Finances**, **Dashboard**
- Totaux **par devise** (aucune conversion silencieuse ; les montants en devise étrangère sont signalés, jamais masqués)
- Dark mode (light / dark / system), i18n FR / EN, verrouillage auto sur inactivité (avec rate-limit anti-bruteforce persisté)

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
│  Backend Rust (~165 commandes, src-tauri/src/commands/)     │
│  ─ crypto::derive_key (Argon2id)                            │
│  ─ crypto::encrypt_data / decrypt_data (ChaCha20-Poly1305)  │
│  ─ db::Database (SQLCipher, WAL, FTS5) + db::rekey_db_file   │
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
│    ├─ attempts.json         (rate-limit déverrouillage)     │
│    └─ files/{id}.enc        (ChaCha20-Poly1305 par fichier) │
└─────────────────────────────────────────────────────────────┘
```

Trois principes :
1. **Pas d'accès FS depuis le front** — toute lecture/écriture passe par une commande Tauri qui valide les chemins.
2. **Clé dérivée uniquement en mémoire** — `Zeroizing<[u8; 32]>`, wipe au drop.
3. **CSP stricte** — `default-src 'self'` + `script-src 'self' 'wasm-unsafe-eval'` ([src-tauri/tauri.conf.json](src-tauri/tauri.conf.json)).

---

## Arborescence du projet

```
trackbuy/
├── src/                          # Frontend React (31 pages)
│   ├── App.tsx                   # Router (react-router v7) + I18n provider
│   ├── main.tsx                  # Entrypoint React
│   ├── pages/                    # ce-mois, inbox, items, item-detail, tickets,
│   │                             # warranties, subscriptions(+detail), engagements(+detail),
│   │                             # incomes(+detail), reimbursements, banque, bank-statements,
│   │                             # bank-statement-review, creditors, taxes, scan, scan-review,
│   │                             # finances, dashboard, vaults, unlock, locations, merchants,
│   │                             # cards, settings(+general/household/naming)…
│   ├── components/
│   │   ├── layout/               # AppLayout, Sidebar (sections nav, theme, lock)
│   │   ├── ui/                   # Primitives shadcn (Button, Card, Toast, ConfirmDialog…)
│   │   └── features/             # scan-review, camt053-import, qrbill-review,
│   │                             # cancellation-letter, attachments-panel, csv-import…
│   ├── hooks/                    # use-theme, use-idle-lock, use-notifications…
│   └── lib/
│       ├── tauri.ts              # Wrappers typés des commandes Rust
│       ├── i18n.ts               # Traductions fr/en
│       ├── ai-settings.ts        # Config endpoint LLM (Infomaniak / Ollama)
│       ├── finance.ts            # Équivalents mensuels/annuels par périodicité
│       ├── cancellation.ts       # Calcul des délais de résiliation
│       ├── export.ts / fuzzy-match.ts / password.ts / utils.ts
│
├── src-tauri/                    # Backend Rust + config Tauri
│   ├── Cargo.toml                # rusqlite, argon2, chacha20poly1305, zip, zeroize, reqwest, quick-xml…
│   ├── tauri.conf.json           # Window, CSP, plugins, bundle
│   ├── capabilities/             # Permissions Tauri (scopées)
│   └── src/
│       ├── lib.rs                # invoke_handler (~165 commandes)
│       ├── commands/             # auth, items, subscriptions, engagements, creditors,
│       │                         # warranties, attachments, backup, ai, bank_statements,
│       │                         # camt053, qrbill, classify, incomes, pending_invoices,
│       │                         # pending_reimbursements, taxes, household, reminders,
│       │                         # merchants, locations, cards, filename_templates,
│       │                         # swiss_seed, this_month, files
│       ├── db/
│       │   ├── mod.rs            # Database (SQLCipher, WAL), rekey_db_file (rotation)
│       │   ├── models.rs         # Types métier
│       │   └── migrations.rs     # Schéma v1 → v15 + indices + FTS5
│       ├── crypto/mod.rs         # Argon2id + ChaCha20-Poly1305
│       ├── storage/mod.rs        # Pièces jointes sur disque
│       └── util/
│           ├── path.rs           # ensure_within (anti path-traversal)
│           └── secure_delete.rs  # Overwrite (une passe de zéros) avant unlink
│
├── scripts/fetch-tessdata.mjs    # Télécharge tessdata (eng+fra) + vérifie SHA-256
├── public/                       # Assets statiques (tessdata après fetch)
├── index.html / vite.config.ts / package.json
```

---

## Commandes Tauri exposées

Environ **165 commandes**, regroupées par domaine. Toutes sont typées côté front dans [src/lib/tauri.ts](src/lib/tauri.ts).

| Groupe          | Fichier                                              | Exemples                                              |
|-----------------|------------------------------------------------------|-------------------------------------------------------|
| Auth / vaults   | [auth.rs](src-tauri/src/commands/auth.rs)            | `create_vault`, `unlock_vault`, `lock_vault`, `switch_vault`, `change_master_password`, `get_active_vault_location` |
| Items           | [items.rs](src-tauri/src/commands/items.rs)          | `get_items` (+ FTS5), `create_item`, `update_item`, `create_order_with_items` |
| Engagements     | [engagements.rs](src-tauri/src/commands/engagements.rs) | `get_engagements`, `roll_forward_due_engagements`, `mark_charge_paid`, `confirm_engagement_charge`, `migrate_subscription_to_engagement` |
| Créanciers      | [creditors.rs](src-tauri/src/commands/creditors.rs)  | CRUD `creditors`                                      |
| Abonnements     | [subscriptions.rs](src-tauri/src/commands/subscriptions.rs) | `roll_forward_due_subscriptions`, `mark_renewed`, `log_subscription_payment`, `confirm_subscription_payment` |
| Revenus         | [incomes.rs](src-tauri/src/commands/incomes.rs)      | CRUD `incomes` + `income_receipts`                    |
| Remboursements  | [pending_reimbursements.rs](src-tauri/src/commands/pending_reimbursements.rs) | CRUD + statuts (pending/claimed/partial) |
| Banque          | [bank_statements.rs](src-tauri/src/commands/bank_statements.rs) · [camt053.rs](src-tauri/src/commands/camt053.rs) · [qrbill.rs](src-tauri/src/commands/qrbill.rs) · [classify.rs](src-tauri/src/commands/classify.rs) | `add_bank_statement`, `suggest_matches_for_statement`, `apply_transaction_match`, `create_item_from_transaction`, `parse_camt053`, `parse_qr_bill` |
| Impôts / ménage | [taxes.rs](src-tauri/src/commands/taxes.rs) · [household.rs](src-tauri/src/commands/household.rs) | rubriques déductibles, membres du ménage |
| Garanties       | [warranties.rs](src-tauri/src/commands/warranties.rs) | `get_warranties`, `get_expiring_warranties`, CRUD     |
| Pièces jointes  | [attachments.rs](src-tauri/src/commands/attachments.rs) | upload chiffré, lecture déchiffrée, suppression best-effort, par type d'entité |
| Synthèse        | [this_month.rs](src-tauri/src/commands/this_month.rs) · [backup.rs](src-tauri/src/commands/backup.rs) | `get_this_month` (totaux par devise), `get_stats` |
| Backup          | [backup.rs](src-tauri/src/commands/backup.rs)        | `backup_vault`, `inspect_backup`, `restore_backup`, exports CSV |
| IA              | [ai.rs](src-tauri/src/commands/ai.rs)                | `ai_extract_receipt`, `ai_extract_bank_statement`, `ai_test_connection` |
| Divers          | `merchants.rs` / `locations.rs` / `cards.rs` / `reminders.rs` / `filename_templates.rs` / `swiss_seed.rs` / `files.rs` | CRUD & utilitaires |

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
  - Format : `nonce (12 B) || ciphertext || tag (16 B)`, nonce aléatoire par fichier (`OsRng`)

### Rotation du mot de passe maître

`change_master_password` re-dérive une clé (nouveau sel + paramètres), applique `PRAGMA rekey` sur la base **et** re-chiffre toutes les pièces jointes. L'opération est **rejouable** via un journal (`rekey.journal`) : une interruption est soit annulée (le coffre reste sur l'ancien mot de passe), soit terminée au déverrouillage suivant — jamais de coffre à moitié chiffré.

### Anti-bruteforce

Le déverrouillage est rate-limité (5 essais puis backoff exponentiel jusqu'à 5 min), **persisté sur disque** (`attempts.json`) pour survivre à un redémarrage du process.

### Sécurité mémoire & disque

- Clés en mémoire : `Zeroizing<[u8; 32]>` → wipe automatique au drop
- Suppression de fichier : **une passe de zéros** avant `unlink()` ([src-tauri/src/util/secure_delete.rs](src-tauri/src/util/secure_delete.rs)). ⚠️ Sur SSD/USB (TRIM, wear-leveling, FTL), l'écrasement peut être redirigé : ce n'est **pas** une garantie d'effacement irréversible, seulement du best-effort. La vraie protection reste le chiffrement au repos.

### Confidentialité de l'extraction IA

L'IA est **désactivée par défaut**. Une fois activée, `ai_extract_receipt` / `ai_extract_bank_statement` envoient image + texte au fournisseur configuré ([src/lib/ai-settings.ts](src/lib/ai-settings.ts)) :
- **Ollama** (`http://localhost:11434` par défaut) → reste local ;
- **Infomaniak** (`api.infomaniak.com`) → **service cloud** : les données quittent l'appareil. À éviter pour des reçus sensibles si tu veux garder le modèle 100 % local.

### Hardening Tauri

- **CSP stricte** : `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`
- **Capabilities scopées** ([src-tauri/capabilities/](src-tauri/capabilities/)) — pas d'accès filesystem direct depuis la WebView
- **Validation de chemin** : `util::path::ensure_within` rejette `..`, séparateurs absolus, fichiers cachés
- **Refus d'ouverture d'un schéma plus récent** que `CURRENT_SCHEMA_VERSION` (évite la corruption silencieuse)

---

## Format de backup `.tbvbak`

Un backup est une archive ZIP standard, extension `.tbvbak`. Le contenu reste **chiffré au sein de l'archive** — aucun fichier en clair, le mot de passe maître est requis pour restaurer.

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
1. Lecture du manifest, vérification de `format_version` (refus si plus récent)
2. Extraction dans un vault directory (rejet des entrées hors-dossier / path-traversal)
3. Le mot de passe maître + `salt.bin` + `argon2_params.json` re-dérivent la clé au déverrouillage
4. Les pièces jointes restent chiffrées sur disque, déchiffrées à la volée à la lecture

Inspection sans déchiffrement via `inspect_backup` (lit uniquement `manifest.json`).

---

## Développement

### Prérequis

- **Node.js** ≥ 22
- **Rust** ≥ 1.94 (édition 2024)
- Dépendances système Tauri : <https://tauri.app/start/prerequisites/> (sous Linux : `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`)
- OpenSSL n'est **pas** requis : `rusqlite` est compilé avec `bundled-sqlcipher-vendored-openssl`

### Installation

```bash
npm install
npm run fetch-tessdata   # tessdata OCR (eng+fra), une fois, vérifie les SHA-256
```

### Lancement

```bash
npm run dev          # Frontend seul (itérer sur l'UI)
npm run tauri dev    # Application Tauri complète (front + backend + fenêtre native)
```

### Build de production

```bash
npm run tauri build  # bundles dans src-tauri/target/release/bundle/
```

### Qualité

```bash
npm run lint                        # ESLint flat config
npm run build                       # tsc -b && vite build (typecheck strict)
cd src-tauri && cargo test          # tests Rust (crypto, rotation, roll-forward, backup, devises…)
cd src-tauri && cargo clippy        # lints Rust
```

---

## Roadmap / état du projet

**Statut actuel** : alpha (v0.1.0), utilisable au quotidien — le schéma DB (`CURRENT_SCHEMA_VERSION = 15`) et le format de backup peuvent encore évoluer avant 1.0.

### Stable & implémenté

- Multi-coffres + switch à chaud + **rotation du mot de passe maître** (rekey base + pièces jointes, rejouable)
- **Migration de schéma versionnée** (`migrate_v1` → `migrate_v15`, refus des schémas plus récents)
- Achats / engagements / abonnements / revenus / remboursements / garanties / créanciers / ménage
- Banque : import CAMT.053 + OCR, QR-facture, rapprochement avec garde-fou anti-doublon
- Impôts : rubriques déductibles, attribution par membre du ménage
- Roll-forward avec statut « présumé / à confirmer » (pas de paiement fictif affirmé)
- Totaux **par devise** sans conversion silencieuse
- Recherche FTS5, pièces jointes chiffrées par fichier, backup / restore / inspect
- OCR offline (Tesseract.js), extraction IA optionnelle (Infomaniak / Ollama)
- Dark mode, FR/EN, idle lock, rate-limit anti-bruteforce, notifications natives

### Partiel / à étendre

- **Double moteur récurrent** : `subscriptions` (historique) et `engagements` coexistent ; consolidation à arbitrer
- **Trois écrans de synthèse** (Ce mois / Finances / Dashboard) au périmètre recouvrant — clarification prévue
- **Extension de garantie via carte** : `extended_warranty_months` existe mais pas de calcul auto
- **Classification bancaire** : table de marchands suisse en dur dans `classify.rs`, à rendre extensible
- **Conversion de change** : pas de table de taux — les devises étrangères sont affichées séparément, jamais converties

### Pistes futures

- Sync chiffrée optionnelle (E2E, multi-device)
- Table de taux FX configurable pour des totaux consolidés
- Tableaux de bord analytiques enrichis

---

_Toutes les contributions, issues et retours sont les bienvenus tant que le projet est en alpha._
