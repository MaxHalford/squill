"""MCP OAuth provider — enables Notion-style browser auth for Claude Code.

Flow:
1. Claude Code connects to MCP server, gets 401
2. Discovers OAuth endpoints via /.well-known/oauth-protected-resource
3. Registers as a client via /register
4. Redirects browser to /authorize → Google OAuth
5. User logs in → Google redirects to /oauth/callback
6. Server generates auth code, redirects to Claude Code's localhost callback
7. Claude Code exchanges code for JWT via /token
"""

import logging
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from config import get_settings
from services.auth import create_session_token, verify_session_token

# The issuer URL — must match what's configured in mcp_server.py AuthSettings
ISSUER_URL = "http://localhost:8000/mcp"

logger = logging.getLogger(__name__)

# Google OAuth constants
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"


@dataclass
class PendingSession:
    """Stores authorization params while the user completes Google OAuth."""

    params: AuthorizationParams
    client_id: str
    created_at: float = field(default_factory=time.time)


@dataclass
class StoredAuthCode:
    """An authorization code with associated metadata."""

    code: AuthorizationCode
    user_id: str
    email: str


@dataclass
class StoredRefreshToken:
    """A refresh token with associated metadata."""

    token: RefreshToken
    user_id: str
    email: str


class SquillMCPAuthProvider:
    """OAuth provider for MCP that delegates authentication to Google OAuth.

    Uses in-memory storage for clients, auth codes, and tokens.
    Suitable for single-process deployment.
    """

    def __init__(self) -> None:
        self._clients: dict[str, OAuthClientInformationFull] = {}
        self._pending_sessions: dict[str, PendingSession] = {}
        self._auth_codes: dict[str, StoredAuthCode] = {}
        self._refresh_tokens: dict[str, StoredRefreshToken] = {}
        # Revoked access tokens (JWT strings)
        self._revoked_tokens: set[str] = set()

    # -- Client registration --------------------------------------------------

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        return self._clients.get(client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        client_id = client_info.client_id or ""
        self._clients[client_id] = client_info
        logger.info("MCP client registered: %s", client_info.client_id)

    # -- Authorization ---------------------------------------------------------

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        """Redirect user to Google OAuth for authentication."""
        sid = secrets.token_urlsafe(32)
        self._pending_sessions[sid] = PendingSession(
            params=params, client_id=str(client.client_id or "")
        )

        settings = get_settings()
        callback_url = f"{ISSUER_URL}/oauth/callback"

        google_params = {
            "client_id": settings.google_client_id,
            "redirect_uri": callback_url,
            "response_type": "code",
            "scope": "email profile",
            "state": sid,
            "access_type": "online",
            "prompt": "select_account",
        }
        return f"{GOOGLE_AUTH_URL}?{urlencode(google_params)}"

    # -- Authorization code exchange -------------------------------------------

    async def load_authorization_code(
        self,
        client: OAuthClientInformationFull,
        authorization_code: str,
    ) -> AuthorizationCode | None:
        stored = self._auth_codes.get(authorization_code)
        if not stored:
            return None
        if stored.code.client_id != client.client_id:
            return None
        return stored.code

    async def exchange_authorization_code(
        self,
        client: OAuthClientInformationFull,
        authorization_code: AuthorizationCode,
    ) -> OAuthToken:
        stored = self._auth_codes.pop(authorization_code.code, None)
        if not stored:
            raise ValueError("Invalid authorization code")

        # Create a JWT (same as the web app uses)
        access_token = create_session_token(stored.user_id, stored.email)

        # Create a refresh token
        refresh_token_str = secrets.token_urlsafe(48)
        self._refresh_tokens[refresh_token_str] = StoredRefreshToken(
            token=RefreshToken(
                token=refresh_token_str,
                client_id=str(client.client_id or ""),
                scopes=list(authorization_code.scopes or []),
            ),
            user_id=stored.user_id,
            email=stored.email,
        )

        return OAuthToken(
            access_token=access_token,
            token_type="Bearer",
            expires_in=get_settings().jwt_expiration_days * 86400,
            scope=" ".join(authorization_code.scopes),
            refresh_token=refresh_token_str,
        )

    # -- Refresh token ---------------------------------------------------------

    async def load_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: str,
    ) -> RefreshToken | None:
        stored = self._refresh_tokens.get(refresh_token)
        if not stored:
            return None
        if stored.token.client_id != client.client_id:
            return None
        return stored.token

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        stored = self._refresh_tokens.get(refresh_token.token)
        if not stored:
            raise ValueError("Invalid refresh token")

        # Issue new access token
        access_token = create_session_token(stored.user_id, stored.email)

        # Rotate refresh token
        new_refresh = secrets.token_urlsafe(48)
        del self._refresh_tokens[refresh_token.token]
        self._refresh_tokens[new_refresh] = StoredRefreshToken(
            token=RefreshToken(
                token=new_refresh,
                client_id=str(client.client_id or ""),
                scopes=list(scopes or refresh_token.scopes or []),
            ),
            user_id=stored.user_id,
            email=stored.email,
        )

        return OAuthToken(
            access_token=access_token,
            token_type="Bearer",
            expires_in=get_settings().jwt_expiration_days * 86400,
            scope=" ".join(scopes or refresh_token.scopes),
            refresh_token=new_refresh,
        )

    # -- Access token verification ---------------------------------------------

    async def load_access_token(self, token: str) -> AccessToken | None:
        if token in self._revoked_tokens:
            return None
        try:
            payload = verify_session_token(token)
            # Store user_id in client_id field for tools to access
            return AccessToken(
                token=token,
                client_id=payload.user_id,
                scopes=["mcp"],
                expires_at=int(payload.exp.timestamp()),
            )
        except Exception:
            return None

    # -- Token revocation ------------------------------------------------------

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        if isinstance(token, AccessToken):
            self._revoked_tokens.add(token.token)
        elif isinstance(token, RefreshToken):
            self._refresh_tokens.pop(token.token, None)

    # -- Helpers for the callback route ----------------------------------------

    def get_pending_session(self, sid: str) -> PendingSession | None:
        """Retrieve and remove a pending auth session."""
        return self._pending_sessions.pop(sid, None)

    def store_auth_code(
        self,
        code_str: str,
        session: PendingSession,
        user_id: str,
        email: str,
    ) -> None:
        """Store an authorization code after successful Google OAuth."""
        self._auth_codes[code_str] = StoredAuthCode(
            code=AuthorizationCode(
                code=code_str,
                client_id=session.client_id,
                redirect_uri=session.params.redirect_uri,
                redirect_uri_provided_explicitly=True,
                scopes=session.params.scopes or ["mcp"],
                code_challenge=session.params.code_challenge,
                expires_at=(
                    datetime.now(timezone.utc) + timedelta(minutes=10)
                ).timestamp(),
            ),
            user_id=user_id,
            email=email,
        )

    def cleanup_expired(self) -> None:
        """Remove expired pending sessions and auth codes."""
        now = time.time()
        # Pending sessions older than 10 minutes
        expired_sids = [
            sid for sid, s in self._pending_sessions.items() if now - s.created_at > 600
        ]
        for sid in expired_sids:
            del self._pending_sessions[sid]
        # Expired auth codes
        expired_codes = [
            code
            for code, stored in self._auth_codes.items()
            if stored.code.expires_at and now > stored.code.expires_at
        ]
        for code in expired_codes:
            del self._auth_codes[code]
