import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The agreement for using Stele — published, and accepted, with Stele itself.",
};

export default function TermsPage() {
  return (
    <LegalPage
      slug="terms-of-service"
      title="Terms of Service"
      lead="The agreement for using Stele. We publish it with Stele, and you accept it with Stele: every version is on Solana, and you can check the text below against it."
    />
  );
}
