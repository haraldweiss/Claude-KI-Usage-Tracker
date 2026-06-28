export interface BenchmarkRun {
  id: number;
  run_id: string;
  machine_name: string;
  model_name: string;
  mode: 'quick' | 'standard';
  category: 'coding' | 'general' | 'project' | 'speed';
  score: number | null;
  tasks_total: number | null;
  tasks_passed: number | null;
  raw_results: string;
  created_at: string;
}

export interface BenchmarkRunsResponse {
  runs: BenchmarkRun[];
}

export interface ModelSummary {
  model: string;
  machines: string[];
  coding: number | null;
  general: number | null;
  project: number | null;
  overall: number | null;
  speed: number | null;
}
