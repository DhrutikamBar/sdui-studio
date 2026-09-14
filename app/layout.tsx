import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./auth-shell.css";

export const metadata: Metadata = {
  title: "SDUI Studio",
  description: "Admin portal for server-driven mobile UI"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

