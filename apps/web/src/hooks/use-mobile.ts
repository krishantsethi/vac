"use client";

import { useState, useEffect } from "react";

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)");
    setIsMobile(mql.matches);
    const h = () => setIsMobile(mql.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);
  return isMobile;
}
