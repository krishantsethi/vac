import { PatientProfilePage } from "../../(pages)/patient-profile";

export const metadata = { title: "Patient Record — VAXBRIDGE AI" };

/**
 * The profile reads its own `id` from useParams so it stays usable both as a
 * route and as an embedded panel.
 */
export default function Page() {
  return <PatientProfilePage />;
}
