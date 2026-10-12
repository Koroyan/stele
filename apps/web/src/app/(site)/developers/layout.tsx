import type { ReactNode } from "react";
import { DevNav } from "@/components/developers/dev-nav";

export default function DevelopersLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DevNav />
      {children}
    </>
  );
}
