#!/usr/bin/env bash
# Provision a phone number on Twilio and import it into ElevenLabs, assigned to
# the Stella agent. Run create-agent.sh first to get AGENT_ID.
#
# Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, ELEVENLABS_API_KEY, AGENT_ID
# Optional: COUNTRY (default GB), AREA_CODE (e.g. 20 for London)
set -euo pipefail

: "${TWILIO_ACCOUNT_SID:?}"; : "${TWILIO_AUTH_TOKEN:?}"
: "${ELEVENLABS_API_KEY:?}"; : "${AGENT_ID:?}"
COUNTRY="${COUNTRY:-GB}"

echo "1) Searching available ${COUNTRY} local numbers on Twilio…"
AVAIL=$(curl -sS -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
  "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/AvailablePhoneNumbers/${COUNTRY}/Local.json?VoiceEnabled=true&PageSize=1")
NUMBER=$(printf '%s' "$AVAIL" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["available_phone_numbers"][0]["phone_number"])')
echo "   Found: ${NUMBER}"

echo "2) Purchasing ${NUMBER}…  (this incurs Twilio charges ~£1/mo + usage)"
BUY=$(curl -sS -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
  -X POST "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json" \
  --data-urlencode "PhoneNumber=${NUMBER}")
echo "   Purchased."

echo "3) Importing the Twilio number into ElevenLabs and assigning the agent…"
curl -sS -X POST "https://api.elevenlabs.io/v1/convai/phone-numbers/create" \
  -H "xi-api-key: ${ELEVENLABS_API_KEY}" -H "Content-Type: application/json" \
  -d "{
        \"provider\": \"twilio\",
        \"phone_number\": \"${NUMBER}\",
        \"label\": \"Stella inbound\",
        \"sid\": \"${TWILIO_ACCOUNT_SID}\",
        \"token\": \"${TWILIO_AUTH_TOKEN}\",
        \"agent_id\": \"${AGENT_ID}\"
      }" | python3 -m json.tool

echo "Done. Call ${NUMBER} to reach the Stella agent."
