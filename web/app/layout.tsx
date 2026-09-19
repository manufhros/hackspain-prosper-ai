import type { Metadata } from "next";
import { Bungee, DM_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Celebration } from "@/components/prosper/celebration";
import { Nav } from "@/components/prosper/nav";
import { Providers } from "@/components/prosper/providers";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const bungee = Bungee({
  variable: "--font-bungee",
  subsets: ["latin"],
  weight: "400",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Prosper · hash",
  description: "Panel del equipo hash para HackSpain '26 — runs, tests, problemas y clínica",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${dmSans.variable} ${bungee.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full">
        <Providers>
          <div className="h-full overflow-auto">
            <Nav />
            <Celebration />
            <main className="mx-auto max-w-7xl p-6">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
