"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { formatDateIN } from "@/lib/utils";

export function NotificationsPage() {
  const [notifs, setNotifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/api/v1/notifications");
        setNotifs(res);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  const markRead = async (id: string) => {
    try {
      await API.patch(`/api/v1/notifications/${id}/read`, {});
      setNotifs(notifs.map((n) => n.id === id ? { ...n, is_read: true } : n));
    } catch { /* ignore */ }
  };

  if (loading) return <div className="h-64 flex items-center justify-center"><span className="h-8 w-8 rounded-full border-4 border-cyan/30 border-t-cyan animate-[spin_1s_linear_infinite]" /></div>;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-bold text-text">Notifications</h1>
      <p className="text-text-secondary/90 text-sm">In-app notification center. Medical detail is minimized in notifications.</p>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-navy-secondary/50">
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Title</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Message</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Type</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Received</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {notifs.map((n) => (
              <tr key={n.id} className={`hover:bg-surface/30 transition-colors ${!n.is_read ? "bg-cyan/5" : ""}`}>
                <td className="px-4 py-3 text-text">{n.title}</td>
                <td className="px-4 py-3 text-text-secondary">{n.message}</td>
                <td className="px-4 py-3 text-text-secondary"><Badge variant={n.type === "alert" ? "critical" : n.type === "warning" ? "warn" : "default"}>{n.type}</Badge></td>
                <td className="px-4 py-3 text-text-secondary">{formatDateIN(n.created_at)}</td>
                <td className="px-4 py-3">
                  <Badge variant={n.is_read ? "verified" : "pending"}>{n.is_read ? "Read" : "Unread"}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {!n.is_read && (
                    <button onClick={() => markRead(n.id)} className="text-[10px] underline underline-offset-4 hover:text-cyan text-text-secondary">Mark read</button>
                  )}
                </td>
              </tr>
            ))}
            {!notifs.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-text-secondary/60">No notifications.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
