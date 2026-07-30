import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { LookupResult } from "../src/lib/lookup";
import {
  assess,
  totals,
  type Business,
} from "../src/lib/engines/relief";
import {
  matchGrants,
  type MatchGrantsInput,
} from "../src/lib/engines/grants";

const lookupMocks = vi.hoisted(() => ({
  isPostcode: vi.fn<(query: string) => boolean>(),
  run: vi.fn<(query: string) => Promise<LookupResult>>(),
  runByName: vi.fn<(query: string) => Promise<LookupResult>>(),
}));

vi.mock("../src/lib/lookup", () => lookupMocks);

import {
  handleAssessRelief,
  handleLookupBusiness,
  handleMatchGrants,
} from "../scripts/mcp-server";

function parseJsonText(result: CallToolResult): unknown {
  const content = result.content[0];
  if (!content || content.type !== "text") {
    throw new Error("Expected JSON text from the MCP tool.");
  }
  return JSON.parse(content.text);
}

describe("Stella MCP tool handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookupMocks.isPostcode.mockImplementation(
      (query) => query === "SW1A 1AA",
    );
  });

  it("keeps relief annual values unchanged", () => {
    const business: Business = {
      name: "The Stella Arms",
      rateable_value: 13_000,
      borough: "Westminster",
      sector: "pub",
      postcode: "SW1A 1AA",
    };
    const findings = assess(business);

    const result = parseJsonText(handleAssessRelief(business));

    expect(result).toEqual({ findings, totals: totals(findings) });
    expect(
      (result as { findings: typeof findings }).findings.map(
        (finding) => finding.annual_value,
      ),
    ).toEqual(findings.map((finding) => finding.annual_value));
  });

  it("passes grant matches through unchanged", () => {
    const input: MatchGrantsInput = {
      sector: "technology",
      sic_codes: ["62012"],
      borough: "Hackney",
      rateable_value: 12_000,
      company_age_years: 2,
      company_type: "ltd",
      company_name: "Stella Systems Ltd",
    };

    expect(parseJsonText(handleMatchGrants(input))).toEqual(
      matchGrants(input),
    );
  });

  it("routes postcodes to run and names to runByName", async () => {
    const postcodeResult: LookupResult = {
      query: "SW1A 1AA",
      query_type: "postcode",
      businesses: [],
      lsoa: null,
      error: "no_voa_entry_found",
    };
    const nameResult: LookupResult = {
      query: "Stella Cafe",
      query_type: "name",
      businesses: [],
      lsoa: null,
      error: "no_companies_house_match",
    };
    lookupMocks.run.mockResolvedValue(postcodeResult);
    lookupMocks.runByName.mockResolvedValue(nameResult);

    const postcodeResponse = await handleLookupBusiness({
      query: "SW1A 1AA",
    });
    const nameResponse = await handleLookupBusiness({
      query: "Stella Cafe",
    });

    expect(parseJsonText(postcodeResponse)).toEqual(postcodeResult);
    expect(parseJsonText(nameResponse)).toEqual(nameResult);
    expect(lookupMocks.run).toHaveBeenCalledWith("SW1A 1AA");
    expect(lookupMocks.runByName).toHaveBeenCalledWith("Stella Cafe");
  });
});
