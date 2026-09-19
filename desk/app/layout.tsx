import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-brand",
});

export const metadata: Metadata = {
  title: "hash — la línea de citas del hospital",
  description: "hash atiende el teléfono de citas del hospital",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={manrope.variable}>
      <body>
        <Suspense>{children}</Suspense>
      </body>
    </html>
  );
}
