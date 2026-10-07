import type { Metadata } from "next";
import { DemoClient } from "./demo-client";

export const metadata: Metadata = {
  title: "Live demo",
  description:
    "Try Stele Proof and Stele Gate with real transactions on a Solana test network: publish, accept, verify, and watch a direct bypass fail.",
};

export default function DemoPage() {
  return <DemoClient />;
}
