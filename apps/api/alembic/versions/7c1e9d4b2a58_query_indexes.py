"""Add indexes for the query patterns the application actually issues.

PostgreSQL does not index foreign-key columns automatically, and nearly every
scoped query in this application filters on one of them. SQLite tolerates the
omission at demonstration scale; a managed database does not. These indexes are
dialect-neutral, so the same migration applies to both backends.

Revision ID: 7c1e9d4b2a58
Revises: 3a343513326d
Create Date: 2026-11-02
"""
from alembic import op

revision = '7c1e9d4b2a58'
down_revision = '3a343513326d'
branch_labels = None
depends_on = None

# (index name, table, columns)
INDEXES = [
    ("ix_patients_user_id", "patients", ["user_id"]),
    ("ix_patients_service_area", "patients", ["service_area"]),
    ("ix_patients_created_by", "patients", ["created_by"]),
    ("ix_recommendations_patient", "recommendations", ["patient_id"]),
    ("ix_recommendations_status", "recommendations", ["status"]),
    ("ix_recommendations_due", "recommendations", ["due_date"]),
    ("ix_outreach_patient", "outreach_tasks", ["patient_id"]),
    ("ix_outreach_status", "outreach_tasks", ["status"]),
    ("ix_outreach_worker", "outreach_tasks", ["assigned_worker_id"]),
    ("ix_outreach_due", "outreach_tasks", ["due_date"]),
    ("ix_outreach_attempts_task", "outreach_attempts", ["task_id"]),
    ("ix_appointments_patient", "appointments", ["patient_id"]),
    ("ix_appointments_scheduled", "appointments", ["scheduled_at"]),
    ("ix_appointments_status", "appointments", ["status"]),
    ("ix_documents_patient", "documents", ["patient_id"]),
    ("ix_extracted_document", "extracted_fields", ["document_id"]),
    ("ix_extracted_review", "extracted_fields", ["requires_review"]),
    ("ix_verification_field", "verification_decisions", ["extracted_field_id"]),
    ("ix_inventory_batch_vaccine", "inventory_batches", ["vaccine_id"]),
    ("ix_inventory_batch_expiry", "inventory_batches", ["expiry_date"]),
    ("ix_inventory_batch_status", "inventory_batches", ["status"]),
    ("ix_inventory_txn_batch", "inventory_transactions", ["batch_id"]),
    ("ix_audit_user", "audit_events", ["user_id"]),
    ("ix_audit_created", "audit_events", ["created_at"]),
    ("ix_audit_entity", "audit_events", ["entity_type", "entity_id"]),
    ("ix_notifications_user", "notifications", ["user_id", "is_read"]),
    ("ix_notifications_created", "notifications", ["created_at"]),
    ("ix_caregiver_patient", "caregiver_relationships", ["patient_id"]),
    ("ix_consent_patient", "consent_records", ["patient_id"]),
    ("ix_match_candidate_patient", "record_match_candidates", ["patient_id"]),
    ("ix_match_candidate_status", "record_match_candidates", ["status"]),
    ("ix_sync_conflicts_patient", "sync_conflicts", ["patient_id"]),
    ("ix_sync_conflicts_status", "sync_conflicts", ["status"]),
    ("ix_schedule_rules_version", "schedule_rules", ["schedule_version_id"]),
    ("ix_locations_service_area", "locations", ["service_area"]),
    ("ix_user_roles_user", "user_roles", ["user_id"]),
    ("ix_users_role", "users", ["role"]),
    ("ix_vaccination_events_verified", "vaccination_events", ["is_verified"]),
    ("ix_vaccination_events_administered", "vaccination_events", ["administered_at"]),
]


def upgrade() -> None:
    for name, table, columns in INDEXES:
        op.create_index(name, table, columns, unique=False)


def downgrade() -> None:
    for name, _table, _columns in reversed(INDEXES):
        op.drop_index(name)
