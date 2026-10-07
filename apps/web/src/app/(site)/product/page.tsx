import { permanentRedirect } from "next/navigation";

/** The former product overview: Stele Proof and Stele Gate now have their own pages. */
export default function ProductPage() {
  permanentRedirect("/proof");
}
