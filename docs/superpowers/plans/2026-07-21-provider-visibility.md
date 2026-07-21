# Provider Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide inactive Claude.ai dashboard content and unused, zero-cost Anthropic API content while retaining current API spend.

**Architecture:** Both dashboard tabs already load the summary and provider settings. Derive `showClaudeAi` from the configured Claude.ai plan, and derive `showAnthropicApi` from an active API plan or current-month API costs. Use those predicates for totals and every source-specific UI fragment.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library.

## Global Constraints

- Missing provider-settings data remains fail-open to avoid hiding data after a failed request.
- No backend, database, scraper, or API-contract change.
- Hidden sources contribute zero to the displayed current-month totals.
- Settings continue to list all providers.

---

### Task 1: Cover OverviewTab provider visibility

**Files:**

- Modify: `frontend/src/components/__tests__/OverviewTab.test.tsx`
- Modify: `frontend/src/components/OverviewTab.tsx`

**Interfaces:**

- Consumes: `CombinedSpendBreakdown`, `ProviderInfo[]`, and `subscriptionEur()`.
- Produces: `showClaudeAi: boolean` and `showAnthropicApi: boolean` predicates scoped to `OverviewTab`.

- [ ] **Step 1: Write the failing tests**

  Add mocked provider rows with `claude_ai.plan_name: null` and `anthropic_api.plan_name: null`. Assert that a stale `claude_ai` response does not render `Claude.ai`, while a zero-cost Anthropic API response does not render `Anthropic API`. Add a second case with `anthropic_api.cost_eur_equivalent: 10` and no API plan; assert the API label and the EUR amount still render.

- [ ] **Step 2: Run the OverviewTab test to verify it fails**

  Run: `cd frontend && npm test -- --run src/components/__tests__/OverviewTab.test.tsx`

  Expected: the new assertions fail because the current hero and three fixed status cards always render Claude.ai and because the Anthropic API label is unconditional.

- [ ] **Step 3: Write the minimal OverviewTab implementation**

  Add:

  ```ts
  const showClaudeAi = providerActive('claude_ai');
  const showAnthropicApi = providerActive('anthropic_api') || apiTotalEur > 0;
  ```

  Gate the Claude.ai cost, reset, three status cards, historical billing-cycle chart, and sync status with `showClaudeAi`. Gate the Anthropic API hero detail with `showAnthropicApi`. Build the hero breakdown from conditional fragments so separators appear only between visible sources. Calculate Claude.ai costs and forecast inputs as zero when hidden.

- [ ] **Step 4: Run the OverviewTab test to verify it passes**

  Run: `cd frontend && npm test -- --run src/components/__tests__/OverviewTab.test.tsx`

  Expected: PASS.

- [ ] **Step 5: Commit the focused implementation and test**

  ```bash
  git add frontend/src/components/OverviewTab.tsx frontend/src/components/__tests__/OverviewTab.test.tsx
  git commit -m "fix(ui): hide inactive Claude sources in overview"
  ```

### Task 2: Cover CombinedCostTab provider visibility

**Files:**

- Modify: `frontend/src/components/__tests__/CombinedCostTab.test.tsx`
- Modify: `frontend/src/components/CombinedCostTab.tsx`

**Interfaces:**

- Consumes: the same summary and provider settings as Task 1.
- Produces: the same source-visibility behaviour in the cost detail tab.

- [ ] **Step 1: Write the failing tests**

  Mock stale Claude.ai data and a null `claude_ai` plan. Assert that Claude.ai is absent from the current-month breakdown, all-time breakdown, and detail card. Mock a null Anthropic API plan with zero current cost and assert its API label/card are absent. In a second API case, preserve the null plan but return a positive current API cost and assert that its label/card remain visible.

- [ ] **Step 2: Run the CombinedCostTab test to verify it fails**

  Run: `cd frontend && npm test -- --run src/components/__tests__/CombinedCostTab.test.tsx`

  Expected: the new assertions fail because this tab currently renders both source labels and cards unconditionally.

- [ ] **Step 3: Write the minimal CombinedCostTab implementation**

  Add:

  ```ts
  const showClaudeAi = providerActive('claude_ai');
  const showAnthropicApi = providerActive('anthropic_api') || apiTotalEurEquiv > 0;
  ```

  Use `showClaudeAi` to zero Claude.ai costs and conditionally render its current, all-time, and detail sections. Use `showAnthropicApi` to conditionally render the current/all-time text and API detail card. Compute the detail-card grid class from the visible cards rather than a fixed two-card assumption. Update the empty-state copy so it does not promise Claude.ai syncing when it is disabled.

- [ ] **Step 4: Run the CombinedCostTab test to verify it passes**

  Run: `cd frontend && npm test -- --run src/components/__tests__/CombinedCostTab.test.tsx`

  Expected: PASS.

- [ ] **Step 5: Commit the focused implementation and test**

  ```bash
  git add frontend/src/components/CombinedCostTab.tsx frontend/src/components/__tests__/CombinedCostTab.test.tsx
  git commit -m "fix(ui): hide unused Anthropic API cost details"
  ```

### Task 3: Verify the dashboard change

**Files:**

- Verify: `frontend/src/components/OverviewTab.tsx`
- Verify: `frontend/src/components/CombinedCostTab.tsx`

- [ ] **Step 1: Run the focused frontend tests**

  Run: `cd frontend && npm test -- --run src/components/__tests__/OverviewTab.test.tsx src/components/__tests__/CombinedCostTab.test.tsx`

  Expected: PASS with both suites green.

- [ ] **Step 2: Type-check the frontend**

  Run: `cd frontend && npm run type-check`

  Expected: exit code 0 with no TypeScript diagnostics.

- [ ] **Step 3: Review the final diff**

  Run: `git diff HEAD~2..HEAD --check && git status --short`

  Expected: no whitespace errors and a clean worktree after the two implementation commits.
