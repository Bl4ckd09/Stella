#!/usr/bin/env bash
# Create the Stella voice agent via the ElevenLabs API, wired to the
# /api/voice-lookup server tool. Idempotent-ish: prints the new agent_id.
#
# Prereqs (env): ELEVENLABS_API_KEY, APP_URL (your deployed https URL),
#                VOICE_TOOL_SECRET (same value as in your Vercel env).
#
# Usage: ELEVENLABS_API_KEY=... APP_URL=https://stella.vercel.app \
#        VOICE_TOOL_SECRET=... ./create-agent.sh
set -euo pipefail

: "${ELEVENLABS_API_KEY:?set ELEVENLABS_API_KEY}"
: "${APP_URL:?set APP_URL (e.g. https://stella.vercel.app)}"
: "${VOICE_TOOL_SECRET:?set VOICE_TOOL_SECRET}"

PROMPT=$(cat "$(dirname "$0")/agent-prompt.md")
FIRST_MSG="Hi, this is Stella. I can check what business-rates relief your company might be missing. What's the name of your business?"

read -r -d '' BODY <<JSON || true
{
  "name": "Stella — Business Relief",
  "conversation_config": {
    "agent": {
      "first_message": "${FIRST_MSG}",
      "prompt": {
        "prompt": $(printf '%s' "$PROMPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
        "tools": [
          {
            "type": "webhook",
            "name": "lookup_business",
            "description": "Look up a UK business by name (and optional postcode) and return the business-rates relief and grants it can claim. Read the spoken_summary back; never invent numbers.",
            "api_schema": {
              "url": "${APP_URL}/api/voice-lookup",
              "method": "POST",
              "request_headers": {
                "Content-Type": "application/json",
                "X-Tool-Secret": "${VOICE_TOOL_SECRET}"
              },
              "request_body_schema": {
                "type": "object",
                "required": ["business_name"],
                "properties": {
                  "business_name": { "type": "string", "description": "Business name as spoken." },
                  "postcode": { "type": "string", "description": "UK postcode of premises, optional." }
                }
              }
            }
          }
        ]
      }
    }
  }
}
JSON

curl -sS -X POST "https://api.elevenlabs.io/v1/convai/agents/create" \
  -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "${BODY}" | python3 -m json.tool
