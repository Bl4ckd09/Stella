#!/usr/bin/env bash
set -euo pipefail

postcode="${1:-SW1A 1AA}"
timeout_seconds=600

printf 'Running one Stella agent cycle for %s.\n' "$postcode"
printf 'The cycle has a hard timeout of %s seconds.\n' "$timeout_seconds"

prompt="Use the stella-agent-cycle skill to run one autonomous Stella workforce cycle.
Use the stella MCP tools for every figure.
Target postcode: ${postcode}"

printf '%s\n' "$prompt" |
  perl -e 'alarm shift; exec @ARGV' \
    "$timeout_seconds" \
    claude -p \
    --mcp-config .mcp.json \
    --strict-mcp-config \
    --permission-mode dontAsk \
    --allowedTools \
    "mcp__stella__lookup_business,mcp__stella__assess_relief,mcp__stella__match_grants"
