"""Role-based access control — the single source of truth for authorization.

Every decision in this module is enforced **on the server**. Hiding a sidebar
link or a button in the UI is a courtesy to the user; it is never a security
control. Any endpoint that touches clinical data must route through the sets
and helpers defined here.

Role model
----------
``patient``
    Own record only. Read-mostly. No clinical write access, no visibility into
    other people's records, outreach queues, or stock levels.

``caregiver``
    Only patients they hold an **authorized** link to. An unauthorized or
    revoked link grants nothing. Caregivers never modify clinical records.

``healthcare_worker``
    Clinical read/write across the clinic population. Outreach is limited to
    tasks assigned to them, so one worker cannot silently close another's task.

``clinic_admin``
    Everything a worker can do, plus user and caregiver management, scheduling
    configuration, and audit review.

``public_health_admin``
    Population-level oversight: read clinical records, analytics and outreach
    management. Deliberately **cannot** edit individual vaccination events —
    separating oversight from data entry keeps a single role from both writing
    and auditing the same clinical record.

``system_admin``
    Technical administration only: users, roles, audit logs, platform
    configuration. This is intentionally **not** a clinical role. Being able to
    administer the platform must not imply unrestricted access to patient
    health data, so ``system_admin`` appears in none of the clinical sets below.

Adding a role to one of these sets is a deliberate authorization decision and
should be reviewed as such.
"""

from typing import Optional

from sqlalchemy.orm import Session

# --------------------------------------------------------------------------- #
# Capability sets
# --------------------------------------------------------------------------- #

#: May read individual patient clinical records.
CLINICAL_READ = frozenset({"healthcare_worker", "clinic_admin", "public_health_admin"})

#: May create or modify clinical records (vaccination events, documents,
#: recommendations) on a specific patient.
CLINICAL_WRITE = frozenset({"healthcare_worker", "clinic_admin"})

#: May create and edit patient demographic records.
PATIENT_MANAGEMENT = frozenset({"healthcare_worker", "clinic_admin", "public_health_admin"})

#: May view the outreach queue across the population.
OUTREACH_VIEW = frozenset({"healthcare_worker", "clinic_admin", "public_health_admin"})

#: May create outreach tasks and change their status/assignment.
OUTREACH_MANAGE = frozenset({"healthcare_worker", "clinic_admin", "public_health_admin"})

#: May view vaccine stock levels and batches.
INVENTORY_VIEW = frozenset({"healthcare_worker", "clinic_admin", "public_health_admin"})

#: May receive stock and record inventory transactions.
INVENTORY_MANAGE = frozenset({"healthcare_worker", "clinic_admin"})

#: May view aggregate analytics. These endpoints are population-level and
#: privacy-preserving (small counts are suppressed), but they are still not
#: exposed to patients or caregivers.
ANALYTICS_VIEW = frozenset({"healthcare_worker", "clinic_admin", "public_health_admin"})

#: May review and resolve duplicate/identity match candidates and record issues.
RECORD_REVIEW = frozenset({"healthcare_worker", "clinic_admin", "public_health_admin"})

#: May manage caregiver links.
CAREGIVER_MANAGE = frozenset({"clinic_admin", "public_health_admin"})

#: May manage user accounts.
USER_MANAGE = frozenset({"system_admin", "clinic_admin"})

#: May view audit logs.
AUDIT_VIEW = frozenset({"system_admin", "clinic_admin", "public_health_admin"})

#: May view and configure immunization schedules / rule sets.
SCHEDULE_VIEW = frozenset({"system_admin", "healthcare_worker", "clinic_admin", "public_health_admin"})

#: Technical administration: platform configuration, roles, reference data.
SYSTEM_ADMINISTRATION = frozenset({"system_admin", "clinic_admin"})

#: Every role the system recognises. Used to reject unknown values rather than
#: storing an arbitrary string that silently matches no capability set.
ALL_ROLES = frozenset({
    "patient",
    "caregiver",
    "healthcare_worker",
    "clinic_admin",
    "public_health_admin",
    "system_admin",
})

#: Roles a visitor may claim for themselves during public self-registration.
#:
#: Deliberately only the two roles whose access is scoped to the person's own
#: record or to dependents they are explicitly authorized for. Every other role
#: carries population-wide clinical or administrative reach, so granting one is
#: a provisioning decision that belongs to an administrator (USER_MANAGE), not
#: to the person requesting it.
#:
#: This is a server-side control. It cannot be satisfied by hiding an option in
#: the registration form: an attacker posts JSON directly, and before this guard
#: existed that granted full clinical access to all patients.
SELF_REGISTRATION_ROLES = frozenset({"patient", "caregiver"})

#: Roles that see the whole clinic population rather than a scoped subset.
POPULATION_ROLES = CLINICAL_READ


def is_population_role(role: Optional[str]) -> bool:
    """True for roles that may act across the full patient population."""
    return role in POPULATION_ROLES


def scope_patient_query(q, user, patient_model, caregiver_link_model):
    """Restrict a patient-rooted query to rows ``user`` may access.

    Staff with population access are returned the query unchanged. Caregivers
    are limited to patients with an ``authorized`` link; patients to their own
    record. Roles with no patient access at all (notably ``system_admin``)
    receive a query that matches nothing, so a missing check fails closed
    rather than open.
    """
    if is_population_role(user.role):
        return q
    if user.role == "caregiver":
        return q.join(
            caregiver_link_model,
            caregiver_link_model.patient_id == patient_model.id,
        ).filter(
            caregiver_link_model.caregiver_user_id == user.id,
            caregiver_link_model.authorized == True,  # noqa: E712
        )
    if user.role == "patient":
        return q.filter(patient_model.user_id == user.id)
    # Fail closed: no implicit access for any other role.
    return q.filter(patient_model.id == "__no_access__")


def can_view_all_outreach(role: Optional[str]) -> bool:
    return role in OUTREACH_VIEW


__all__ = [
    "ALL_ROLES",
    "SELF_REGISTRATION_ROLES",
    "CLINICAL_READ",
    "CLINICAL_WRITE",
    "PATIENT_MANAGEMENT",
    "OUTREACH_VIEW",
    "OUTREACH_MANAGE",
    "INVENTORY_VIEW",
    "INVENTORY_MANAGE",
    "ANALYTICS_VIEW",
    "RECORD_REVIEW",
    "CAREGIVER_MANAGE",
    "USER_MANAGE",
    "AUDIT_VIEW",
    "SCHEDULE_VIEW",
    "SYSTEM_ADMINISTRATION",
    "POPULATION_ROLES",
    "is_population_role",
    "scope_patient_query",
    "can_view_all_outreach",
]
