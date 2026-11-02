import { getUser } from "./auth";

/**
 * Client-side mirror of the server capability sets in `apps/api/app/rbac.py`.
 *
 * This exists only to decide what to *show*. It is not authorization. Every
 * request is re-checked on the server, and hiding a button here never makes an
 * action safe — a hidden sidebar link is not a security control. If this file
 * and `rbac.py` ever disagree, the server wins and the UI is merely offering
 * something that will be refused.
 *
 * Note that `system_admin` appears in none of the clinical sets. Administering
 * the platform does not grant access to patient health data.
 */

export const CLINICAL_READ = ["healthcare_worker", "clinic_admin", "public_health_admin"] as const;
export const CLINICAL_WRITE = ["healthcare_worker", "clinic_admin"] as const;
export const PATIENT_MANAGEMENT = ["healthcare_worker", "clinic_admin", "public_health_admin"] as const;
export const OUTREACH_VIEW = ["healthcare_worker", "clinic_admin", "public_health_admin"] as const;
export const OUTREACH_MANAGE = ["healthcare_worker", "clinic_admin", "public_health_admin"] as const;
export const INVENTORY_VIEW = ["healthcare_worker", "clinic_admin", "public_health_admin"] as const;
export const INVENTORY_MANAGE = ["healthcare_worker", "clinic_admin"] as const;
export const ANALYTICS_VIEW = ["healthcare_worker", "clinic_admin", "public_health_admin"] as const;
export const RECORD_REVIEW = ["healthcare_worker", "clinic_admin", "public_health_admin"] as const;
export const CAREGIVER_MANAGE = ["clinic_admin", "public_health_admin"] as const;
export const USER_MANAGE = ["system_admin", "clinic_admin"] as const;
export const AUDIT_VIEW = ["system_admin", "clinic_admin", "public_health_admin"] as const;
export const SCHEDULE_VIEW = ["system_admin", "healthcare_worker", "clinic_admin", "public_health_admin"] as const;

export type Capability = readonly string[];

/** The signed-in account's role, or null when there is no session. */
export function currentRole(): string | null {
  const user = getUser();
  return user?.role ?? null;
}

/** True when the signed-in role holds the given capability (display only). */
export function can(capability: Capability): boolean {
  const role = currentRole();
  return !!role && (capability as readonly string[]).includes(role);
}

/** True for roles whose view is limited to specific patients. */
export function isScopedToOwnPatients(): boolean {
  const role = currentRole();
  return role === "patient" || role === "caregiver";
}
