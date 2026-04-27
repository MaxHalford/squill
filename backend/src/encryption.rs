use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, AeadCore, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

/// AES-256-GCM encryption, interoperable with the Python backend.
///
/// Python uses `cryptography.hazmat.primitives.ciphers.aead.AESGCM`
/// with no AAD (associated data = None), 12-byte random IV.
pub struct TokenEncryption {
    cipher: Aes256Gcm,
}

impl TokenEncryption {
    /// Create from a base64-encoded 32-byte key (same format as Python).
    pub fn new(key_base64: &str) -> Result<Self, String> {
        // Handle URL-safe base64 with potentially missing padding (same as Python)
        let padded = match key_base64.len() % 4 {
            2 => format!("{key_base64}=="),
            3 => format!("{key_base64}="),
            _ => key_base64.to_string(),
        };
        let key_bytes = URL_SAFE_NO_PAD
            .decode(padded.trim_end_matches('='))
            .or_else(|_| {
                base64::engine::general_purpose::STANDARD.decode(key_base64)
            })
            .map_err(|e| format!("Invalid base64 key: {e}"))?;

        if key_bytes.len() != 32 {
            return Err(format!(
                "Key must be 32 bytes, got {}",
                key_bytes.len()
            ));
        }

        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .map_err(|e| format!("Invalid AES key: {e}"))?;

        Ok(Self { cipher })
    }

    /// Encrypt plaintext, returning (ciphertext, 12-byte iv).
    pub fn encrypt(&self, plaintext: &str) -> Result<(Vec<u8>, Vec<u8>), String> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = self
            .cipher
            .encrypt(&nonce, plaintext.as_bytes())
            .map_err(|e| format!("Encryption failed: {e}"))?;
        Ok((ciphertext, nonce.to_vec()))
    }

    /// Decrypt ciphertext with the given IV.
    pub fn decrypt(&self, ciphertext: &[u8], iv: &[u8]) -> Result<String, String> {
        let nonce = Nonce::from_slice(iv);
        let plaintext = self
            .cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {e}"))?;
        String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8: {e}"))
    }
}
