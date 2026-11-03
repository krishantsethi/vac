"""Deterministic demonstration seed data for VAXBRIDGE AI.

Every record here is synthetic. A fixed RNG seed makes the demo repeatable, so
dashboard metrics are stable across restarts and can be verified in tests.

The dataset deliberately covers the shapes the product has to handle:
  * up-to-date histories
  * upcoming doses
  * potentially overdue doses
  * incomplete histories (birth doses only)
  * conflicting dates for the same dose
  * duplicate candidate events
  * authorized AND unauthorized caregiver relationships
  * stock shortages and expiring batches
"""

import json
import random
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from . import models
from .auth import hash_password
from .scheduling.engine import calculate_recommendations

SEED_RANDOM = random.Random(20260131)

SERVICE_AREAS = [
    ("Delhi Central", 28.6139, 77.2090),
    ("Delhi South", 28.5355, 77.2515),
    ("Mumbai East", 19.0760, 72.8777),
    ("Mumbai West", 19.1364, 72.8296),
    ("Chennai South", 13.0827, 80.2707),
    ("Bengaluru North", 13.0300, 77.5800),
]

FIRST_NAMES_M = ["Aarav", "Vihaan", "Arjun", "Sai", "Rohan", "Kabir", "Ishaan", "Ayaan", "Vivaan", "Aditya", "Karan", "Nikhil"]
FIRST_NAMES_F = ["Diya", "Ananya", "Saira", "Meera", "Kavya", "Riya", "Ishita", "Nisha", "Tara", "Anika", "Priya", "Sneha"]
LAST_NAMES = ["Sharma", "Patel", "Singh", "Reddy", "Kumar", "Ali", "Nair", "Gupta", "Joshi", "Menon", "Verma", "Das"]

FACILITY_NAMES = ["Delhi Urban PHC", "City Vaccination Centre", "Chennai PHC", "Bengaluru North PHC", "Mumbai East Clinic"]


def _iso(d: datetime) -> str:
    return d.date().isoformat()


# Age at administration (days) and the minimum patient age (months) required
# before a fixture dose is written. Ages follow the demonstration schedule in
# app/scheduling: birth doses, 6/10/14-week pentavalent and rotavirus, IPV and
# the third pentavalent dose around 4 months, measles at 9 and 15 months, and
# boosters from 16 months.
PENTA1_AGE_DAYS = 62
PENTA2_AGE_DAYS = 95
IMMUNIZATION_SERIES = [
    # code, dose label, age at administration (days), min patient age (months)
    ("PENTA1", "Dose 1", PENTA1_AGE_DAYS, 3),
    ("ROTA1", "Dose 1", 62, 3),
    ("PCV1", "Dose 1", 64, 3),
    ("PENTA2", "Dose 2", PENTA2_AGE_DAYS, 4),
    ("ROTA2", "Dose 2", 95, 4),
    ("IPV1", "Dose 1", 128, 5),
    ("PENTA3", "Dose 3", 130, 5),
    ("MCV1", "Dose 1", 282, 10),
    ("MCV2", "Dose 2", 472, 16),
    ("DPT_BOOSTER", "Booster", 505, 17),
    ("OPV_BOOSTER", "Booster", 505, 17),
]


