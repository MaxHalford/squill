"""Tests for TokenEncryption service."""

import base64
import secrets

import pytest

from services.encryption import TokenEncryption


@pytest.fixture
def encryption_key() -> str:
    """Generate a valid 32-byte base64-encoded key."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()


@pytest.fixture
def encryption(encryption_key: str) -> TokenEncryption:
    """Create a TokenEncryption instance with a test key."""
    return TokenEncryption(encryption_key)


class TestTokenEncryption:
    def test_encrypt_returns_ciphertext_and_iv(self, encryption: TokenEncryption):
        """Encrypt should return a tuple of (ciphertext, iv)."""
        ciphertext, iv = encryption.encrypt("test plaintext")

        assert isinstance(ciphertext, bytes)
        assert isinstance(iv, bytes)
        assert len(iv) == 12  # AES-GCM uses 12-byte IV

    def test_decrypt_recovers_original_plaintext(self, encryption: TokenEncryption):
        """Decrypt should recover the original plaintext."""
        plaintext = "my secret refresh token"
        ciphertext, iv = encryption.encrypt(plaintext)

        decrypted = encryption.decrypt(ciphertext, iv)

        assert decrypted == plaintext

    def test_round_trip_with_unicode(self, encryption: TokenEncryption):
        """Should handle unicode characters correctly."""
        plaintext = "token with émojis 🔐 and ñ"
        ciphertext, iv = encryption.encrypt(plaintext)

        decrypted = encryption.decrypt(ciphertext, iv)

        assert decrypted == plaintext

    def test_round_trip_with_long_token(self, encryption: TokenEncryption):
        """Should handle long tokens (like OAuth refresh tokens)."""
        plaintext = "a" * 2048  # Long token
        ciphertext, iv = encryption.encrypt(plaintext)

        decrypted = encryption.decrypt(ciphertext, iv)

        assert decrypted == plaintext

    def test_different_encryptions_produce_different_ciphertext(
        self, encryption: TokenEncryption
    ):
        """Each encryption should use a unique IV, producing different ciphertext."""
        plaintext = "same plaintext"

        ciphertext1, iv1 = encryption.encrypt(plaintext)
        ciphertext2, iv2 = encryption.encrypt(plaintext)

        assert iv1 != iv2
        assert ciphertext1 != ciphertext2

    def test_decrypt_with_wrong_iv_fails(self, encryption: TokenEncryption):
        """Decryption with wrong IV should fail."""
        plaintext = "test"
        ciphertext, _iv = encryption.encrypt(plaintext)
        wrong_iv = b"\x00" * 12

        with pytest.raises(Exception):  # InvalidTag from cryptography
            encryption.decrypt(ciphertext, wrong_iv)

    def test_decrypt_with_corrupted_ciphertext_fails(self, encryption: TokenEncryption):
        """Decryption with corrupted ciphertext should fail."""
        plaintext = "test"
        ciphertext, iv = encryption.encrypt(plaintext)
        corrupted = bytes([ciphertext[0] ^ 0xFF]) + ciphertext[1:]

        with pytest.raises(Exception):  # InvalidTag from cryptography
            encryption.decrypt(corrupted, iv)

    def test_handles_urlsafe_base64_key_without_padding(self):
        """Should handle URL-safe base64 keys without padding."""
        # secrets.token_urlsafe(32) produces keys without padding
        key_no_padding = secrets.token_urlsafe(32)
        encryption = TokenEncryption(key_no_padding)

        plaintext = "test"
        ciphertext, iv = encryption.encrypt(plaintext)
        decrypted = encryption.decrypt(ciphertext, iv)

        assert decrypted == plaintext
