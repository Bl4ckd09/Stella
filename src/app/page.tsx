"use client";

import { useState } from "react";

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

interface Finding {
  headline: string;
  annual_value: number;
  backdated_value: number;
  confidence: string;
  action: string;
  explanation: string;
  source: string;
}
interface Property {
  uarn: string;
  name: string;
  address: string;
  postcode: string;
  borough: string;
  sector: string;
  rateable_value: number;
  findings: Finding[];
  totals: { total_annual_savings: number; total_backdated: number; highest_confidence: string };
}
interface Grant {
  name: string;
  funder: string;
  value: string;
  eligibility: string;
  match_reasons: string[];
  blockers: string[];
  action: string;
  url: string;
  deadline: string;
}
interface Analysis {
  step: "analysis";
  property: Property;
  biz_name: string;
  ch_verification: string;
  ch_note: string;
  grants: Grant[];
  council: { apply_url?: string; email?: string; phone?: string } | null;
}
interface PickProperty {
  step: "pick_property";
  properties: Property[];
  reason: string;
}

export default function Home() {
  const [name, setName] = useState("");
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [picker, setPicker] = useState<PickProperty | null>(null);
  const [letter, setLetter] = useState<string>("");
  const [letterLoading, setLetterLoading] = useState(false);

  async function lookup(uarn?: string) {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setPicker(null);
    setLetter("");
    try {
      const res = await fetch("/api/biz-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, postcode, uarn }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
      } else if (data.step === "pick_property") {
        setPicker(data);
      } else {
        setAnalysis(data);
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  async function generateLetter() {
    if (!analysis) return;
    setLetterLoading(true);
    setLetter("");
    const res = await fetch("/api/letter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business: analysis.property }),
    });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const m = line.match(/^data: (.*)$/s);
        if (!m) continue;
        if (m[1] === "[DONE]") continue;
        try {
          const obj = JSON.parse(m[1]);
          if (obj.t) setLetter((prev) => prev + obj.t);
        } catch {
          /* ignore */
        }
      }
    }
    setLetterLoading(false);
  }

  const p = analysis?.property;

  return (
    <div className="wrap">
      <div className="hero">
        <h1>Stella</h1>
        <p>
          <span className="big">£317m</span> in Small Business Rate Relief goes unclaimed in London every year.
          Enter your business to see what you can claim.
        </p>
      </div>

      <div className="card">
        <div className="form-row">
          <div className="grow">
            <label>Business name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Daily Grind Coffee"
              onKeyDown={(e) => e.key === "Enter" && lookup()}
            />
          </div>
          <div style={{ flex: "0 1 180px" }}>
            <label>Postcode</label>
            <input
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              placeholder="EC1N 7TE"
              onKeyDown={(e) => e.key === "Enter" && lookup()}
            />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="primary" onClick={() => lookup()} disabled={loading || !name || !postcode}>
            {loading ? "Checking…" : "Check what I can claim"}
          </button>
        </div>
        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
      </div>

      {picker && (
        <div className="card">
          <p>{picker.reason}</p>
          {picker.properties.map((pr) => (
            <div className="picker-item" key={pr.uarn}>
              <div>
                <div className="addr">{pr.address}</div>
                <div className="sub">
                  RV {gbp(pr.rateable_value)} · {pr.sector} · saves {gbp(pr.totals.total_annual_savings)}/yr
                </div>
              </div>
              <button className="ghost" onClick={() => lookup(pr.uarn)}>This is mine</button>
            </div>
          ))}
        </div>
      )}

      {analysis && p && (
        <>
          <div className="card">
            <div className="sub">{analysis.ch_note}</div>
            <div className="headline-figure">{gbp(p.totals.total_annual_savings)}/yr</div>
            <div className="sub">
              potential saving · backdated estimate {gbp(p.totals.total_backdated)} · {p.address}, {p.postcode} ({p.borough})
            </div>

            {p.findings.map((f, i) => (
              <div className="finding" key={i}>
                <div className="h">
                  {f.headline} {f.annual_value > 0 && <span className="v">· {gbp(f.annual_value)}/yr</span>}
                </div>
                <div className="ex">{f.explanation}</div>
                <div className="ex"><strong>Action:</strong> {f.action} · <a href={f.source} target="_blank" rel="noreferrer">source</a></div>
              </div>
            ))}

            {analysis.council && (
              <div className="sub" style={{ marginTop: 14 }}>
                Your council:{" "}
                {analysis.council.apply_url && <a href={analysis.council.apply_url} target="_blank" rel="noreferrer">apply online</a>}
                {analysis.council.phone && <> · {analysis.council.phone}</>}
                {analysis.council.email && <> · {analysis.council.email}</>}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <button className="primary" onClick={generateLetter} disabled={letterLoading}>
                {letterLoading ? "Writing…" : "Generate claim letter"}
              </button>
            </div>
            {letter && <pre className="letter" style={{ marginTop: 14 }}>{letter}</pre>}
          </div>

          {analysis.grants.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Grants you may qualify for</h3>
              {analysis.grants.map((g, i) => (
                <div className="grant" key={i}>
                  <div className="name">
                    {g.name} <span className={`pill ${g.eligibility}`}>{g.eligibility}</span>
                  </div>
                  <div className="meta">{g.funder} · {g.value} · {g.deadline}</div>
                  <ul>{g.match_reasons.map((r, j) => <li key={j}>{r}</li>)}</ul>
                  <div className="meta"><a href={g.url} target="_blank" rel="noreferrer">{g.action}</a></div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="phone-note">
        <strong>Prefer to call?</strong> Stella also answers the phone. Call{" "}
        <a href="tel:+19452155072"><strong>+1&nbsp;945&nbsp;215&nbsp;5072</strong></a>{" "}
        and just say your business name — the same engine reads back exactly what you can claim. (Powered by an
        ElevenLabs voice agent.)
      </div>
    </div>
  );
}