def seed_database(db: Session) -> None:
    """Create the full demonstration dataset. Assumes an empty database."""

    now = datetime.utcnow()

    # ── Roles ────────────────────────────────────────────────────────────
    role_defs = [
        ("system_admin", "System administrator"),
        ("clinic_admin", "Clinic administrator"),
        ("public_health_admin", "Public-health administrator"),
        ("healthcare_worker", "Healthcare worker"),
        ("patient", "Patient"),
        ("caregiver", "Caregiver"),
    ]
    roles = {}
    for name, desc in role_defs:
        r = models.Role(name=name, description=desc)
        db.add(r)
        roles[name] = r
    db.flush()

    def add_user(email, password, full_name, role, phone=None, language="en", verified=True):
        u = models.User(
            email=email,
            password_hash=hash_password(password),
            full_name=full_name,
            role=role,
            phone=phone,
            language=language,
            is_active=True,
            is_verified=verified,
        )
        db.add(u)
        db.flush()
        db.add(models.UserRole(user_id=u.id, role_id=roles[role].id))
        return u

    admin = add_user("admin@vaxbridge.demo", "Admin@12345", "Asha System Administrator", "system_admin")
    clinic = add_user("clinic@vaxbridge.demo", "Clinic@12345", "Rahul Clinic Administrator", "clinic_admin")
    ph_admin = add_user("ph@vaxbridge.demo", "PH@12345", "Meena Public-Health Administrator", "public_health_admin")

    workers = [
        add_user("worker1@vaxbridge.demo", "Worker@12345", "Ramesh Field Worker", "healthcare_worker", "+919876543210"),
        add_user("worker2@vaxbridge.demo", "Worker@12345", "Sneha Field Worker", "healthcare_worker", "+919876543211"),
        add_user("worker3@vaxbridge.demo", "Worker@12345", "Imran Field Worker", "healthcare_worker", "+919876543212"),
    ]

    caregivers = [
        add_user("caregiver1@vaxbridge.demo", "Caregiver@12345", "Priya Caregiver", "caregiver", "+919111122222"),
        add_user("caregiver2@vaxbridge.demo", "Caregiver@12345", "Amit Caregiver", "caregiver", "+919111133333"),
        add_user("caregiver3@vaxbridge.demo", "Caregiver@12345", "Lakshmi Caregiver", "caregiver", "+919111144444"),
    ]

    # ── Organisations and locations ──────────────────────────────────────
    org_gov = models.Organization(name="Demonstration Public Health Trust", type="government",
                                  address="Demo address withheld", phone=None)
    org_priv = models.Organization(name="Demonstration Private Hospital Group", type="private",
                                   address="Demo address withheld", phone=None)
    db.add_all([org_gov, org_priv])
    db.flush()

    locations = []
    for i, (area, lat, lon) in enumerate(SERVICE_AREAS):
        loc = models.Location(
            organization_id=(org_gov if i % 2 == 0 else org_priv).id,
            name=f"{area} Immunization Centre",
            address=f"Demo address withheld — {area}",
            service_area=area,
            latitude=lat,
            longitude=lon,
        )
        db.add(loc)
        locations.append(loc)
    db.flush()

    # ── Vaccines ─────────────────────────────────────────────────────────
    vaccine_defs = [
        ("BCG", "Bacille Calmette-Guérin", "Tuberculosis, birth dose"),
        ("OPV0", "Oral Polio Vaccine (birth dose)", "Poliomyelitis, zero dose"),
        ("HEPB0", "Hepatitis B (birth dose)", "Hepatitis B, zero dose"),
        ("PENTA1", "Pentavalent 1", "DPT-HepB-Hib, first dose"),
        ("PENTA2", "Pentavalent 2", "DPT-HepB-Hib, second dose"),
        ("PENTA3", "Pentavalent 3", "DPT-HepB-Hib, third dose"),
        ("ROTA1", "Rotavirus 1", "Rotavirus diarrhoea, first dose"),
        ("ROTA2", "Rotavirus 2", "Rotavirus diarrhoea, second dose"),
        ("IPV1", "Inactivated Polio Vaccine", "Poliomyelitis, fractional dose"),
        ("MCV1", "Measles-Rubella 1", "Measles and rubella, first dose"),
        ("MCV2", "Measles-Rubella 2", "Measles and rubella, second dose"),
        ("PCV1", "Pneumococcal Conjugate 1", "Pneumococcal disease, first dose"),
        ("DPT_BOOSTER", "DPT Booster", "Diphtheria-tetanus-pertussis booster"),
        ("OPV_BOOSTER", "Oral Polio Booster", "Poliomyelitis booster"),
    ]
    for code, name, desc in vaccine_defs:
        db.add(models.Vaccine(code=code, name=name, description=desc))
    db.flush()
    vaccine_by_code = {v.code: v for v in db.query(models.Vaccine).all()}

    # ── Schedule version and rules ───────────────────────────────────────
    schedule = models.ScheduleVersion(
        source_name="Universal Infant Immunization Schedule (limited demonstration sample)",
        source_version="1.0.0-demo",
        effective_date=datetime(2024, 1, 1),
        applicable_population="Infants and children 0-24 months (demonstration cohort)",
        approval_status="approved",
        is_active=True,
        description=(
            "Manually validated sample ruleset for demonstration only. It is limited and is NOT "
            "comprehensive clinical guidance for any country, programme, or clinical circumstance."
        ),
    )
    db.add(schedule)
    db.flush()

    rule_defs = [
        ("BCG-0", "BCG", 1, 0, None, 0, 7),
        ("OPV0-0", "OPV0", 1, 0, None, 0, 7),
        ("HEPB0-0", "HEPB0", 1, 0, None, 0, 7),
        ("PENTA-1", "PENTA1", 1, 2, None, 28, 56),
        ("PENTA-2", "PENTA2", 2, 3, None, 28, 56),
        ("PENTA-3", "PENTA3", 3, 4, None, 28, 56),
        ("ROTA-1", "ROTA1", 1, 2, None, 28, 56),
        ("ROTA-2", "ROTA2", 2, 3, None, 28, 56),
        ("IPV-1", "IPV1", 1, 4, None, 28, 56),
        ("PCV-1", "PCV1", 1, 2, None, 28, 56),
        ("MCV-1", "MCV1", 1, 9, None, 0, 56),
        ("MCV-2", "MCV2", 2, 15, None, 0, 84),
        ("DPT-B", "DPT_BOOSTER", 1, 16, 24, 0, 84),
        ("OPV-B", "OPV_BOOSTER", 1, 16, 24, 0, 84),
    ]
    for rule_id, code, dose, min_m, max_m, min_d, max_d in rule_defs:
        db.add(models.ScheduleRule(
            schedule_version_id=schedule.id,
            rule_id=rule_id,
            vaccine_code=code,
            dose_number=dose,
            target_age_min_months=min_m,
            target_age_max_months=max_m,
            recommended_window_min_days=min_d,
            recommended_window_max_days=max_d,
            required_fields=json.dumps(["patient.date_of_birth", "vaccine_code", "administered_at", "dose_label"]),
            validation_tests=json.dumps(["date_not_in_future", "dose_sequence_non_decreasing", "min_interval_respected"]),
            is_required=True,
        ))
    db.flush()

    # ── Patients ─────────────────────────────────────────────────────────
    # Age profiles in months. Mixed deliberately so every status is exercised.
    age_profiles = [
        18, 10, 30, 5, 14, 20, 3, 8, 22, 12,
        1, 16, 7, 24, 11, 6, 19, 13, 2, 9,
        21, 4, 15, 17, 23, 26, 28, 31, 34, 36,
        38, 40, 44, 48, 52, 60,
    ]
    # History archetypes drive which events are created.
    archetypes = [
        "complete",          # everything due so far is verified -> up to date
        "missing_penta3",    # gap: third dose absent
        "incomplete_birth",  # only birth doses recorded
        "conflicting_dates", # same dose recorded twice with different dates
        "duplicate_event",   # exact duplicate candidate
        "unverified_entry",  # an entry exists but nobody verified it
        "recent_birth",      # too young for most rules -> upcoming
        "overdue_mcv",       # MCV1 window passed without a record
    ]

    patients = []
    patient_users = []
    for idx, age_months in enumerate(age_profiles):
        n = idx + 1
        gender = "Male" if idx % 2 == 0 else "Female"
        first = SEED_RANDOM.choice(FIRST_NAMES_M if gender == "Male" else FIRST_NAMES_F)
        last = SEED_RANDOM.choice(LAST_NAMES)
        area, _, _ = SERVICE_AREAS[idx % len(SERVICE_AREAS)]
        archetype = archetypes[idx % len(archetypes)]

        # The first six patients get portal accounts so patient/caregiver roles
        # can be demonstrated end to end.
        portal_user = None
        if idx < 6:
            portal_user = add_user(
                f"patient{n}@vaxbridge.demo", "Patient@12345", f"{first} {last}", "patient",
                f"+919000{100000 + n}"[:14],
            )
            patient_users.append(portal_user)

        p = models.Patient(
            patient_id=f"VAX-{n:04d}",
            user_id=portal_user.id if portal_user else None,
            first_name=first,
            last_name=last,
            date_of_birth=now - timedelta(days=int(30.4375 * age_months)),
            gender=gender,
            phone=f"+9198{SEED_RANDOM.randint(10000000, 99999999)}",
            address=f"Demo address withheld — {area}",
            service_area=area,
            created_by=clinic.id,
        )
        db.add(p)
        db.flush()
        p._archetype = archetype  # transient, for event generation below
        p._age_months = age_months
        patients.append(p)

    # ── Vaccination events ───────────────────────────────────────────────
    def add_event(patient, code, dose_label, days_ago, verified=True, facility=None, batch=None, source="manual"):
        v = vaccine_by_code[code]
        # A vaccination can never be dated in the future, and never before the
        # child was born. Callers pass offsets derived from the child's age, so
        # a negative value used to produce a future-dated dose. Clamp here so no
        # archetype can introduce an impossible record.
        age_days_of_patient = max(int((now - patient.date_of_birth).days), 0)
        clamped_days_ago = max(0, min(int(days_ago), age_days_of_patient))
        ev = models.VaccinationEvent(
            patient_id=patient.id,
            vaccine_code=code,
            vaccine_name=v.name,
            dose_label=dose_label,
            administered_at=now - timedelta(days=clamped_days_ago),
            facility=facility or SEED_RANDOM.choice(FACILITY_NAMES),
            batch_number=batch,
            is_verified=verified,
            source=source,
        )
        db.add(ev)
        return ev

    for p in patients:
        age_days = int(p._age_months * 30.4375)
        arch = p._archetype
        at = arch

        # Birth doses for everyone at least ~1 month old.
        if p._age_months >= 1:
            add_event(p, "BCG", "Birth dose", age_days - 1)
            add_event(p, "OPV0", "Birth dose", age_days - 1)
            add_event(p, "HEPB0", "Birth dose", age_days - 1)

        if at == "recent_birth":
            continue  # too young for the primary series

        if at == "incomplete_birth":
            continue  # birth doses only — an incomplete history

        # Primary series and boosters, driven by one table.
        #
        # ``age_at_days`` is the child's age when the dose was given, which is
        # what makes the history clinically plausible - a DPT booster cannot be
        # recorded at three months of age. ``add_event`` takes "days ago from
        # now", so it is called with ``age_days - age_at_days``; the
        # ``min_months`` guard keeps that value non-negative.
        for code, dose_label, age_at_days, min_months in IMMUNIZATION_SERIES:
            if p._age_months < min_months:
                continue
            if at == "missing_penta3" and code == "PENTA3":
                continue  # the whole point of this archetype
            if at == "overdue_mcv" and code in ("MCV1", "MCV2"):
                continue  # measles doses never given
            batch = None
            if code.startswith("PENTA"):
                batch = f"PNT-{SEED_RANDOM.randint(1000, 9999)}"
            add_event(p, code, dose_label, age_days - age_at_days, batch=batch)

        # Archetype-specific data-quality problems.
        if at == "conflicting_dates":
            # Same dose, two different dates, two different facilities. Both
            # dates stay inside a plausible age window; only the day differs.
            add_event(p, "PENTA2", "Dose 2", age_days - (PENTA2_AGE_DAYS + 12),
                      facility="City Vaccination Centre",
                      batch=f"PNT-{SEED_RANDOM.randint(1000, 9999)}")
        elif at == "duplicate_event":
            # Exact duplicate candidate: same vaccine, dose, and date.
            add_event(p, "PENTA1", "Dose 1", age_days - PENTA1_AGE_DAYS, facility="Delhi Urban PHC",
                      batch="PNT-2024-0001")
        elif at == "unverified_entry":
            # A historical entry nobody has verified yet. Rather than inventing a
            # dose this child is too young for, one already-recorded dose is left
            # unverified. That is the real-world situation the product has to
            # handle: the entry exists, but nobody has confirmed it against a
            # source document, so it is neither proof of a dose nor proof of a gap.
            db.flush()
            candidate = (
                db.query(models.VaccinationEvent)
                .filter_by(patient_id=p.id, is_verified=True)
                .order_by(models.VaccinationEvent.administered_at.desc())
                .first()
            )
            if candidate is not None:
                candidate.is_verified = False
                candidate.verified_by = None
                candidate.verified_at = None
                candidate.source = "record"

    db.flush()

    # ── Caregiver relationships ──────────────────────────────────────────
    # Authorized links
    db.add(models.CaregiverRelationship(caregiver_user_id=caregivers[0].id, patient_id=patients[0].id,
                                        relationship_type="parent", authorized=True))
    db.add(models.CaregiverRelationship(caregiver_user_id=caregivers[0].id, patient_id=patients[1].id,
                                        relationship_type="parent", authorized=True))
    db.add(models.CaregiverRelationship(caregiver_user_id=caregivers[1].id, patient_id=patients[2].id,
                                        relationship_type="guardian", authorized=True))
    db.add(models.CaregiverRelationship(caregiver_user_id=caregivers[2].id, patient_id=patients[3].id,
                                        relationship_type="parent", authorized=True))
    # An explicitly UNAUTHORIZED link — used by tests to prove access is refused.
    db.add(models.CaregiverRelationship(caregiver_user_id=caregivers[1].id, patient_id=patients[4].id,
                                        relationship_type="family", authorized=False))
    db.flush()

    # ── Inventory batches and transactions ───────────────────────────────
    batch_specs = [
        ("PENTA3", 0, "PNT-2024-118", 200, 165, 180, "active"),
        ("PENTA3", 2, "PNT-2024-119", 80, 74, 45, "active"),      # low stock + expiring
        ("MCV1", 1, "MR-2024-205", 120, 118, 25, "active"),        # low stock + expiring soon
        ("MCV2", 4, "MR-2024-206", 60, 12, 210, "active"),
        ("BCG", 3, "BCG-2024-310", 50, 50, -12, "expired"),        # expired
        ("OPV0", 5, "OPV-2024-411", 90, 30, 150, "active"),
        ("DPT_BOOSTER", 0, "DPT-2024-512", 40, 8, 95, "active"),
        ("IPV1", 2, "IPV-2024-613", 25, 22, 30, "active"),         # near-shortage
    ]
    batches = []
    for code, loc_idx, batch_no, received, used, expiry_offset, status in batch_specs:
        b = models.InventoryBatch(
            vaccine_id=vaccine_by_code[code].id,
            facility_id=locations[loc_idx].id,
            batch_number=batch_no,
            quantity_received=received,
            quantity_used=used,
            quantity_adjusted=0,
            expiry_date=now + timedelta(days=expiry_offset),
            status=status,
        )
        db.add(b)
        db.flush()
        db.add(models.InventoryTransaction(batch_id=b.id, transaction_type="receipt", quantity=received,
                                           reference="Initial stock receipt", recorded_by=clinic.id))
        if used:
            db.add(models.InventoryTransaction(batch_id=b.id, transaction_type="usage", quantity=-used,
                                               reference="Administered during sessions", recorded_by=workers[0].id))
        batches.append(b)
    db.flush()

    # ── Outreach tasks ───────────────────────────────────────────────────
    task_specs = [
        (0, "PENTA3 follow-up", "Third pentavalent dose has no verified record", 78.0,
         "Due-date urgency is high and a previous contact attempt did not resolve the issue.", "open", 0, 7),
        (3, "Incomplete infant series", "Only birth doses are documented", 64.0,
         "Record uncertainty is high; verification is required before any dose is scheduled.", "open", 1, 14),
        (4, "Conflicting PENTA2 dates", "Two verified records disagree on the administration date", 55.0,
         "Conflicting information requires reconciliation before the schedule can be trusted.", "in_progress", 0, 3),
        (7, "MCV1 reminder", "Measles-rubella first dose is due within the recommended window", 48.0,
         "Eligible now and a service opportunity is available this week.", "open", 2, 10),
        (9, "Duplicate PENTA1 review", "An exact duplicate candidate was detected", 40.0,
         "Duplicate candidates are surfaced for review, never merged automatically.", "in_progress", 1, 5),
        (13, "Unverified historical entry", "A recorded dose has never been verified", 36.0,
         "Verification required; unverified entries are not treated as evidence.", "open", 2, 21),
        (17, "MCV2 overdue follow-up", "Second measles-rubella dose window has passed", 70.0,
         "Window elapsed without a verified record; elevated due-date urgency.", "resolved", 0, -2),
        (21, "DPT booster confirmation", "Booster dose confirmed during outreach visit", 30.0,
         "Resolved after the caregiver attended a session.", "resolved", 1, -5),
        (25, "Location uncertainty", "Family reported as migrated within the district", 22.0,
         "Migration is recorded as context for continuity; it is never a punitive factor.", "escalated", 2, 4),
    ]
    tasks = []
    # (opened_days_ago, resolved_days_ago_or_None) per task, so time-to-resolution
    # is a genuine positive duration rather than an artifact of seeding.
    lifecycle = [
        (9, None),      # open, still pending
        (16, None),     # open
        (6, None),      # in progress
        (11, None),     # open
        (8, None),      # in progress
        (21, None),     # open
        (24, 4),        # resolved after 20 days
        (30, 12),       # resolved after 18 days
        (14, None),     # escalated
    ]
    for (p_idx, title, reason, score, explanation, status, w_idx, due_offset), (opened, resolved) in zip(task_specs, lifecycle):
        created = now - timedelta(days=opened)
        t = models.OutreachTask(
            patient_id=patients[p_idx].id,
            title=title,
            reason=reason,
            priority_score=score,
            priority_explanation=explanation,
            status=status,
            assigned_worker_id=workers[w_idx].id,
            due_date=now + timedelta(days=due_offset),
            created_at=created,
            updated_at=(now - timedelta(days=resolved)) if resolved is not None else created,
            resolved_at=(now - timedelta(days=resolved)) if resolved is not None else None,
        )
        db.add(t)
        tasks.append(t)
    db.flush()

    attempt_specs = [
        (0, 0, "phone", "unreachable", "Number did not connect after two attempts."),
        (0, 0, "visit", "contacted", "Met the caregiver; card was at the previous facility."),
        (2, 1, "phone", "contacted", "Caregiver confirmed two cards from different clinics."),
        (3, 2, "sms", "attempted", "Reminder sent through the in-app channel."),
        (6, 0, "visit", "contacted", "Dose confirmed and recorded during the visit."),
        (8, 2, "phone", "migrated", "Family reported to have moved; continuity flag raised."),
    ]
    for t_idx, w_idx, atype, outcome, notes in attempt_specs:
        task_created = tasks[t_idx].created_at
        # Attempts always fall between task creation and today.
        span_days = max((now - task_created).days - 1, 1)
        attempted = task_created + timedelta(days=SEED_RANDOM.randint(0, span_days - 1) if span_days > 1 else 0, hours=10)
        db.add(models.OutreachAttempt(
            task_id=tasks[t_idx].id,
            worker_id=workers[w_idx].id,
            attempt_type=atype,
            outcome=outcome,
            notes=notes,
            attempted_at=attempted,
        ))

    # ── Appointments ─────────────────────────────────────────────────────
    appt_specs = [
        (0, 0, "PENTA3", 5, "requested"),
        (3, 0, "PENTA1", 3, "confirmed"),
        (7, 1, "MCV1", 8, "confirmed"),
        (9, 2, "PENTA1", 12, "requested"),
        (13, 1, "MCV1", -6, "completed"),
        (17, 0, "MCV2", -14, "cancelled"),
        (21, 2, "DPT_BOOSTER", 6, "confirmed"),
    ]
    for p_idx, loc_idx, code, offset, status in appt_specs:
        db.add(models.Appointment(
            patient_id=patients[p_idx].id,
            facility_id=locations[loc_idx].id,
            vaccine_code=code,
            scheduled_at=now + timedelta(days=offset, hours=10),
            status=status,
            created_by=workers[loc_idx % len(workers)].id,
        ))

    # ── Notifications ────────────────────────────────────────────────────
    notif_specs = [
        (workers[0].id, "New outreach case assigned", "A potentially overdue case was assigned to you.", "alert", False),
        (workers[0].id, "Contact attempt logged", "Your visit note was saved to the case history.", "info", True),
        (workers[1].id, "Verification queue updated", "Two documents are awaiting your review.", "warning", False),
        (clinic.id, "Inventory alert: batch expired", "One BCG batch passed its expiry date.", "warning", False),
        (clinic.id, "Low stock projected", "Two batches are below the reorder threshold.", "warning", False),
        (ph_admin.id, "Weekly coverage summary ready", "Aggregate figures for the trailing 6 weeks are available.", "info", False),
        (admin.id, "Schedule version active", "The demonstration ruleset v1.0.0-demo is active.", "info", True),
        (caregivers[0].id, "Upcoming vaccination", "A dose is due for one of your dependents.", "info", False),
    ]
    if patient_users:
        notif_specs.append((patient_users[0].id, "Record verification received",
                            "A document you uploaded is awaiting review.", "info", False))
    for user_id, title, message, ntype, is_read in notif_specs:
        db.add(models.Notification(
            user_id=user_id, title=title, message=message, type=ntype, is_read=is_read,
            read_at=now - timedelta(days=1) if is_read else None,
        ))

    # ── Consent records ──────────────────────────────────────────────────
    for p in patients[:12]:
        db.add(models.ConsentRecord(
            patient_id=p.id, consent_type="data_processing", granted=True,
            granted_at=now - timedelta(days=30), created_by=clinic.id,
        ))
    db.add(models.ConsentRecord(
        patient_id=patients[12].id, consent_type="data_processing", granted=False,
        created_by=clinic.id,
    ))

    # ── Demonstration documents with prepared OCR fixtures ───────────────
    # Clearly labeled demonstration mode: these are prepared extraction
    # results, not the output of a live OCR engine.
    doc_specs = [
        (0, "card_aarav_penta3.png", {
            "vaccination_date": _iso(now - timedelta(days=8)),
            "vaccine_name": "Pentavalent",
            "dose_label": "Dose 3",
            "facility": "Delhi Urban PHC",
            "batch_number": "PNT-2024-118",
            "record_id": "REC-DEMO-1001",
        }),
        (3, "card_ananya_penta1.png", {
            "vaccination_date": _iso(now - timedelta(days=60)),
            "vaccine_name": "Pentavalent",
            "dose_label": "Dose 1",
            "facility": "Chennai PHC",
            "batch_number": "PNT-2024-140",
            "record_id": "REC-DEMO-1002",
        }),
        (7, "card_mcv1.png", {
            "vaccination_date": _iso(now - timedelta(days=200)),
            "vaccine_name": "Measles-Rubella",
            "dose_label": "Dose 1",
            "facility": "Mumbai East Clinic",
            "batch_number": "MR-2024-205",
            "record_id": "REC-DEMO-1003",
        }),
        (13, "card_unclear.png", {
            "vaccination_date": _iso(now - timedelta(days=210)),
            "vaccine_name": "Measles",   # ambiguous: needs terminology mapping
            "dose_label": "",            # missing: must not be fabricated
            "facility": "",              # missing
            "batch_number": "",          # missing
            "record_id": "REC-DEMO-1004",
        }),
    ]
    for p_idx, fname, fields in doc_specs:
        doc = models.Document(
            patient_id=patients[p_idx].id,
            uploaded_by=caregivers[0].id if p_idx < 2 else clinic.id,
            file_name=fname,
            file_path=f"./uploads/demo/{fname}",
            file_type="image/png",
            file_size=48213,
            status="review_required",
            ocr_provider="demo-ocr-fixture",
            ocr_status="completed",
        )
        db.add(doc)
        db.flush()
        for field_name, field_value in fields.items():
            db.add(models.ExtractedField(
                document_id=doc.id,
                field_name=field_name,
                field_value=field_value,
                # No confidence is reported: the demonstration fixture does not
                # produce a calibrated measure, so none is invented.
                confidence=None,
                is_approved=False,
            ))

    # ── Record match candidates (identity-level) ─────────────────────────
    # A near-duplicate identity pair: same name, same DOB, different phone.
    dup = models.Patient(
        patient_id="VAX-9001",
        first_name=patients[0].first_name,
        last_name=patients[0].last_name,
        date_of_birth=patients[0].date_of_birth,
        gender=patients[0].gender,
        phone=f"+9198{SEED_RANDOM.randint(10000000, 99999999)}",
        address="Demo address withheld — registered at a second facility",
        service_area=patients[0].service_area,
        created_by=clinic.id,
    )
    db.add(dup)
    db.flush()
    db.add(models.RecordMatchCandidate(
        patient_id=patients[0].id,
        candidate_patient_id=dup.id,
        match_score=92.0,
        evidence=json.dumps({
            "matched": ["first_name", "last_name", "date_of_birth", "service_area"],
            "differing": ["phone", "address"],
            "method": "normalized_text_and_exact_dob",
        }),
        conflicting_fields=json.dumps(["phone", "address"]),
        status="pending",
    ))
    db.flush()

    # ── Pre-computed recommendations ─────────────────────────────────────
    # Run the deterministic engine over every patient so dashboards, analytics,
    # and prioritization have real derived state from first load. These are
    # derived from the seeded history and the active schedule version, not
    # hardcoded figures.
    all_patients = db.query(models.Patient).all()
    for p in all_patients:
        for r in calculate_recommendations(db, p):
            db.add(models.Recommendation(
                patient_id=p.id,
                vaccine_code=r["vaccine_code"],
                rule_id=r.get("rule_id"),
                status=r["status"],
                explanation=r["explanation"],
                schedule_version_id=r.get("schedule_version_id"),
                due_date=r.get("due_date"),
            ))
    db.flush()

    db.commit()
