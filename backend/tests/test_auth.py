"""Tests for JWT authentication functions."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import jwt
import pytest
from fastapi import HTTPException

from services.auth import JWT_ALGORITHM, create_session_token, verify_session_token


class MockSettings:
    jwt_secret = "test-secret-key-for-testing-only-must-be-at-least-32-bytes"
    jwt_expiration_days = 30


@pytest.fixture(autouse=True)
def mock_settings():
    """Mock settings for all tests in this module."""
    with patch("services.auth.settings", MockSettings()):
        yield


class TestCreateSessionToken:
    def test_creates_valid_jwt(self):
        """Should create a decodable JWT token."""
        token = create_session_token("user-123", "test@example.com")

        payload = jwt.decode(token, MockSettings.jwt_secret, algorithms=[JWT_ALGORITHM])

        assert payload["user_id"] == "user-123"
        assert payload["email"] == "test@example.com"
        assert "exp" in payload

    def test_token_expires_in_configured_days(self):
        """Token expiration should match jwt_expiration_days setting."""
        before = datetime.now(timezone.utc)
        token = create_session_token("user-123", "test@example.com")
        after = datetime.now(timezone.utc)

        payload = jwt.decode(token, MockSettings.jwt_secret, algorithms=[JWT_ALGORITHM])
        exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)

        # JWT exp is truncated to seconds, so allow 1 second tolerance
        expected_min = (
            before
            + timedelta(days=MockSettings.jwt_expiration_days)
            - timedelta(seconds=1)
        )
        expected_max = (
            after
            + timedelta(days=MockSettings.jwt_expiration_days)
            + timedelta(seconds=1)
        )

        assert expected_min <= exp <= expected_max


class TestVerifySessionToken:
    def test_decodes_valid_token(self):
        """Should decode a valid token and return TokenPayload."""
        token = create_session_token("user-456", "user@test.com")

        payload = verify_session_token(token)

        assert payload.user_id == "user-456"
        assert payload.email == "user@test.com"
        assert payload.exp > datetime.now(timezone.utc)

    def test_expired_token_raises_401(self):
        """Should raise HTTPException 401 for expired tokens."""
        # Create an already-expired token
        expiration = datetime.now(timezone.utc) - timedelta(hours=1)
        payload = {
            "user_id": "user-123",
            "email": "test@example.com",
            "exp": expiration,
        }
        expired_token = jwt.encode(
            payload, MockSettings.jwt_secret, algorithm=JWT_ALGORITHM
        )

        with pytest.raises(HTTPException) as exc_info:
            verify_session_token(expired_token)

        assert exc_info.value.status_code == 401
        assert "expired" in exc_info.value.detail.lower()

    def test_invalid_token_raises_401(self):
        """Should raise HTTPException 401 for invalid tokens."""
        with pytest.raises(HTTPException) as exc_info:
            verify_session_token("not-a-valid-jwt-token")

        assert exc_info.value.status_code == 401
        assert "invalid" in exc_info.value.detail.lower()

    def test_wrong_secret_raises_401(self):
        """Should raise HTTPException 401 for tokens signed with wrong secret."""
        payload = {
            "user_id": "user-123",
            "email": "test@example.com",
            "exp": datetime.now(timezone.utc) + timedelta(days=1),
        }
        token = jwt.encode(
            payload,
            "wrong-secret-that-is-at-least-32-bytes-long",
            algorithm=JWT_ALGORITHM,
        )

        with pytest.raises(HTTPException) as exc_info:
            verify_session_token(token)

        assert exc_info.value.status_code == 401

    def test_missing_claims_raises_error(self):
        """Should raise error for tokens missing required claims."""
        payload = {"exp": datetime.now(timezone.utc) + timedelta(days=1)}
        token = jwt.encode(payload, MockSettings.jwt_secret, algorithm=JWT_ALGORITHM)

        with pytest.raises((HTTPException, KeyError)):
            verify_session_token(token)
