import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./auth-shell.css";
import "./theme.css";

export const metadata: Metadata = {
  title: "FlexFlow UI",
  description: "Admin portal for server-driven mobile UI"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `try { const saved = localStorage.getItem("flexflow-theme"); document.documentElement.dataset.theme = saved === "light" || saved === "dark" ? saved : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); } catch { document.documentElement.dataset.theme = "light"; }` }} /></head>
      <body>{children}</body>
    </html>
  );
}

