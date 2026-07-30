import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { isPostcode, run, runByName } from "../src/lib/lookup";
import { assess, totals, type Business } from "../src/lib/engines/relief";
import { matchGrants, type MatchGrantsInput } from "../src/lib/engines/grants";

interface LookupBusinessInput {
  query: string;
}

const ESTIMATE_NOTICE =
  "Figures are estimates. The business can apply to its council directly for free. " +
  "The council must confirm the estimate.";

const tools = [
  {
    name: "lookup_business",
    description:
      "Find a business by postcode or name and return the deterministic lookup result. " +
      ESTIMATE_NOTICE,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "assess_relief",
    description:
      "Assess business rates relief and return the deterministic findings and totals. " +
      ESTIMATE_NOTICE,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        rateable_value: { type: "number" },
        borough: { type: "string" },
        sector: { type: "string" },
        uarn: { type: "string" },
        address: { type: "string" },
        postcode: { type: "string" },
        composite: { type: "boolean" },
      },
      required: ["name", "rateable_value", "borough", "sector"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "match_grants",
    description:
      "Match a business to grants and return the deterministic grant matches. " +
      ESTIMATE_NOTICE,
    inputSchema: {
      type: "object",
      properties: {
        sector: { type: "string" },
        sic_codes: {
          anyOf: [
            { type: "array", items: { type: "string" } },
            { type: "null" },
          ],
        },
        borough: { type: "string" },
        rateable_value: { type: "number" },
        company_age_years: {
          anyOf: [{ type: "number" }, { type: "null" }],
        },
        company_type: { type: "string" },
        company_name: { type: "string" },
      },
      required: ["sector"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] satisfies Tool[];

function jsonText(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

// Preserve every deterministic engine figure unchanged. Never round, recompute, reformat or summarise a monetary figure.
export async function handleLookupBusiness(
  input: LookupBusinessInput,
): Promise<CallToolResult> {
  const result = isPostcode(input.query)
    ? await run(input.query)
    : await runByName(input.query);
  return jsonText(result);
}

export function handleAssessRelief(input: Business): CallToolResult {
  const findings = assess(input);
  return jsonText({ findings, totals: totals(findings) });
}

export function handleMatchGrants(input: MatchGrantsInput): CallToolResult {
  return jsonText(matchGrants(input));
}

export async function startServer(): Promise<void> {
  const server = new Server(
    { name: "stella", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const input = request.params.arguments ?? {};

    switch (request.params.name) {
      case "lookup_business":
        return handleLookupBusiness(input as unknown as LookupBusinessInput);
      case "assess_relief":
        return handleAssessRelief(input as unknown as Business);
      case "match_grants":
        return handleMatchGrants(input as unknown as MatchGrantsInput);
      default:
        throw new Error(`Unknown Stella tool ${request.params.name}`);
    }
  });

  await server.connect(new StdioServerTransport());
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  void startServer().catch((error: unknown) => {
    console.error("Stella MCP server failed.", error);
    process.exitCode = 1;
  });
}
