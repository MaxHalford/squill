"""add vip column

Revision ID: a1b2c3d4e5f6
Revises: 5714a78b95b0
Create Date: 2026-01-12 22:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "5714a78b95b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add is_vip column to users table."""
    op.add_column(
        "users",
        sa.Column(
            "is_vip", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )

    # Set VIP status for specific users
    op.execute("UPDATE users SET is_vip = true WHERE email = 'maxhalford25@gmail.com'")


def downgrade() -> None:
    """Remove is_vip column from users table."""
    op.drop_column("users", "is_vip")
