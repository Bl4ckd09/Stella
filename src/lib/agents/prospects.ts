/**
 * Seeded inbound prospects for the autonomous demo.
 *
 * These are realistic London small businesses with real rateable values and
 * sectors. Crucially, the £ figures the agents quote are NOT baked in here —
 * each prospect is fed through the same deterministic relief engine the rest of
 * Stella uses (`assess()`), so every number the workforce handles is computed,
 * not invented. This keeps the demo self-contained (no DB required) while
 * honouring the sacred money rule.
 *
 * Each prospect also carries a CONSENT flag and its source. Sourcing a premise
 * from public VOA data is fine, but the PRD bans cold outreach — so the
 * workforce may only call/message owners who opted in. The mix includes a
 * couple of eligible-but-non-consented businesses so the system visibly refuses
 * to contact them (→ needs_optin) rather than cold-calling.
 */
import type { ProspectBusiness } from "./types";

export const SEED_PROSPECTS: ProspectBusiness[] = [
  {
    name: "The Daily Grind Coffee", postcode: "E8 3RH", borough: "Hackney", sector: "cafe",
    rateableValue: 11500, uarn: "DEMO-0001", address: "42 Mare Street, London", contact: "Priya Sharma",
    phone: "+447700900001", channel: "whatsapp", consent: true, consentSource: "web scan opt-in",
  },
  {
    name: "Camden Vinyl Records", postcode: "NW1 8AH", borough: "Camden", sector: "retail",
    rateableValue: 13200, uarn: "DEMO-0002", address: "9 Inverness Street, London", contact: "Marcus Bell",
    phone: "+447700900002", channel: "voice", consent: true, consentSource: "phone callback request",
  },
  {
    name: "The Crown & Anchor", postcode: "SE1 1TE", borough: "Southwark", sector: "pub",
    rateableValue: 9800, uarn: "DEMO-0003", address: "17 Union Street, London", contact: "Eddie Doyle",
    phone: "+447700900003", channel: "voice", consent: true, consentSource: "partner referral (consent confirmed)",
  },
  {
    name: "Brixton Bloom Florist", postcode: "SW9 8PR", borough: "Lambeth", sector: "retail",
    rateableValue: 8200, uarn: "DEMO-0004", address: "3 Atlantic Road, London", contact: "Naomi Clarke",
    channel: "email", consent: true, consentSource: "web scan opt-in",
  },
  {
    name: "Northcote Pilates Studio", postcode: "SW11 6QW", borough: "Wandsworth", sector: "leisure",
    rateableValue: 12800, uarn: "DEMO-0005", address: "88 Northcote Road, London", contact: "Hannah Reid",
    phone: "+447700900005", channel: "whatsapp", consent: true, consentSource: "web scan opt-in",
  },
  {
    name: "Greenwich Gelato", postcode: "SE10 9HT", borough: "Greenwich", sector: "cafe",
    rateableValue: 11900, uarn: "DEMO-0006", address: "5 Greenwich Church Street, London", contact: "Luca Romano",
    channel: "email", consent: false, consentSource: "",
  },
  {
    name: "Soho Snip Barbers", postcode: "W1F 8WB", borough: "Westminster", sector: "retail",
    rateableValue: 10500, uarn: "DEMO-0007", address: "21 Berwick Street, London", contact: "Dev Patel",
    phone: "+447700900007", channel: "voice", consent: true, consentSource: "phone callback request",
  },
  {
    name: "Peckham Vintage", postcode: "SE15 4ST", borough: "Southwark", sector: "retail",
    rateableValue: 7400, uarn: "DEMO-0008", address: "12 Rye Lane, London", contact: "Tasha Owusu",
    channel: "email", consent: true, consentSource: "web scan opt-in",
  },
  {
    name: "The Print Room", postcode: "N1 7GU", borough: "Islington", sector: "industrial",
    rateableValue: 13500, uarn: "DEMO-0009", address: "60 Roseberry Avenue, London", contact: "Greg Wallace",
    channel: "email", consent: false, consentSource: "",
  },
  {
    name: "Threadneedle Tailors", postcode: "EC2R 8AH", borough: "City of London", sector: "retail",
    rateableValue: 15500, uarn: "DEMO-0010", address: "4 Threadneedle Street, London", contact: "Arthur Finch",
    channel: "email", consent: true, consentSource: "web scan opt-in",
  },
  {
    name: "The Workshop Co-Lab", postcode: "E1 6QL", borough: "Tower Hamlets", sector: "office",
    rateableValue: 16500, uarn: "DEMO-0011", address: "33 Commercial Street, London", contact: "Sofia Mendes",
    channel: "email", consent: true, consentSource: "web scan opt-in",
  },
  {
    name: "Hackney Wick Brewing", postcode: "E9 5EN", borough: "Hackney", sector: "pub",
    rateableValue: 14200, uarn: "DEMO-0012", address: "26 Wallis Road, London", contact: "Joel Adeyemi",
    phone: "+447700900012", channel: "voice", consent: true, consentSource: "partner referral (consent confirmed)",
  },
];

/** A fresh deep copy of the seed list (avoids mutating the module constant). */
export function freshBacklog(): ProspectBusiness[] {
  return SEED_PROSPECTS.map((p) => ({ ...p }));
}

/** Synthesise a plausible council apply URL from a borough name. */
export function councilApplyUrl(borough: string): string {
  const slug = borough.toLowerCase().replace(/[^a-z]+/g, "");
  return `https://www.${slug}.gov.uk/business-rates-relief`;
}
