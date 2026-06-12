import { describe, it, expect } from "vitest";
import fixtures from "./fixtures/relief_fixtures.json";
import { assess, grossBill, multiplier, sbrrPct, type Business } from "../src/lib/engines/relief";

interface ReliefCase {
  rv: number;
  sector: string;
  borough: string;
  multiplier: number;
  gross: number;
  sbrr_pct: number;
  findings: { headline: string; annual: number; back: number; conf: string; rule: string }[];
}

const cases = fixtures as ReliefCase[];

describe("relief engine parity with Python original", () => {
  it("has a non-trivial number of fixtures", () => {
    expect(cases.length).toBeGreaterThan(300);
  });

  for (const c of cases) {
    const label = `rv=${c.rv} sector=${c.sector} borough=${c.borough}`;
    it(`multiplier ${label}`, () => {
      expect(multiplier(c.rv, c.sector)).toBeCloseTo(c.multiplier, 6);
    });
    it(`gross bill ${label}`, () => {
      expect(grossBill(c.rv, c.sector)).toBeCloseTo(c.gross, 2);
    });
    it(`sbrr pct ${label}`, () => {
      expect(sbrrPct(c.rv)).toBeCloseTo(c.sbrr_pct, 9);
    });
    it(`findings ${label}`, () => {
      const biz: Business = {
        name: "Test",
        rateable_value: c.rv,
        borough: c.borough,
        sector: c.sector,
      };
      const got = assess(biz);
      expect(got.length).toBe(c.findings.length);
      got.forEach((f, i) => {
        const exp = c.findings[i];
        expect(f.headline).toBe(exp.headline);
        expect(f.annual_value).toBeCloseTo(exp.annual, 2);
        expect(f.backdated_value).toBeCloseTo(exp.back, 2);
        expect(f.confidence).toBe(exp.conf);
        expect(f.rule).toBe(exp.rule);
      });
    });
  }
});
