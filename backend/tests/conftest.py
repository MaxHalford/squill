"""Pytest configuration and fixtures for backend tests.

This file patches get_settings BEFORE any other test imports happen,
so that main.py and other modules get mock settings.
"""

from unittest.mock import patch

import config


class MockSettings:
    """Mock settings for testing without environment variables."""

    database_url = "sqlite+aiosqlite:///./test.db"
    google_client_id = "test-client-id"
    google_client_secret = "test-client-secret"
    token_encryption_key = "dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcyE="  # 32 bytes base64
    jwt_secret = "test-jwt-secret-that-is-at-least-32-bytes-long"
    jwt_expiration_days = 30
    openai_api_key = "test-openai-key"
    polar_access_token = "test-polar-token"
    polar_webhook_secret = "test-webhook-secret"
    polar_product_id = "test-product-id"
    polar_server = "sandbox"
    frontend_url = "http://localhost:5173"
    cors_origins = [
        "http://localhost:5173",
        "https://squill.dev",
    ]
    vip_emails = {"test@example.com"}


# Patch get_settings at module level BEFORE any test files import main.py
# This must happen before pytest collects test files
_mock_settings = MockSettings()
_patcher = patch("config.get_settings", return_value=_mock_settings)
_patcher.start()

if hasattr(config.get_settings, "cache_clear"):
    # get_settings is wrapped, we need to clear the real function's cache
    pass  # The patch replaces the function entirely, so cache doesn't matter
