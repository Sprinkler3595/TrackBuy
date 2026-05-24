use argon2::{password_hash::SaltString, Algorithm, Argon2, Params, PasswordHasher, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Key, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::Zeroizing;

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),
    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),
    #[error("Key derivation failed: {0}")]
    KeyDerivationFailed(String),
}

/// Persistable Argon2id parameters. Stored per-vault so that future tuning
/// (or downgrades) can happen without breaking unlock for existing vaults.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Argon2Params {
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub p_cost: u32,
    pub version: u32,
}

impl Default for Argon2Params {
    /// Current recommended baseline (~500ms on a modern desktop).
    /// Stronger than OWASP minimum (19 MiB / t=2 / p=1).
    fn default() -> Self {
        Self {
            m_cost_kib: 65_536, // 64 MiB
            t_cost: 3,
            p_cost: 4,
            version: 0x13, // Argon2 v1.3
        }
    }
}

/// Derive a 256-bit key from a password using Argon2id with explicit parameters.
///
/// The returned key is wrapped in `Zeroizing` so that it is wiped from memory
/// when dropped, mitigating disclosure via memory dumps or swap.
pub fn derive_key(
    password: &str,
    salt: &[u8; 16],
    params: &Argon2Params,
) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let salt_string = SaltString::encode_b64(salt)
        .map_err(|e| CryptoError::KeyDerivationFailed(e.to_string()))?;

    let argon_version = match params.version {
        0x10 => Version::V0x10,
        0x13 => Version::V0x13,
        v => {
            return Err(CryptoError::KeyDerivationFailed(format!(
                "Version Argon2 inconnue: {:#x}",
                v
            )))
        }
    };

    let argon_params = Params::new(params.m_cost_kib, params.t_cost, params.p_cost, Some(32))
        .map_err(|e| CryptoError::KeyDerivationFailed(e.to_string()))?;
    let argon = Argon2::new(Algorithm::Argon2id, argon_version, argon_params);

    let hash = argon
        .hash_password(password.as_bytes(), &salt_string)
        .map_err(|e| CryptoError::KeyDerivationFailed(e.to_string()))?;
    let hash_output = hash
        .hash
        .ok_or_else(|| CryptoError::KeyDerivationFailed("No hash output".to_string()))?;
    let bytes = hash_output.as_bytes();
    if bytes.len() < 32 {
        return Err(CryptoError::KeyDerivationFailed(
            "Hash trop court".to_string(),
        ));
    }
    let mut key = Zeroizing::new([0u8; 32]);
    key.copy_from_slice(&bytes[..32]);
    Ok(key)
}

/// Generate a random 16-byte salt
pub fn generate_salt() -> [u8; 16] {
    let mut salt = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    salt
}

/// Encrypt data using ChaCha20-Poly1305
pub fn encrypt_data(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

/// Decrypt data using ChaCha20-Poly1305
pub fn decrypt_data(key: &[u8; 32], encrypted: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if encrypted.len() < 12 {
        return Err(CryptoError::DecryptionFailed("Data too short".to_string()));
    }
    let (nonce_bytes, ciphertext) = encrypted.split_at(12);
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
}
