from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str

    # Google OAuth
    google_client_id: str
    google_client_secret: str

    # Encryption key for refresh tokens (32-byte base64-encoded)
    token_encryption_key: str

    # JWT
    jwt_secret: str
    jwt_expiration_days: int = 30

    # OpenAI
    openai_api_key: str

    # Polar
    polar_access_token: str
    polar_webhook_secret: str
    polar_product_id: str  # Product/price ID for Pro subscription
    polar_server: str = "sandbox"  # "sandbox" or "production"
    frontend_url: str  # For redirect URLs

    # CORS
    cors_origins: list[str] = [
        "https://www.squill.dev",
        "https://squill.dev",
        "http://localhost:5173",
    ]

    # VIP emails (always treated as VIP regardless of database value)
    vip_emails: set[str] = {"maxhalford25@gmail.com"}

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()  # type: ignore[call-arg]  # pydantic-settings reads from env
