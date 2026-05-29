//! Utilitaires partagés par les tests Rust : répertoire de coffre temporaire
//! auto-nettoyé et clé de test déterministe. Compilé uniquement en `cfg(test)`,
//! donc rien de ceci n'atterrit dans le binaire de production.

use std::path::{Path, PathBuf};

use zeroize::Zeroizing;

/// Répertoire temporaire unique supprimé à la fin du test (Drop). On évite
/// d'ajouter la dépendance `tempfile` : `uuid` est déjà au projet et suffit.
pub struct TempDir {
    path: PathBuf,
}

impl TempDir {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!("trackbuy-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("création du répertoire temporaire");
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        // Nettoyage best-effort : un test qui échoue ne doit pas masquer son
        // erreur derrière une panique de suppression.
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Clé de chiffrement fixe (32 octets) pour les tests qui n'ont pas besoin de
/// passer par Argon2id. `derive_key` a ses propres tests de déterminisme.
pub fn test_key() -> Zeroizing<[u8; 32]> {
    let mut k = Zeroizing::new([0u8; 32]);
    for (i, b) in k.iter_mut().enumerate() {
        *b = (i as u8).wrapping_mul(7).wrapping_add(1);
    }
    k
}
