import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neev — Identity Reconstruction",
  description: "A bilingual, evidence-first guide for reconstructing identity document pathways in India.",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
