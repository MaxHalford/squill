"""Tests for CORS configuration."""

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


class TestCORS:
    """Tests to ensure CORS is properly configured."""

    def test_options_preflight_returns_200(self, client: TestClient):
        """OPTIONS preflight requests should return 200, not 405."""
        response = client.options(
            "/",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        # Should not be 405 Method Not Allowed
        assert response.status_code == 200

    def test_cors_headers_present(self, client: TestClient):
        """CORS headers should be present in responses."""
        response = client.options(
            "/",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert "access-control-allow-origin" in response.headers
        assert "access-control-allow-methods" in response.headers

    def test_allowed_origin_is_reflected(self, client: TestClient):
        """Allowed origins should be reflected in the response."""
        response = client.options(
            "/",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert (
            response.headers["access-control-allow-origin"] == "http://localhost:5173"
        )

    def test_cors_on_actual_request(self, client: TestClient):
        """CORS headers should also be present on actual requests."""
        response = client.get(
            "/",
            headers={"Origin": "http://localhost:5173"},
        )
        assert response.status_code == 200
        assert "access-control-allow-origin" in response.headers
