"""Pydantic schemas for request/response validation."""

from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, EmailStr, Field, ConfigDict, field_validator


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    user_id: Optional[str] = None


# ---- Auth ----

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=1, max_length=255)
    role: str = Field(default="patient")
    phone: Optional[str] = None
    language: str = Field(default="en")


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    phone: Optional[str] = None
    language: str
    is_active: bool
    is_verified: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---- Users ----

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    language: Optional[str] = None
    is_active: Optional[bool] = None


# ---- Roles ----

class RoleOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ---- Patients ----

class PatientBase(BaseModel):
    patient_id: Optional[str] = None
    first_name: str
    last_name: str
    date_of_birth: datetime
    gender: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    service_area: Optional[str] = None


class PatientCreate(PatientBase):
    pass


class PatientUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    date_of_birth: Optional[datetime] = None
    gender: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    service_area: Optional[str] = None


class PatientOut(PatientBase):
    id: str
    user_id: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---- Caregiver ----

class CaregiverLinkCreate(BaseModel):
    caregiver_user_id: str
    patient_id: str
    relationship_type: str = "parent"
    authorized: bool = True


class CaregiverLinkOut(BaseModel):
    id: str
    caregiver_user_id: str
    patient_id: str
    relationship_type: str
    authorized: bool
    created_at: datetime
    # Resolved server-side so a patient can see *who* is authorized on their
    # record without being given access to the account directory. The email
    # address is only populated for roles that may manage caregiver links.
    caregiver_name: Optional[str] = None
    caregiver_email: Optional[str] = None
    patient_display_id: Optional[str] = None
    patient_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ---- Organizations / Locations ----

class OrganizationOut(BaseModel):
    id: str
    name: str
    type: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LocationBase(BaseModel):
    organization_id: Optional[str] = None
    name: str
    address: Optional[str] = None
    service_area: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class LocationCreate(LocationBase):
    pass


class LocationOut(LocationBase):
    id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---- Vaccines ----

class VaccineOut(BaseModel):
    id: str
    code: str
    name: str
    description: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---- Schedule ----

class ScheduleRuleOut(BaseModel):
    id: str
    rule_id: str
    vaccine_code: str
    dose_number: int
    target_age_min_months: int
    target_age_max_months: Optional[int]
    recommended_window_min_days: int
    recommended_window_max_days: int
    required_fields: Optional[str] = None
    validation_tests: Optional[str] = None
    is_required: bool

    model_config = ConfigDict(from_attributes=True)


class ScheduleVersionOut(BaseModel):
    id: str
    source_name: str
    source_version: str
    effective_date: datetime
    applicable_population: Optional[str]
    approval_status: str
    is_active: bool
    description: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---- Vaccination Events ----

class VaccinationEventBase(BaseModel):
    vaccine_code: str
    vaccine_name: str
    dose_label: str
    administered_at: datetime
    facility: Optional[str] = None
    batch_number: Optional[str] = None
    source_record_id: Optional[str] = None


class VaccinationEventCreate(VaccinationEventBase):
    pass


class VaccinationEventOut(VaccinationEventBase):
    id: str
    patient_id: str
    is_verified: bool
    verified_by: Optional[str]
    verified_at: Optional[datetime]
    source: str
    source_document_id: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---- Documents ----

class DocumentOut(BaseModel):
    id: str
    patient_id: str
    file_name: str
    file_type: Optional[str]
    file_size: Optional[int]
    status: str
    ocr_provider: Optional[str]
    ocr_status: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DocumentUploadResponse(BaseModel):
    document_id: str
    status: str
    demo_mode: bool
    extracted_fields: List[Any] = []


class ExtractedFieldOut(BaseModel):
    id: str
    field_name: str
    field_value: str
    # None whenever the OCR provider did not supply a meaningful measure. It is
    # never estimated, so a blank confidence is honest rather than missing data.
    confidence: Optional[float]
    is_approved: bool
    requires_review: bool = False
    review_note: Optional[str] = None
    reviewed_by: Optional[str]
    reviewed_at: Optional[datetime]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FieldReview(BaseModel):
    field_id: str
    approved: bool
    reason: Optional[str] = None


# ---- Record Matching ----

class RecordMatchCandidateOut(BaseModel):
    id: str
    patient_id: str
    candidate_patient_id: str
    match_score: Optional[float]
    evidence: Optional[str]
    conflicting_fields: Optional[str]
    status: str
    reviewed_by: Optional[str]
    reviewed_at: Optional[datetime]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MatchDecision(BaseModel):
    candidate_id: str
    decision: str  # confirmed, rejected, unresolved
    reason: Optional[str] = None


# ---- Verification ----

class VerificationDecisionOut(BaseModel):
    id: str
    extracted_field_id: str
    decision: str
    reviewer_id: Optional[str]
    reason: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---- Recommendations ----

