import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What personal data Stele processes, why, and your rights.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      slug="privacy-policy"
      title="Privacy Policy"
      lead="What personal data Stele processes, why, and your rights. Published with Stele: every version is on Solana."
    />
  );
}
