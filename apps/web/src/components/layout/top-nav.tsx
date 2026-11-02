"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Menu, ChevronDown, LogOut, Settings as SettingsIcon, Globe } from "lucide-react";
import { getUser, removeToken } from "@/lib/auth";
import { API } from "@/lib/api";
import { cn, formatDateIN } from "@/lib/utils";

const TITLES: { match: string; title: string }[] = [
  { match: "/app/patients", title: "Patients" },
  { match: "/app/family", title: "Family Profiles" },
  { match: "/app/vaccinations", title: "Vaccination Records" },
  { match: "/app/schedule", title: "Schedule" },
  { match: "/app/documents", title: "Documents" },
  { match: "/app/record-verification", title: "Record Verification" },
  { match: "/app/outreach", title: "Outreach" },
  { match: "/app/appointments", title: "Appointments" },
  { match: "/app/inventory", title: "Inventory" },
  { match: "/app/analytics", title: "Analytics" },
  { match: "/app/notifications", title: "Notifications" },
  { match: "/app/settings", title: "Settings" },
  { match: "/app/audit-logs", title: "Audit Logs" },
];

export function TopNav({ onMenu }: { onMenu: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [lang, setLang] = useState<"en" | "hi">("en");
  const pathname = usePathname();
  const router = useRouter();
  const user = getUser();
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.language === "hi") setLang("hi");
  }, [user?.language]);

  useEffect(() => {
    let cancelled = false;
    API.get("/api/v1/notifications")
      .then((res) => {
        if (!cancelled) setNotifications(Array.isArray(res) ? res : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const title =
    TITLES.find((t) => pathname.startsWith(t.match))?.title ??
    "Vaccination Intelligence Overview";

  const unread = notifications.filter((n) => !n.is_read).length;

  const handleSignOut = () => {
    removeToken();
    router.push("/login");
  };

  const markRead = async (id: string) => {
    try {
      await API.patch(`/api/v1/notifications/${id}/read`, {});
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch {
      // ignore
    }
  };

  const t = (en: string, hi: string) => (lang === "hi" ? hi : en);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-navy/85 px-4 backdrop-blur-md md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onMenu}
          className="rounded-md p-2 text-text-secondary transition-colors hover:bg-surface hover:text-cyan md:hidden"
          aria-label={t("Open navigation menu", "नेविगेशन मेनू खोलें")}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate font-display text-base font-semibold text-text md:text-lg">
            {title}
          </h1>
          <p className="hidden truncate text-[11px] text-text-secondary/70 sm:block">
            {t(
              "Demonstration environment — synthetic data only",
              "प्रदर्शन वातावरण — केवल सिंथेटिक डेटा"
            )}
          </p>
        </div>
        <span className="hidden shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400 lg:inline-flex">
          Demo
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setLang(lang === "en" ? "hi" : "en")}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-cyan/40 hover:text-cyan"
          aria-label={t("Switch language", "भाषा बदलें")}
        >
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="uppercase">{lang}</span>
        </button>

        <div className="relative" ref={bellRef}>
          <button
            onClick={() => setBellOpen((o) => !o)}
            className="relative rounded-md border border-border p-2 text-text-secondary transition-colors hover:border-cyan/40 hover:text-cyan"
            aria-label={t("Notifications", "सूचनाएँ")}
            aria-expanded={bellOpen}
            aria-haspopup="true"
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan px-1 text-[10px] font-bold text-navy">
                {unread}
              </span>
            )}
          </button>
          {bellOpen && (
            <div className="absolute right-0 mt-2 w-80 rounded-lg border border-border bg-surface shadow-xl">
              <div className="border-b border-border/60 px-4 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  {t("Notifications", "सूचनाएँ")}
                </p>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 && (
                  <p className="px-4 py-6 text-center text-xs text-text-secondary/60">
                    {t("No notifications yet.", "अभी कोई सूचना नहीं।")}
                  </p>
                )}
                {notifications.slice(0, 8).map((n) => (
                  <div
                    key={n.id}
                    className={cn(
                      "border-b border-border/40 px-4 py-3 last:border-0",
                      !n.is_read && "bg-cyan/5"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-text">{n.title}</p>
                      {!n.is_read && (
                        <button
                          onClick={() => markRead(n.id)}
                          className="shrink-0 text-[10px] text-cyan hover:underline"
                        >
                          {t("Mark read", "पढ़ा हुआ चिह्नित करें")}
                        </button>
                      )}
                    </div>
                    {n.message && (
                      <p className="mt-1 text-[11px] leading-relaxed text-text-secondary/80">
                        {n.message}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-text-secondary/50">
                      {formatDateIN(n.created_at)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="border-t border-border/60 p-2">
                <Link
                  href="/app/notifications"
                  onClick={() => setBellOpen(false)}
                  className="block rounded px-3 py-1.5 text-center text-xs text-text-secondary hover:bg-surface/60 hover:text-cyan"
                >
                  {t("View all notifications", "सभी सूचनाएँ देखें")}
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm transition-colors hover:border-cyan/40"
            aria-expanded={menuOpen}
            aria-haspopup="true"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan/15 text-[11px] font-bold text-cyan">
              {(user?.full_name || "U").charAt(0).toUpperCase()}
            </span>
            <span className="hidden max-w-[10rem] truncate text-xs text-text sm:inline">
              {user?.full_name || "User"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-text-secondary" aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-surface py-1 shadow-xl">
              <div className="border-b border-border/60 px-4 py-2.5">
                <p className="truncate text-xs font-medium text-text">{user?.email}</p>
              </div>
              <Link
                href="/app/settings"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-xs text-text-secondary hover:bg-surface/60 hover:text-cyan"
              >
                <SettingsIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {t("Settings", "सेटिंग्स")}
              </Link>
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-red-400 hover:bg-red-500/10"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                {t("Sign out", "साइन आउट")}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
