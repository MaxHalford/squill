import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class TokenEncryption:
    def __init__(self, key_base64: str):
        # Handle URL-safe base64 (from secrets.token_urlsafe) with potentially missing padding
        key_base64_padded = key_base64 + "=" * (-len(key_base64) % 4)
        self.key = base64.urlsafe_b64decode(key_base64_padded)
        self.aesgcm = AESGCM(self.key)

    def encrypt(self, plaintext: str) -> tuple[bytes, bytes]:
        """Encrypt plaintext and return (ciphertext, iv)."""
        iv = os.urandom(12)
        ciphertext = self.aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
        return ciphertext, iv

    def decrypt(self, ciphertext: bytes, iv: bytes) -> str:
        """Decrypt ciphertext and return plaintext."""
        plaintext = self.aesgcm.decrypt(iv, ciphertext, None)
        return plaintext.decode("utf-8")
