"""SQLAlchemy models for VAXBRIDGE AI.

All identifiers are stable UUIDs stored as strings so the schema is portable
between PostgreSQL (native UUID) and SQLite (demo). Timestamps are stored
consistently as DateTime.
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, DateTime, ForeignKey, Text, Integer,
    Boolean, Numeric, UniqueConstraint, Index,
)
from sqlalchemy.orm import relationship
from .database import Base


def guid() -> str:
    return str(uuid.uuid4())


def now() -> datetime:
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=guid)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="patient")
    phone = Column(String(50))
    language = Column(String(10), default="en")
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)

    patient_profile = relationship("Patient", back_populates="user", uselist=False, foreign_keys="Patient.user_id")
    caregiver_relationships = relationship("CaregiverRelationship", back_populates="caregiver", foreign_keys="CaregiverRelationship.caregiver_user_id")
    audit_events = relationship("AuditEvent", back_populates="user")
    inventory_transactions = relationship("InventoryTransaction", back_populates="recorded_by_user")
    outreach_attempts = relationship("OutreachAttempt", back_populates="worker_user")
    outreach_tasks = relationship("OutreachTask", back_populates="assigned_worker_user")


class Role(Base):
    __tablename__ = "roles"

    id = Column(String(36), primary_key=True, default=guid)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(Text)
    created_at = Column(DateTime, default=now)


class UserRole(Base):
    __tablename__ = "user_roles"

    id = Column(String(36), primary_key=True, default=guid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role_id = Column(String(36), ForeignKey("roles.id", ondelete="CASCADE"), nullable=False)
    assigned_at = Column(DateTime, default=now)

    user = relationship("User")
    role = relationship("Role")

    __table_args__ = (UniqueConstraint("user_id", "role_id", name="uq_user_role"),)


class Patient(Base):
    __tablename__ = "patients"

    id = Column(String(36), primary_key=True, default=guid)
    patient_id = Column(String(50), unique=True, index=True, nullable=False)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    date_of_birth = Column(DateTime, nullable=False)
    gender = Column(String(20))
    phone = Column(String(50))
    address = Column(Text)
    service_area = Column(String(100))
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)

    user = relationship("User", back_populates="patient_profile", foreign_keys=[user_id])
    creator = relationship("User", foreign_keys=[created_by])
    vaccination_events = relationship("VaccinationEvent", back_populates="patient", cascade="all, delete-orphan")
    recommendations = relationship("Recommendation", back_populates="patient", cascade="all, delete-orphan")
    outreach_tasks = relationship("OutreachTask", back_populates="patient", cascade="all, delete-orphan")
    appointments = relationship("Appointment", back_populates="patient", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="patient", cascade="all, delete-orphan")
    caregiver_links = relationship("CaregiverRelationship", back_populates="patient", foreign_keys="CaregiverRelationship.patient_id", cascade="all, delete-orphan")


class CaregiverRelationship(Base):
    __tablename__ = "caregiver_relationships"

    id = Column(String(36), primary_key=True, default=guid)
    caregiver_user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    patient_id = Column(String(36), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False)
    relationship_type = Column(String(50), default="parent")
    authorized = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now)

    caregiver = relationship("User", back_populates="caregiver_relationships", foreign_keys=[caregiver_user_id])
    patient = relationship("Patient", back_populates="caregiver_links", foreign_keys=[patient_id])

    __table_args__ = (UniqueConstraint("caregiver_user_id", "patient_id", name="uq_caregiver_patient"),)


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(String(36), primary_key=True, default=guid)
    name = Column(String(255), nullable=False)
    type = Column(String(50))
    address = Column(Text)
    phone = Column(String(50))
    created_at = Column(DateTime, default=now)


class Location(Base):
    __tablename__ = "locations"

    id = Column(String(36), primary_key=True, default=guid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    address = Column(Text)
    service_area = Column(String(100))
    latitude = Column(Numeric(9, 6))
    longitude = Column(Numeric(9, 6))
    created_at = Column(DateTime, default=now)


class Vaccine(Base):
    __tablename__ = "vaccines"

    id = Column(String(36), primary_key=True, default=guid)
    code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    created_at = Column(DateTime, default=now)


class ScheduleVersion(Base):
    __tablename__ = "schedule_versions"

    id = Column(String(36), primary_key=True, default=guid)
    source_name = Column(String(255), nullable=False)
    source_version = Column(String(100), nullable=False)
    effective_date = Column(DateTime, nullable=False)
    applicable_population = Column(String(255))
    approval_status = Column(String(50), default="draft")
    is_active = Column(Boolean, default=False)
    description = Column(Text)
    created_at = Column(DateTime, default=now)


class ScheduleRule(Base):
    __tablename__ = "schedule_rules"

    id = Column(String(36), primary_key=True, default=guid)
    schedule_version_id = Column(String(36), ForeignKey("schedule_versions.id", ondelete="CASCADE"), nullable=False)
    rule_id = Column(String(100), nullable=False)
    vaccine_code = Column(String(50), ForeignKey("vaccines.code", ondelete="SET NULL"), nullable=False)
    dose_number = Column(Integer, nullable=False)
    target_age_min_months = Column(Integer, nullable=False)
    target_age_max_months = Column(Integer, nullable=True)
    recommended_window_min_days = Column(Integer, default=0)
    recommended_window_max_days = Column(Integer, default=28)
    required_fields = Column(Text)
    validation_tests = Column(Text)
    is_required = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now)

    schedule_version = relationship("ScheduleVersion")
    vaccine = relationship("Vaccine")


class VaccinationEvent(Base):
    __tablename__ = "vaccination_events"

    id = Column(String(36), primary_key=True, default=guid)
    patient_id = Column(String(36), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False)
    vaccine_code = Column(String(50), ForeignKey("vaccines.code", ondelete="SET NULL"), nullable=False)
    vaccine_name = Column(String(255), nullable=False)
    dose_label = Column(String(50), nullable=False)
    administered_at = Column(DateTime, nullable=False)
    facility = Column(String(255))
    batch_number = Column(String(100))
    source_record_id = Column(String(100))
    is_verified = Column(Boolean, default=False)
    verified_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    source = Column(String(50), default="manual")  # manual, ocr, record, offline_sync
    source_document_id = Column(String(36), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    # Client-generated stable identifier. Makes retried offline submissions
    # idempotent: the same client_event_id can never create two records.
    client_event_id = Column(String(64), unique=True, index=True, nullable=True)
    recorded_at = Column(DateTime, nullable=True)  # when the worker captured it offline
    sync_status = Column(String(30), default="synchronized")  # synchronized, conflict
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)

    patient = relationship("Patient", back_populates="vaccination_events")
    source_document = relationship("Document", foreign_keys=[source_document_id])

    __table_args__ = (
        Index("ix_vaccination_events_patient_vaccine", "patient_id", "vaccine_code"),
    )


class SyncConflict(Base):
    """A submitted offline event that conflicts with stored state.

    Conflicts are preserved for human review rather than resolved by
    last-write-wins.
    """

    __tablename__ = "sync_conflicts"

    id = Column(String(36), primary_key=True, default=guid)
    client_event_id = Column(String(64), index=True, nullable=False)
    patient_id = Column(String(36), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False)
    submitted_payload = Column(Text, nullable=False)  # JSON
    conflict_type = Column(String(50), nullable=False)  # duplicate_dose, conflicting_date, unauthorized, invalid
    detail = Column(Text)
    status = Column(String(30), default="open")  # open, resolved, rejected
    submitted_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now)

    patient = relationship("Patient")


class Document(Base):
    __tablename__ = "documents"

    id = Column(String(36), primary_key=True, default=guid)
    patient_id = Column(String(36), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False)
    uploaded_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(512), nullable=False)
    file_type = Column(String(100))
    file_size = Column(Integer)
    status = Column(String(50), default="uploaded")
    ocr_provider = Column(String(100))
    ocr_status = Column(String(50))
    created_at = Column(DateTime, default=now)

    patient = relationship("Patient", back_populates="documents")
    extracted_fields = relationship("ExtractedField", back_populates="document", cascade="all, delete-orphan")


class ExtractedField(Base):
    __tablename__ = "extracted_fields"

    id = Column(String(36), primary_key=True, default=guid)
    document_id = Column(String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    field_name = Column(String(100), nullable=False)
    field_value = Column(Text, nullable=False)
    confidence = Column(Numeric(4, 2), nullable=True)
    is_approved = Column(Boolean, default=False)
    # Set when the value is readable but not trustworthy as-is — for example a
    # date like 03/04/2026 that could be 3 April or 4 March. The reviewer is
    # told why, rather than being shown a number that looks like certainty.
    requires_review = Column(Boolean, default=False, nullable=False)
    review_note = Column(Text, nullable=True)
    reviewed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now)

    document = relationship("Document", back_populates="extracted_fields")


class RecordMatchCandidate(Base):
    __tablename__ = "record_match_candidates"

    id = Column(String(36), primary_key=True, default=guid)
    patient_id = Column(String(36), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False)
    candidate_patient_id = Column(String(36), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False)
    match_score = Column(Numeric(4, 2))
    evidence = Column(Text)
    conflicting_fields = Column(Text)
    status = Column(String(50), default="pending")
    reviewed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now)

    patient = relationship("Patient", foreign_keys=[patient_id])
    candidate = relationship("Patient", foreign_keys=[candidate_patient_id])


class VerificationDecision(Base):
    __tablename__ = "verification_decisions"

    id = Column(String(36), primary_key=True, default=guid)
    extracted_field_id = Column(String(36), ForeignKey("extracted_fields.id", ondelete="CASCADE"), nullable=False)
    decision = Column(String(50), nullable=False)
    reviewer_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason = Column(Text)
    created_at = Column(DateTime, default=now)

    field = relationship("ExtractedField")


class Recommendation(Base):
    __tablename__ = "recommendations"

    id = Column(String(36), primary_key=True, default=guid)
    patient_id = Column(String(36), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False)
    vaccine_code = Column(String(50), ForeignKey("vaccines.code", ondelete="SET NULL"), nullable=False)
    rule_id = Column(String(100))
    status = Column(String(50), nullable=False)
    explanation = Column(Text)
    schedule_version_id = Column(String(36), ForeignKey("schedule_versions.id", ondelete="SET NULL"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)

    patient = relationship("Patient", back_populates="recommendations")
    schedule_version = relationship("ScheduleVersion")


class OutreachTask(Base):
    __tablename__ = "outreach_tasks"

    id = Column(String(36), primary_key=True, default=guid)
    patient_id = Column(String(36), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    reason = Column(Text)
    priority_score = Column(Numeric(5, 2), default=0)
    priority_explanation = Column(Text)
    status = Column(String(50), default="open")
    assigned_worker_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)
    resolved_at = Column(DateTime, nullable=True)

    patient = relationship("Patient", back_populates="outreach_tasks")
    assigned_worker_user = relationship("User", back_populates="outreach_tasks", foreign_keys=[assigned_worker_id])
    attempts = relationship("OutreachAttempt", back_populates="task", cascade="all, delete-orphan")


class OutreachAttempt(Base):
    __tablename__ = "outreach_attempts"

    id = Column(String(36), primary_key=True, default=guid)
    task_id = Column(String(36), ForeignKey("outreach_tasks.id", ondelete="CASCADE"), nullable=False)
    worker_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    attempt_type = Column(String(50))
    outcome = Column(String(50))
    notes = Column(Text)
    attempted_at = Column(DateTime, default=now)
    created_at = Column(DateTime, default=now)

    task = relationship("OutreachTask", back_populates="attempts")
    worker_user = relationship("User", back_populates="outreach_attempts")


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(String(36), primary_key=True, default=guid)
    patient_id = Column(String(36), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False)
    facility_id = Column(String(36), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True)
    vaccine_code = Column(String(50), ForeignKey("vaccines.code", ondelete="SET NULL"), nullable=True)
    scheduled_at = Column(DateTime, nullable=False)
    status = Column(String(50), default="requested")
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)

    patient = relationship("Patient", back_populates="appointments")


class InventoryBatch(Base):
    __tablename__ = "inventory_batches"

    id = Column(String(36), primary_key=True, default=guid)
    vaccine_id = Column(String(36), ForeignKey("vaccines.id", ondelete="CASCADE"), nullable=False)
    facility_id = Column(String(36), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True)
    batch_number = Column(String(100), nullable=False)
    quantity_received = Column(Integer, nullable=False, default=0)
    quantity_used = Column(Integer, nullable=False, default=0)
    quantity_adjusted = Column(Integer, nullable=False, default=0)
    expiry_date = Column(DateTime, nullable=False)
    status = Column(String(50), default="active")
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)

    transactions = relationship("InventoryTransaction", back_populates="batch", cascade="all, delete-orphan")


class InventoryTransaction(Base):
    __tablename__ = "inventory_transactions"

    id = Column(String(36), primary_key=True, default=guid)
    batch_id = Column(String(36), ForeignKey("inventory_batches.id", ondelete="CASCADE"), nullable=False)
    transaction_type = Column(String(50), nullable=False)
    quantity = Column(Integer, nullable=False)
    reference = Column(String(255))
    recorded_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=now)

    batch = relationship("InventoryBatch", back_populates="transactions")
    recorded_by_user = relationship("User", back_populates="inventory_transactions")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String(36), primary_key=True, default=guid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text)
    type = Column(String(50), default="info")
    is_read = Column(Boolean, default=False)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now)


class ConsentRecord(Base):
    __tablename__ = "consent_records"

    id = Column(String(36), primary_key=True, default=guid)
    patient_id = Column(String(36), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False)
    consent_type = Column(String(100), nullable=False)
    granted = Column(Boolean, default=False)
    granted_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=now)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(String(36), primary_key=True, default=guid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(100), nullable=False)
    entity_type = Column(String(100), nullable=False)
    entity_id = Column(String(36), nullable=True)
    details = Column(Text)
    ip_address = Column(String(64))
    created_at = Column(DateTime, default=now)

    user = relationship("User", back_populates="audit_events")
