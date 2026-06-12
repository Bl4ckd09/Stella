/**
 * Sector inference + name scoring — ported from server/app.py helpers.
 * Used by the lookup pipeline to derive a VOA sector and rank CH name matches.
 */

/** Score how well a CH company name matches the user's query (0-100). */
export function nameScore(query: string, result: string): number {
  const q = query.toLowerCase().trim();
  const r = result.toLowerCase().trim();
  if (q === r) return 100;
  if (r.includes(q) || r.startsWith(q)) return 85;
  const tokens = q.split(/\s+/).filter(Boolean);
  const matched = tokens.filter((t) => r.includes(t) && t.length > 2).length;
  return Math.floor((matched / Math.max(tokens.length, 1)) * 70);
}

/** Infer sector from business name when SIC codes are absent. */
export function nameToSector(name: string): string | null {
  const n = name.toLowerCase();
  const cafeWords = ["coffee", "cafe", "café", "espresso", "bistro", "restaurant", "kitchen",
    "bakery", "deli", "diner", "pizz", "sushi", "noodle", "taco", "burrito", "kebab"];
  const pubWords = ["pub", "bar", "inn", "tavern", "brewery", "tap room", "ale house"];
  const hotelWords = ["hotel", "hostel", "guest house", "b&b", "bed and breakfast", "lodge", "motel"];
  const leisureWords = ["gym", "fitness", "yoga", "pilates", "sport", "dance", "studio", "leisure", "spa", "clinic"];
  const retailWords = ["shop", "store", "boutique", "market", "gallery", "jewel", "fashion", "florist"];
  if (cafeWords.some((w) => n.includes(w))) return "cafe";
  if (pubWords.some((w) => n.includes(w))) return "pub";
  if (hotelWords.some((w) => n.includes(w))) return "hospitality";
  if (leisureWords.some((w) => n.includes(w))) return "leisure";
  if (retailWords.some((w) => n.includes(w))) return "retail";
  return null;
}

/** Derive VOA sector from Companies House SIC codes. */
export function sicToSector(sicCodes: string[]): string | null {
  for (const code of sicCodes) {
    const num = code.split(/\s+/)[0]?.trim() ?? "";
    if (num.startsWith("561") || num.startsWith("562")) return "cafe"; // restaurants, cafes, takeaway
    if (num.startsWith("563")) return "pub"; // bars/pubs
    if (num.startsWith("55")) return "hospitality";
    if (num.startsWith("47")) return "retail";
    if (num.startsWith("46")) return "retail"; // wholesale → proxy retail
    if (num.startsWith("931") || num.startsWith("932") || num.startsWith("933")) return "leisure";
    if (num.startsWith("90") || num.startsWith("91")) return "leisure";
    const mfg = ["10", "11", "12", "13", "14", "15", "16", "17", "18", "20", "21", "22",
      "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33"];
    if (mfg.some((p) => num.startsWith(p))) return "industrial";
  }
  return null;
}
