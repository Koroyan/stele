import type { Metadata } from "next";
import { HowItWorks } from "./how-client";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Stele Proof: publish, accept, record, verify. Stele Gate: protect, check, accept if required, continue, enforce.",
};

export default function HowItWorksPage() {
  return <HowItWorks />;
}
