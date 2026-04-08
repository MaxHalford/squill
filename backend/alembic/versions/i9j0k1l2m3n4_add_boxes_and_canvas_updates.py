"""add boxes table, canvas version/next_box_id, canvas_shares email

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-04-08 10:00:00.000000

Server-first canvas state: structured box storage via JSONB per-row,
optimistic concurrency version on canvas, email-restricted sharing.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "i9j0k1l2m3n4"
down_revision: Union[str, None] = "h8i9j0k1l2m3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add next_box_id and version columns to canvases
    op.add_column(
        "canvases",
        sa.Column("next_box_id", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "canvases",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )

    # Create boxes table with JSONB state
    op.create_table(
        "boxes",
        sa.Column("canvas_id", sa.String(length=36), nullable=False),
        sa.Column("box_id", sa.Integer(), nullable=False),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["canvas_id"], ["canvases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("canvas_id", "box_id"),
    )

    # Add optional email column to canvas_shares for email-restricted sharing
    op.add_column(
        "canvas_shares",
        sa.Column("email", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("canvas_shares", "email")
    op.drop_table("boxes")
    op.drop_column("canvases", "version")
    op.drop_column("canvases", "next_box_id")