class RecommendationOut(BaseModel):
    id: str
    patient_id: str
    vaccine_code: str
    rule_id: Optional[str]
    status: str
    explanation: Optional[str]
    schedule_version_id: Optional[str]
    due_date: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RecalculateRequest(BaseModel):
    patient_id: str


# ---- Outreach ----

class OutreachTaskBase(BaseModel):
    patient_id: str
    title: str
    reason: Optional[str] = None
    priority_score: Optional[float] = 0
    priority_explanation: Optional[str] = None
    status: Optional[str] = "open"
    assigned_worker_id: Optional[str] = None
    due_date: Optional[datetime] = None


class OutreachTaskCreate(OutreachTaskBase):
    pass


class OutreachTaskUpdate(BaseModel):
    title: Optional[str] = None
    reason: Optional[str] = None
    priority_score: Optional[float] = None
    priority_explanation: Optional[str] = None
    status: Optional[str] = None
    assigned_worker_id: Optional[str] = None
    due_date: Optional[datetime] = None


class OutreachTaskOut(OutreachTaskBase):
    id: str
    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


class OutreachAttemptCreate(BaseModel):
    worker_id: Optional[str] = None
    attempt_type: str
    outcome: str
    notes: Optional[str] = None
    attempted_at: Optional[datetime] = None


class OutreachAttemptOut(BaseModel):
    id: str
    task_id: str
    worker_id: Optional[str]
    attempt_type: str
    outcome: str
    notes: Optional[str]
    attempted_at: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---- Appointments ----

class AppointmentBase(BaseModel):
    patient_id: str
    facility_id: Optional[str] = None
    vaccine_code: Optional[str] = None
    scheduled_at: datetime
    status: Optional[str] = "requested"


class AppointmentCreate(AppointmentBase):
    pass


class AppointmentUpdate(BaseModel):
    facility_id: Optional[str] = None
    vaccine_code: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    status: Optional[str] = None


class AppointmentOut(AppointmentBase):
    id: str
    created_by: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---- Inventory ----

class InventoryBatchBase(BaseModel):
    vaccine_id: str
    facility_id: Optional[str] = None
    batch_number: str
    quantity_received: int = 0
    expiry_date: datetime


class InventoryBatchCreate(InventoryBatchBase):
    @field_validator("batch_number")
    @classmethod
    def _batch_number_present(cls, v: str) -> str:
        # Batch numbers are how a recalled or expired lot is traced, so an empty
        # one would make the stock untraceable rather than merely unlabeled.
        if not (v or "").strip():
            raise ValueError("batch_number is required so stock can be traced")
        return v.strip()

    @field_validator("quantity_received")
    @classmethod
    def _quantity_not_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("quantity_received cannot be negative")
        return v

    @field_validator("expiry_date")
    @classmethod
    def _expiry_in_the_future(cls, v: datetime) -> datetime:
        # Receiving stock that is already past its expiry would create a batch
        # that can never legitimately be issued.
        naive = v.replace(tzinfo=None) if v.tzinfo else v
        if naive < datetime.utcnow():
            raise ValueError("expiry_date must be in the future when receiving new stock")
        return v


class InventoryBatchOut(InventoryBatchBase):
    id: str
    quantity_used: int
    quantity_adjusted: int
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


INVENTORY_TRANSACTION_TYPES = ("receipt", "usage", "adjustment", "expiry")


class InventoryTransactionCreate(BaseModel):
    batch_id: str
    transaction_type: str  # receipt, usage, adjustment, expiry
    quantity: int
    reference: Optional[str] = None

    @field_validator("transaction_type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        if v not in INVENTORY_TRANSACTION_TYPES:
            raise ValueError(
                f"transaction_type must be one of: {', '.join(INVENTORY_TRANSACTION_TYPES)}"
            )
        return v

    @field_validator("quantity")
    @classmethod
    def _plausible_quantity(cls, v: int) -> int:
        # Adjustments are signed (negative = wastage/write-off); receipts and
        # usage are magnitudes. Either way an absurd value is a data-entry error.
        if abs(v) > 1_000_000:
            raise ValueError("quantity is implausibly large")
        return v


class InventoryTransactionOut(BaseModel):
    id: str
    batch_id: str
    transaction_type: str
    quantity: int
    reference: Optional[str]
    recorded_by: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---- Notifications ----

class NotificationOut(BaseModel):
    id: str
    title: str
    message: Optional[str]
    type: str
    is_read: bool
    read_at: Optional[datetime]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---- Audit ----

class AuditEventOut(BaseModel):
    id: str
    user_id: Optional[str]
    action: str
    entity_type: str
    entity_id: Optional[str]
    details: Optional[str]
    ip_address: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---- Analytics ----

class MetricCard(BaseModel):
    label: str
    value: Any
    delta: Optional[str] = None
    status: Optional[str] = None
