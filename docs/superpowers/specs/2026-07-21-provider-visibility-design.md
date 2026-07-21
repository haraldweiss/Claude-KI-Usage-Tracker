# Provider visibility for inactive Claude sources

## Purpose

Keep the dashboard focused on sources the user currently uses, without
discarding real costs. The settings page remains the place to configure or
re-enable every provider.

## Rules

1. `claude_ai` is visible only when its provider settings contain a selected
   subscription plan. When no plan is selected, all Claude.ai-specific UI is
   omitted, including its status card, cost breakdown labels, reset hint, and
   subscription cycle history.
2. `anthropic_api` is visible when either its provider settings contain a
   selected API plan or the current-month API total is greater than zero. This
   retains genuine spend even if the user has since removed the configuration,
   while hiding unused, zero-cost API UI.
3. Every dashboard total and short cost breakdown uses the same visibility
   predicates. Hidden sources contribute zero to the displayed total.
4. These rules apply consistently to `OverviewTab` and `CombinedCostTab`.
   Provider settings and backend history are unchanged.

## Implementation boundary

The frontend derives the two predicates from the existing provider response
and the current summary. No migration, scraper, API-contract, or stored-data
change is required.

## Error handling

If the provider-settings request is unavailable, preserve the existing
fail-open behaviour: existing usage data may render rather than being hidden
solely due to a failed settings request.

## Verification

Component tests cover:

- an unsubscribed Claude.ai provider hiding its Claude.ai UI and cost;
- an unconfigured, zero-cost Anthropic API provider hiding its UI and cost;
- a zero-configured Anthropic API provider with current spend remaining
  visible and included in totals.

Run the frontend type check and the affected frontend test suite after the
change.
