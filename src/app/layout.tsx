import type { Metadata } from "next";
import "./globals.css";
import VoxtralVoiceWidget from "@/components/VoxtralVoiceWidget";

export const metadata: Metadata = {
  title: "Stella — Unclaimed Business Money",
  description:
    "Find unclaimed Small Business Rate Relief and grants for your London business. Enter your business name to see what you can claim.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <VoxtralVoiceWidget />
      </body>
    </html>
  );
}
