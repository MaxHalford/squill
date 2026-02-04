"""Tests for Snowflake utility functions."""

import pytest

# Import the function directly from the module
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from routers.snowflake import quote_identifier


class TestQuoteIdentifier:
    """Tests for SQL injection prevention in Snowflake identifier quoting."""

    def test_quotes_simple_identifier(self):
        """Should wrap identifier in double quotes."""
        result = quote_identifier("table_name")
        assert result == '"table_name"'

    def test_quotes_identifier_with_spaces(self):
        """Should handle identifiers with spaces."""
        result = quote_identifier("my table")
        assert result == '"my table"'

    def test_escapes_embedded_double_quotes(self):
        """Should escape embedded double quotes by doubling them."""
        result = quote_identifier('table"name')
        assert result == '"table""name"'

    def test_escapes_multiple_embedded_quotes(self):
        """Should escape multiple embedded double quotes."""
        result = quote_identifier('a"b"c')
        assert result == '"a""b""c"'

    def test_empty_identifier_raises_error(self):
        """Should reject empty identifiers."""
        with pytest.raises(ValueError) as exc_info:
            quote_identifier("")
        assert "Invalid identifier" in str(exc_info.value)

    def test_none_identifier_raises_error(self):
        """Should reject None identifiers."""
        with pytest.raises(ValueError):
            quote_identifier(None)  # type: ignore

    def test_too_long_identifier_raises_error(self):
        """Should reject identifiers over 255 characters."""
        long_identifier = "a" * 256
        with pytest.raises(ValueError) as exc_info:
            quote_identifier(long_identifier)
        assert "Invalid identifier" in str(exc_info.value)

    def test_max_length_identifier_accepted(self):
        """Should accept identifiers exactly 255 characters."""
        max_identifier = "a" * 255
        result = quote_identifier(max_identifier)
        assert result == f'"{max_identifier}"'

    def test_sql_injection_attempt_neutralized(self):
        """SQL injection attempts should be safely quoted."""
        # Attempt to break out of quotes
        malicious = 'table"; DROP TABLE users; --'
        result = quote_identifier(malicious)
        # The quotes are escaped, so the injection is neutralized
        assert result == '"table""; DROP TABLE users; --"'

    def test_unicode_identifier(self):
        """Should handle unicode characters."""
        result = quote_identifier("таблица")
        assert result == '"таблица"'

    def test_identifier_with_newlines(self):
        """Should handle identifiers with newlines."""
        result = quote_identifier("table\nname")
        assert result == '"table\nname"'
