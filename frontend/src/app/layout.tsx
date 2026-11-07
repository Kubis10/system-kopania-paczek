import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Manrope, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "latin-ext"],
});

const geistMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "przesyłka. | Twoje centrum wysyłek",
  description: "Panel zarządzania przesyłkami kurierskimi. Nadawanie, śledzenie i bezpieczny odbiór.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
