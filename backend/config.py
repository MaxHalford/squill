from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str

    # Google OAuth
    google_client_id: str
    google_client_secret: str

    # Encryption key for refresh tokens (32-byte base64-encoded)
    token_encryption_key: str

    # OpenAI
    openai_api_key: str

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
