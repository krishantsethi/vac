"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Home,
  ClipboardList,
  Calendar,
  FileText,
  ShieldCheck,
  PhoneCall,
  CalendarCheck,
  Package,
  BarChart3,
  Bell,
  Settings,
  ScrollText,
  QrCode,
  X,
  Syringe,
} from "lucide-react";
import { getUser, removeToken } from "@/lib/auth";
import { API } from "@/lib/api";
import { cn } from "@/lib/utils";

type Role =
  | "system_admin"
  | "clinic_admin"
  | "public_health_admin"
  | "healthcare_worker"
  | "patient"
  | "caregiver";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: readonly string[];
  group: string;
}

/**
 * Navigation visibility.
 *
 * These lists mirror the capability sets the API enforces, so the sidebar never
 * offers a destination the server will refuse. This is presentation only: the
 * server re-checks every request, and a hidden link is not a security control.
 *
 * `system_admin` is deliberately absent from the clinical entries. Administering
 * the platform does not grant access to patient health data.
 */
const CLINICAL: readonly string[] = ["healthcare_worker", "clinic_admin", "public_health_admin"];
const PATIENT_SIDE: readonly string[] = ["patient", "caregiver"];
const CLINICAL_AND_FAMILIES: readonly string[] = [...CLINICAL, ...PATIENT_SIDE];

interface NavSection {
  group: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    group: "Workspace",
    items: [
      { label: "Overview", href: "/app", icon: LayoutDashboard, group: "Workspace" },
      { label: "Patients", href: "/app/patients", icon: Users, group: "Workspace", roles: CLINICAL_AND_FAMILIES },
      { label: "Family Profiles", href: "/app/family", icon: Home, group: "Workspace", roles: CLINICAL_AND_FAMILIES },
    ],
  },
  {
    group: "Records",
    items: [
      { label: "Vaccination Records", href: "/app/vaccinations", icon: ClipboardList, group: "Records", roles: CLINICAL_AND_FAMILIES },
      { label: "Schedule", href: "/app/schedule", icon: Calendar, group: "Records" },
      { label: "Documents", href: "/app/documents", icon: FileText, group: "Records" },
      { label: "Record Verification", href: "/app/record-verification", icon: ShieldCheck, group: "Records", roles: CLINICAL },
      { label: "Digital Record", href: "/app/digital-record", icon: QrCode, group: "Records", roles: PATIENT_SIDE },
    ],
  },
  {
    group: "Operations",
    items: [
      { label: "Outreach", href: "/app/outreach", icon: PhoneCall, group: "Operations", roles: CLINICAL },
      { label: "Appointments", href: "/app/appointments", icon: CalendarCheck, group: "Operations" },
      { label: "Inventory", href: "/app/inventory", icon: Package, group: "Operations", roles: CLINICAL },
      { label: "Analytics", href: "/app/analytics", icon: BarChart3, group: "Operations", roles: CLINICAL },
    ],
  },
  {
    group: "Role workspace",
    items: [
      { label: "Field Workspace", href: "/app/worker", icon: ClipboardList, group: "Role workspace", roles: ["healthcare_worker"] },
      { label: "Clinic Workspace", href: "/app/clinic", icon: Users, group: "Role workspace", roles: ["clinic_admin"] },
      { label: "Public-Health Workspace", href: "/app/public-health", icon: BarChart3, group: "Role workspace", roles: ["public_health_admin"] },
      { label: "Admin Workspace", href: "/app/admin", icon: ShieldCheck, group: "Role workspace", roles: ["system_admin"] },
    ],
  },
  {
    group: "Account",
    items: [
      { label: "Notifications", href: "/app/notifications", icon: Bell, group: "Account" },
      { label: "Settings", href: "/app/settings", icon: Settings, group: "Account" },
      { label: "Audit Logs", href: "/app/audit-logs", icon: ScrollText, group: "Account", roles: ["system_admin", "clinic_admin", "public_health_admin"] },
    ],
  },
];

/** Flat list, kept for the existing filter/active-path helpers. */
const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

const ROLE_LABELS: Record<string, string> = {
  system_admin: "System Administrator",
  clinic_admin: "Clinic Administrator",
  public_health_admin: "Public-Health Administrator",
  healthcare_worker: "Healthcare Worker",
  patient: "Patient",
  caregiver: "Caregiver",
};

function prettyRole(role?: string | null) {
  if (!role) return "User";
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const user = getUser();
  const role = user?.role ?? "patient";

  const items = NAV_ITEMS.filter((n) => !n.roles || n.roles.includes(role));
  const groups = Array.from(new Set(items.map((i) => i.group)));

  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(href + "/");

  const handleSignOut = async () => {
    // The session also lives in an httpOnly cookie that JavaScript cannot delete,
    // so the API is asked to clear it. Dropping only the local token would leave
    // the cookie valid and the next /auth/me would sign the user straight back in.
    onClose();
    await API.logout();
    removeToken();
    router.push("/login");
  };

  return (
    <>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-navy transition-transform duration-300",
          "md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-16 items-center justify-between border-b border-border/60 px-5">
          <Link href="/app" className="flex items-center gap-2">
            <Syringe className="h-5 w-5 text-cyan" aria-hidden="true" />
            <span className="font-display text-base font-bold tracking-tight text-text">
              VAXBRIDGE<span className="text-cyan"> AI</span>
            </span>
          </Link>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-text-secondary hover:bg-surface hover:text-text md:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group}>
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary/60">
                {group}
              </p>
              <div className="space-y-0.5">
                {items
                  .filter((i) => i.group === group)
                  .map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onClose}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-cyan/10 text-cyan"
                            : "text-text-secondary hover:bg-surface/60 hover:text-text"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-border/60 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan/15 text-sm font-bold text-cyan">
              {(user?.full_name || "U").charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text">{user?.full_name || "User"}</p>
              <p className="truncate text-[11px] text-text-secondary/70">{prettyRole(role)}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="mt-3 w-full rounded-md border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-cyan/40 hover:text-cyan"
          >
            Sign out
          </button>
          <p className="mt-3 text-[10px] leading-relaxed text-text-secondary/50">
            Demonstration environment with synthetic data.
          </p>
        </div>
      </aside>

      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
    </>
  );
}
