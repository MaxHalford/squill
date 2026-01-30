"""Rename paddle columns to polar

Revision ID: d4e5f6g7h8i9
Revises: c3d4e5f6g7h8
Create Date: 2024-01-30 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e5f6g7h8i9"
down_revision: Union[str, None] = "c3d4e5f6g7h8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename paddle columns to polar in users table
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("paddle_customer_id", new_column_name="polar_customer_id")
        batch_op.alter_column(
            "paddle_subscription_id", new_column_name="polar_subscription_id"
        )


def downgrade() -> None:
    # Rename polar columns back to paddle in users table
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("polar_customer_id", new_column_name="paddle_customer_id")
        batch_op.alter_column(
            "polar_subscription_id", new_column_name="paddle_subscription_id"
        )
