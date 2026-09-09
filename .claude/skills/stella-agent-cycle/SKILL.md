---
name: stella-agent-cycle
description: Run one autonomous cycle of the Stella agent workforce.
---

# Run one Stella cycle

Run one cycle for the business or postcode in the request.

## Agents

- `orchestrator`, Ada, selects the single next action.
- `scout`, Mara, finds the target business.
- `analyst`, Devi, assesses relief and grant evidence.
- `closer`, Theo, drafts compliant contact text.
- `caseworker`, Iris, prepares the required case work.
- `compliance`, Quinn, gives a PASS or BLOCK result.
- `cfo`, Otto, records confirmed financial facts.

## Method

1. Use `lookup_business` to find the target.
2. Select the relevant business when the lookup returns several records.
3. Use `assess_relief` with the selected business fields.
4. Use `match_grants` with known business facts only.
5. Let the orchestrator select one next action.
6. Let each relevant agent complete its part of that action.
7. Let compliance check every claim and figure before release.
8. Return the cycle record and the compliance result.

Use the three `stella` MCP tools for all figures.
Never state a number that the tools did not return.
Never round, recompute, reformat or summarise a monetary figure.
Describe relief and grant figures as estimates.
State that the business can apply to its council directly for free.
State that the council must confirm the estimate.
Do not submit an application or send contact without clear authority.
