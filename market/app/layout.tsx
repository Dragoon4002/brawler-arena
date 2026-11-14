import type { Metadata, Viewport } from "next";
import { Lilita_One, Nunito } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const lilita = Lilita_One({ weight: "400", subsets: ["latin"], variable: "--font-lilita" });
const nunito = Nunito({ weight: ["400", "700", "800"], subsets: ["latin"], variable: "--font-nunito" });

export const metadata: Metadata = { title: "Shop", description: "Trade game skills and monsters on NEAR." };
export const viewport: Viewport = { themeColor: "#140f24" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lilita.variable} ${nunito.variable}`}>
      <body className="antialiased">
        <noscript>Shop needs JavaScript.</noscript>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
