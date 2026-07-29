import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const targets = [
  ["stt", process.env.VOXTRAL_STT_URL, "/v1/models", true],
  ["tts", process.env.VOXTRAL_TTS_URL, "/v1/models", true],
  ["gateway", process.env.VOXTRAL_GATEWAY_URL, "/health", false],
];

const proxyHeaders = process.env.MODAL_PROXY_KEY && process.env.MODAL_PROXY_SECRET
  ? { "Modal-Key": process.env.MODAL_PROXY_KEY, "Modal-Secret": process.env.MODAL_PROXY_SECRET }
  : {};

async function warm([name, baseUrl, path, privateEndpoint]) {
  if (!baseUrl) throw new Error(`${name} URL is not set`);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    headers: privateEndpoint ? proxyHeaders : {},
    signal: AbortSignal.timeout(20 * 60 * 1000),
  });
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  return `${name}: ready`;
}

const results = await Promise.all(targets.map(warm));
for (const result of results) console.log(result);
