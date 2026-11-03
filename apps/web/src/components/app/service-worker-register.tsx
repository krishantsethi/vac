"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production, and removes it in development.
 *
 * The dev branch matters more than it looks. A worker registered during any
 * production run stays installed in the browser indefinitely — it survives
 * reloads, server restarts and rebuilds, and the page that registered it does
 * not have to exist any more for it to keep controlling the origin. Since this
 * component only registers in production, a dev session would never unregister
 * one, so a worker left over from an earlier build keeps serving a cached app
 * shell while the source on disk has moved on.
 *
 * That failure is invisible and total: the developer edits code, the served
 * bundle contains the edit, and the browser still runs the old one. Clearing it
 * in dev makes the running page match the source.
 *
 * Offline *capture* is unaffected either way — that queue lives in local
 * storage (src/lib/offline.ts), not in the worker.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    const hasSw = "serviceWorker" in navigator;

    // Development: make sure nothing is intercepting requests or serving a
    // cached shell, so the browser always runs the code currently on disk.
    if (process.env.NODE_ENV !== "production") {
      if (!hasSw) return;
      (async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
          if ("caches" in window) {
            for (const key of await caches.keys()) {
              await caches.delete(key);
            }
          }
          if (registrations.length > 0) {
            // Worth saying out loud: it explains why a previously "cached" app
            // suddenly needs the network again.
            console.info(
              `[VAXBRIDGE] Development mode: unregistered ${registrations.length} service worker(s) and cleared their caches so the page runs the current build.`
            );
          }
        } catch (error) {
          console.warn("[VAXBRIDGE] Could not clear a stale service worker:", error);
        }
      })();
      return;
    }

    if (!hasSw) return;
    // Service workers require a secure context; an unsupported or blocked
    // registration must never break the app.
    if (!window.isSecureContext) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

        registration.addEventListener("updatefound", () => {
          const incoming = registration.installing;
          if (!incoming) return;
          incoming.addEventListener("statechange", () => {
            if (incoming.state === "installed" && navigator.serviceWorker.controller) {
              // A new shell is ready; take it on the next navigation rather than
              // swapping assets underneath a running page.
              incoming.postMessage?.("skip-waiting");
            }
          });
        });
      } catch (error) {
        // Reported, not swallowed: silent failure here would leave users
        // believing the app works offline when it does not.
        console.warn("Service worker registration failed:", error);
      }
    };

    // Deferred so registration never competes with first paint.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  return null;
}
