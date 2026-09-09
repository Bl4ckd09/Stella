import type { Metadata } from "next";
import "./globals.css";
import ConvaiWidget from "@/components/ConvaiWidget";
import MistralVoiceWidget from "@/components/MistralVoiceWidget";

export const metadata: Metadata = {
  title: "Stella — Unclaimed Business Money",
  description:
    "Find unclaimed Small Business Rate Relief and grants for your London business. Enter your business name to see what you can claim.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const VoiceWidget = process.env.NEXT_PUBLIC_VOICE_PROVIDER === "elevenlabs"
    ? ConvaiWidget
    : MistralVoiceWidget;

  return (
    <html lang="en">
      <body>
        {children}
        <VoiceWidget />
      </body>
    </html>
  );
}
