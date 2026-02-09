import logging

import httpx

logger = logging.getLogger(__name__)


class GitHubOAuthService:
    TOKEN_URL = "https://github.com/login/oauth/access_token"
    EMAILS_URL = "https://api.github.com/user/emails"

    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret

    async def exchange_code(self, code: str, redirect_uri: str) -> dict:
        """Exchange authorization code for access token."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.TOKEN_URL,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
                headers={"Accept": "application/json"},
            )
            if not response.is_success:
                logger.error(
                    f"GitHub token exchange failed: status={response.status_code}, "
                    f"response={response.text}"
                )
            response.raise_for_status()
            return response.json()

    async def get_primary_email(self, access_token: str) -> str | None:
        """Fetch the user's primary verified email from GitHub.

        Returns the primary verified email, or the first verified email
        if no primary is set. Returns None if no verified email found.
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.EMAILS_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
            )
            response.raise_for_status()

        emails = response.json()
        verified = [e for e in emails if e.get("verified")]
        if not verified:
            return None

        # Prefer the primary email
        for entry in verified:
            if entry.get("primary"):
                return entry["email"]

        return verified[0]["email"]
