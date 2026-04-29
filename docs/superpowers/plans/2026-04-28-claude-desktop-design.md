# Claude Desktop Design Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Claude Usage Tracker dashboard to match the Claude Desktop App's layout with tabs, time-based bar charts, and detailed model breakdown.

**Architecture:** The dashboard will be restructured with a two-tab interface (Übersicht/Modelle) replacing the single dashboard view. The Übersicht tab shows a bar chart with time-series data and model breakdown statistics. A new BarChart component replaces the pie chart. Period filtering changes from day/week/month to All/30d/7d. The Settings and Recommendations pages remain accessible via the top navigation.

**Tech Stack:** React, TypeScript, Vite, Tailwind CSS, Recharts (for bar charts)

---

## File Structure

**Files to create:**
- `frontend/src/components/BarChart.tsx` - Time-series bar chart component
- `frontend/src/components/DashboardTabs.tsx` - Tab navigation (Übersicht/Modelle)
- `frontend/src/components/ModelBreakdownSection.tsx` - Detailed model statistics display
- `frontend/src/components/OverviewTab.tsx` - Overview tab content
- `frontend/src/components/ModelsTab.tsx` - Models tab content

**Files to modify:**
- `frontend/src/pages/Dashboard.tsx` - Restructure with tab logic and new period filter

---

## Summary of Tasks

- Task 1: Create BarChart Component
- Task 2: Create Tab Navigation Component  
- Task 3: Create Period Filter Component
- Task 4: Create ModelBreakdownSection Component
- Task 5: Create OverviewTab Component
- Task 6: Create ModelsTab Component
- Task 7: Refactor Dashboard.tsx with New Structure
- Task 8: Style and Polish the Dashboard
- Task 9: Full Integration Test

Each task includes TDD approach (test first) and small testable steps.
