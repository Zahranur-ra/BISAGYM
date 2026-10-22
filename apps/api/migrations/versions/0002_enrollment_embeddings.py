"""Store transient enrollment descriptors and make mock tags optional."""

import sqlalchemy as sa
from alembic import op

revision = "0002_enrollment_embeddings"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {
        column["name"]: column for column in sa.inspect(bind).get_columns("face_enrollment_samples")
    }
    if "embedding" not in columns:
        op.add_column(
            "face_enrollment_samples",
            sa.Column("embedding", sa.JSON(), nullable=True),
        )
    if not columns["sample_tag"]["nullable"]:
        with op.batch_alter_table("face_enrollment_samples") as batch_op:
            batch_op.alter_column(
                "sample_tag",
                existing_type=sa.String(length=255),
                nullable=True,
            )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {
        column["name"]: column for column in sa.inspect(bind).get_columns("face_enrollment_samples")
    }
    op.execute(sa.text("DELETE FROM face_enrollment_samples WHERE sample_tag IS NULL"))
    if columns["sample_tag"]["nullable"]:
        with op.batch_alter_table("face_enrollment_samples") as batch_op:
            batch_op.alter_column(
                "sample_tag",
                existing_type=sa.String(length=255),
                nullable=False,
            )
    if "embedding" in columns:
        with op.batch_alter_table("face_enrollment_samples") as batch_op:
            batch_op.drop_column("embedding")
