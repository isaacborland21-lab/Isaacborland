import type { Metadata } from "next";

// Private client links: never index them.
export const metadata: Metadata = {
  title: "Graffiti removal map",
  robots: { index: false, follow: false },
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
