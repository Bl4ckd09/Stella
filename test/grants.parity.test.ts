import { describe, it, expect } from "vitest";
import fixtures from "./fixtures/grant_fixtures.json";
import { matchGrants, type MatchGrantsInput, type GrantMatch } from "../src/lib/engines/grants";

interface GrantCase {
  input: {
    sector: string;
    sic_codes: string[];
    borough: string;
    rateable_value: number;
    company_age_years: number | null;
    company_type: string;
    company_name: string;
  };
  grant_names: string[];
  eligibilities: string[];
  full: Record<string, unknown>[];
}

const cases = fixtures as GrantCase[];

describe("grants engine parity with Python original", () => {
  for (const c of cases) {
    const label = c.input.company_name || "empty";
    it(`grant set + order: ${label}`, () => {
      const got = matchGrants(c.input as MatchGrantsInput);
      expect(got.map((g) => g.name)).toEqual(c.grant_names);
      expect(got.map((g) => g.eligibility)).toEqual(c.eligibilities);
    });

    it(`full grant objects: ${label}`, () => {
      const got = matchGrants(c.input as MatchGrantsInput) as unknown as Record<string, unknown>[];
      expect(got.length).toBe(c.full.length);
      got.forEach((g, i) => {
        const exp = c.full[i] as Partial<GrantMatch>;
        expect(g.name).toBe(exp.name);
        expect(g.funder).toBe(exp.funder);
        expect(g.value).toBe(exp.value);
        expect(g.eligibility).toBe(exp.eligibility);
        expect(g.match_reasons).toEqual(exp.match_reasons);
        expect(g.blockers).toEqual(exp.blockers);
        expect(g.action).toBe(exp.action);
        expect(g.url).toBe(exp.url);
        expect(g.deadline).toBe(exp.deadline);
      });
    });
  }
});
