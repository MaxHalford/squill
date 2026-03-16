import logging

import httpx

logger = logging.getLogger(__name__)


class MicrosoftOAuthService:
    TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    USER_URL = "https://graph.microsoft.com/v1.0/me"

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
                    "grant_type": "authorization_code",
                },
                headers={"Accept": "application/json"},
            )
            if not response.is_success:
                logger.error(
                    f"Microsoft token exchange failed: status={response.status_code}, "
                    f"response={response.text}"
                )
            response.raise_for_status()
            return response.json()

    async def get_user_info(self, access_token: str) -> dict:
        """Fetch user info from Microsoft Graph.

        Returns a dict with email, first_name, and last_name.
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.USER_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
            )
            response.raise_for_status()

        data = response.json()
        return {
            "email": data.get("mail") or data.get("userPrincipalName"),
            "first_name": data.get("givenName"),
            "last_name": data.get("surname"),
        }
