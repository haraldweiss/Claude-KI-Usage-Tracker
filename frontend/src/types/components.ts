/**
 * React Component Props Type Definitions
 * Defines TypeScript interfaces for all component props
 */

import { ReactNode } from 'react';
import {
  UsageSummaryData,
  UsageHistoryRecord,
  ModelBreakdown,
  PricingData,
  Period,
  ModelRecommendation
} from './api';

// ErrorBoundary Component
export interface ErrorBoundaryProps {
  children: ReactNode;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// UsageSummary Component
export interface UsageSummaryProps {
  stats?: Partial<UsageSummaryData>;
  loading?: boolean;
}

// UsageChart Component
export interface UsageChartProps {
  modelData?: ModelBreakdown[];
  loading?: boolean;
}

// ActivityTable Component
export interface ActivityTableProps {
  records?: UsageHistoryRecord[];
  loading?: boolean;
  limit?: number;
  offset?: number;
  onPaginationChange?: (offset: number, limit: number) => void;
}

// PricingTable Component
export interface PricingTableProps {
  pricing?: PricingData[];
  loading?: boolean;
  onUpdate?: () => void | Promise<void>;
  readOnly?: boolean;
}

// ModelSuggester Component
export interface ModelSuggesterProps {
  onRecommendation?: (recommendation: ModelRecommendation) => void;
  loading?: boolean;
}

// OpportunitiesCard Component
export interface OpportunitiesCardProps {
  opportunities?: Record<string, unknown>;
  period?: Period;
  loading?: boolean;
}

// OpportunitiesTable Component
export interface OpportunitiesTableProps {
  opportunities?: Record<string, unknown>;
  loading?: boolean;
}

// Page Components Props
export interface DashboardProps {
  period?: Period;
  onPeriodChange?: (period: Period) => void;
}

export interface SettingsProps {
  onSave?: () => void;
}

export interface RecommendationsPageProps {
  period?: Period;
  onPeriodChange?: (period: Period) => void;
}

// Common Component Props
export interface LoadingProps {
  isLoading?: boolean;
}

export interface ErrorProps {
  error?: Error | string | null;
  onDismiss?: () => void;
}

// BarChart types
export interface BarChartData {
  date: string;
  tokens: number;
}

export interface BarChartProps {
  data: BarChartData[];
  title?: string;
}

// PeriodFilter types
export type PeriodType = 'all' | '30d' | '7d';

export interface PeriodFilterProps {
  activePeriod: PeriodType;
  onPeriodChange: (period: PeriodType) => void;
}

// ModelBreakdownSection types
export interface ModelBreakdownSectionProps {
  models: ModelBreakdown[];
}

// OverviewTab types
export interface OverviewTabProps {
  chartData: BarChartData[];
  models: ModelBreakdown[];
}

// ModelsTab types
export interface ModelsTabProps {
  models: ModelBreakdown[];
}
