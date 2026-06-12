"use client";

import { useEffect } from "react";

/**
 * Embeds the ElevenLabs Conversational AI widget (the in-browser voice + chat
 * version of the Stella phone agent). Injects the custom element + embed script
 * on mount. The agent is public (enable_auth: false), so the widget connects
 * with just the agent id — which is not a secret (it ships to the browser).
 */
const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "agent_7001kty498d4fdmsmed15mf47k1c";

export default function ConvaiWidget() {
  useEffect(() => {
    if (document.querySelector("elevenlabs-convai")) return;

    const widget = document.createElement("elevenlabs-convai");
    widget.setAttribute("agent-id", AGENT_ID);
    document.body.appendChild(widget);

    const existing = document.querySelector(
      'script[src^="https://unpkg.com/@elevenlabs/convai-widget-embed"]',
    );
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/@elevenlabs/convai-widget-embed";
      script.async = true;
      script.type = "text/javascript";
      document.body.appendChild(script);
    }
  }, []);

  return null;
}
