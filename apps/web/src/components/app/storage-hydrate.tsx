"use client";

/**
 * Loads the durable client store once, as early as possible.
 *
 * The offline queue reads synchronously from an in-memory mirror, so that mirror
 * has to be filled before any page tries to render a queued-dose count. Hydrating
 * here — in the root layout, ahead of the app shell — is what makes that true.
 *
 * Renders nothing. A storage failure is not fatal: the store falls back to
 * memory and reports that honestly through offlineStorageState(), which the
 * offline banner surfaces rather than hiding.
 */
import { useEffect } from "react";
import { hydrate } from "@/lib/persistent-store";

export function StorageHydrate() {
  useEffect(() => {
    void hydrate();
  }, []);
  return null;
}
