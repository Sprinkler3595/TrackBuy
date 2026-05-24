# TrackBuyV2

Suivi d'achats personnel avec chiffrement de bout en bout.

## Stack

- **App**: Tauri v2 (Rust) - Desktop cross-platform
- **Frontend**: React 19 + TypeScript + Vite
- **UI**: shadcn/ui + Tailwind CSS 4
- **Base de donnees**: SQLCipher (SQLite chiffre AES-256)
- **Chiffrement fichiers**: ChaCha20-Poly1305
- **Derivation cle**: Argon2id

## Fonctionnalites

- Suivi des achats (prix, date, marchand, lieu)
- Gestion des garanties avec alertes d'expiration
- Pieces jointes chiffrees sur disque
- Multi-coffres (vaults) isoles
- Recherche full-text (FTS5)
- Dark mode
- Interface francais/anglais

## Developpement

```bash
# Prerequis: Node.js 22+, Rust 1.94+, dependances systeme Tauri

# Installation
npm install

# Donnees Tesseract (OCR) - une seule fois, telecharge ~14 MB et verifie les hashes
npm run fetch-tessdata

# Dev (frontend seulement)
npm run dev

# Dev (Tauri complet)
cargo tauri dev

# Build
cargo tauri build
```

## Securite

Toutes les donnees sont chiffrees localement:
- Base de donnees: SQLCipher AES-256 (chiffrement at-rest et en session, aucun fichier en clair sur disque)
- Pieces jointes: ChaCha20-Poly1305 (chaque fichier chiffre individuellement avec nonce aleatoire)
- Cle derivee du mot de passe maitre via Argon2id
- Backups: archive ZIP (`.tbvbak`) contenant les fichiers deja chiffres, restaurable uniquement avec le mot de passe maitre
- CSP stricte et permissions Tauri scopees (pas d'acces FS direct depuis le front)

## Format de backup

Un backup est un fichier `.tbvbak` (ZIP) contenant:
- `vault.db` (base SQLCipher chiffree)
- `salt.bin` (sel Argon2id, requis pour deriver la cle a la restauration)
- `files/*.enc` (pieces jointes chiffrees ChaCha20-Poly1305)
- `manifest.json` (metadonnees: format, version, date)

Tous les contenus restent chiffres en transit et au repos.
