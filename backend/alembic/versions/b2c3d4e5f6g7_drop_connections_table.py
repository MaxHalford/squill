"""drop connections table

Revision ID: b2c3d4e5f6g7
Revises: a1b2c3d4e5f6
Create Date: 2026-01-13 14:00:00.000000

Connections are now derived from BigQueryConnection and PostgresConnection tables.
No separate connections table needed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6g7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop connections table if it exists."""
    # Use raw SQL to conditionally drop the table
    op.execute("DROP TABLE IF EXISTS connections")


def downgrade() -> None:
    """Recreate connections table (not needed, but here for completeness)."""
    pass
