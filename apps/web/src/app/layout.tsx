import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toast } from "@/components/ui/toast";
import { ServiceWorkerRegister } from "@/components/app/service-worker-register";
import { StorageHydrate } from "@/components/app/storage-hydrate";

export const viewport: Viewport = {
  themeColor: "#0B1728",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "VAXBRIDGE AI — Intelligent Immunization Infrastructure",
  manifest: "/manifest.webmanifest",
  applicationName: "VAXBRIDGE AI",
  description:
    "Turn every vaccination gap into a clear next step. Unify records, resolve uncertainty, and prioritize follow-up.",
  keywords: ["vaccination", "immunization", "healthcare", "records"],
  openGraph: {
    title: "VAXBRIDGE AI",
    description: "Intelligent vaccination management and record reconciliation",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <StorageHydrate />
        <ServiceWorkerRegister />
        {children}
        <Toast />
      </body>
    </html>
  );
}
