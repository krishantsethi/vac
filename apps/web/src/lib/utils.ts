import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateIN(iso: string | Date | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateShort(iso: string | Date | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function ageFromDOB(dob: string | Date) {
  const d = new Date(dob);
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  return months;
}

/**
 * Normalise an Indian phone number to its 10 significant digits.
 *
 * Accepts the forms people actually type: "98765 43210", "+91 98765-43210",
 * "09876543210", "0091-9876543210". Returns null when the value cannot be an
 * Indian number, rather than silently truncating it.
 */
export function normalizeIndianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("0091")) digits = digits.slice(4);
  else if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  if (!/^\d{10}$/.test(digits)) return null;
  // Indian mobile numbers begin 6-9. Landlines have an STD code, so a value
  // starting with 1-5 is treated as a landline and accepted without the mobile
  // check rather than rejected outright.
  return digits;
}

/** True when the value parses as a plausible Indian mobile number. */
export function isValidIndianMobile(raw: string | null | undefined): boolean {
  const digits = normalizeIndianPhone(raw);
  return !!digits && /^[6-9]/.test(digits);
}

/** True when the value parses as any plausible Indian phone number. */
export function isValidIndianPhone(raw: string | null | undefined): boolean {
  return normalizeIndianPhone(raw) !== null;
}

/** Display an Indian number as +91 XXXXX XXXXX. */
export function formatIndianPhone(raw: string | null | undefined): string {
  const digits = normalizeIndianPhone(raw);
  if (!digits) return raw ? String(raw) : "";
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** Whole months elapsed since a date of birth. */
export function monthsFromDOB(dob: string | Date): number {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return 0;
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  return Math.max(months, 0);
}

/**
 * Human age label used across the patient views. Under two years old the age is
 * shown in months, because the immunization schedule is month-based.
 */
export function ageLabel(dob: string | Date | null | undefined): string {
  if (!dob) return "—";
  const months = monthsFromDOB(dob);
  if (months < 24) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `${years} year${years === 1 ? "" : "s"}` : `${years}y ${rest}m`;
}
