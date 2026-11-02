"use client";

import { useEffect } from "react";

/**
 * Registers the service worker.
 *
 * Production only. In development a caching worker would serve stale bundles
 * across hot reloads and make ordinary debugging unreliable, so it is not
 * registered there — offline *capture* still works in dev because the queue is
 * plain local storage, not a worker.
 *
 * Renders nothing: it is a side effect, not UI.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // An unsupported or blocked registration must never break the app.
    if (typeof window === "undefined" || !window.isSecureContext) return;

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
