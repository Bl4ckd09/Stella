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
 * The mix is deliberate: full-SBRR cases, taper cases, a qualifying pub, a
 * revaluation-cliff wedge, a City of London special case, and a couple with no
 * claimable annual relief so the workforce visibly DISQUALIFIES them rather than
 * inventing an opportunity.
 */
import type { ProspectBusiness } from "./types";

export const SEED_PROSPECTS: ProspectBusiness[] = [
  {
    name: "The Daily Grind Coffee",
    postcode: "E8 3RH",
    borough: "Hackney",
    sector: "cafe",
    rateableValue: 11500,
    uarn: "DEMO-0001",
    address: "42 Mare Street, London",
    contact: "Priya Sharma",
  },
  {
    name: "Camden Vinyl Records",
    postcode: "NW1 8AH",
    borough: "Camden",
    sector: "retail",
    rateableValue: 13200,
    uarn: "DEMO-0002",
    address: "9 Inverness Street, London",
    contact: "Marcus Bell",
  },
  {
    name: "The Crown & Anchor",
    postcode: "SE1 1TE",
    borough: "Southwark",
    sector: "pub",
    rateableValue: 9800,
    uarn: "DEMO-0003",
    address: "17 Union Street, London",
    contact: "Eddie Doyle",
  },
  {
    name: "Brixton Bloom Florist",
    postcode: "SW9 8PR",
    borough: "Lambeth",
    sector: "retail",
    rateableValue: 8200,
    uarn: "DEMO-0004",
    address: "3 Atlantic Road, London",
    contact: "Naomi Clarke",
  },
  {
    name: "Northcote Pilates Studio",
    postcode: "SW11 6QW",
    borough: "Wandsworth",
    sector: "leisure",
    rateableValue: 12800,
    uarn: "DEMO-0005",
    address: "88 Northcote Road, London",
    contact: "Hannah Reid",
  },
  {
    name: "Greenwich Gelato",
    postcode: "SE10 9HT",
    borough: "Greenwich",
    sector: "cafe",
    rateableValue: 11900,
    uarn: "DEMO-0006",
    address: "5 Greenwich Church Street, London",
    contact: "Luca Romano",
  },
  {
    name: "Soho Snip Barbers",
    postcode: "W1F 8WB",
    borough: "Westminster",
    sector: "retail",
    rateableValue: 10500,
    uarn: "DEMO-0007",
    address: "21 Berwick Street, London",
    contact: "Dev Patel",
  },
  {
    name: "Peckham Vintage",
    postcode: "SE15 4ST",
    borough: "Southwark",
    sector: "retail",
    rateableValue: 7400,
    uarn: "DEMO-0008",
    address: "12 Rye Lane, London",
    contact: "Tasha Owusu",
  },
  {
    name: "The Print Room",
    postcode: "N1 7GU",
    borough: "Islington",
    sector: "industrial",
    rateableValue: 13500,
    uarn: "DEMO-0009",
    address: "60 Roseberry Avenue, London",
    contact: "Greg Wallace",
  },
  {
    name: "Threadneedle Tailors",
    postcode: "EC2R 8AH",
    borough: "City of London",
    sector: "retail",
    rateableValue: 15500,
    uarn: "DEMO-0010",
    address: "4 Threadneedle Street, London",
    contact: "Arthur Finch",
  },
  {
    name: "The Workshop Co-Lab",
    postcode: "E1 6QL",
    borough: "Tower Hamlets",
    sector: "office",
    rateableValue: 16500,
    uarn: "DEMO-0011",
    address: "33 Commercial Street, London",
    contact: "Sofia Mendes",
  },
  {
    name: "Hackney Wick Brewing",
    postcode: "E9 5EN",
    borough: "Hackney",
    sector: "pub",
    rateableValue: 14200,
    uarn: "DEMO-0012",
    address: "26 Wallis Road, London",
    contact: "Joel Adeyemi",
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
