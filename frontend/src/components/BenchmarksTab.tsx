// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getBenchmarkRuns } from '../services/api';
import type { BenchmarkRun, ModelSummary } from '../types/benchmark';

function scoreColor(score: number | null): string {
  if (score == null) return 'text-gray-400';
  if (score >= 80) return 'text-green-600 font-semibold';
  if (score >= 60) return 'text-yellow-600 font-semibold';
  return 'text-red-600 font-semibold';
}

function buildSummaries(runs: BenchmarkRun[]): ModelSummary[] {
  const byModel = new Map<string, BenchmarkRun[]>();
  for (const run of runs) {
    if (!byModel.has(run.model_name)) byModel.set(run.model_name, []);
    byModel.get(run.model_name)!.push(run);
  }

  return Array.from(byModel.entries()).map(([model, modelRuns]) => {
    const latest = (cat: string): number | null => {
      const row = modelRuns.filter((r) => r.category === cat).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];
      return row?.score ?? null;
    };
    const coding = latest('coding');
    const general = latest('general');
    const project = latest('project');
    const speed = latest('speed');
    const scores = [coding, general, project].filter((s): s is number => s != null);
    const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const machines = [...new Set(modelRuns.map((r) => r.machine_name))];
    return { model, machines, coding, general, project, overall, speed };
  });
}

function ScoreCell({ score }: { score: number | null }): React.ReactElement {
  return (
    <td className={`px-4 py-3 text-right tabular-nums ${scoreColor(score)}`}>
      {score != null ? score : '—'}
    </td>
  );
}

export default function BenchmarksTab(): React.ReactElement {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<keyof ModelSummary>('overall');

  useEffect(() => {
    let cancelled = false;
    getBenchmarkRuns({ limit: '200' })
      .then((data) => { if (!cancelled) { setRuns(data.runs); setLoading(false); } })
      .catch((e: Error) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="py-8 text-center text-gray-500">Lade Benchmark-Daten…</div>;
  if (error) return <div className="py-8 text-center text-red-600">Fehler: {error}</div>;
  if (runs.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500">
        <p className="font-medium">Noch keine Benchmark-Daten</p>
        <p className="text-sm mt-1">Starte mit: <code className="bg-gray-100 px-1 rounded">node benchmark/run.js --mode quick</code></p>
      </div>
    );
  }

  const summaries = buildSummaries(runs).sort((a, b) => {
    const av = a[sortKey] as number | null;
    const bv = b[sortKey] as number | null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });

  const machines = [...new Set(runs.map((r) => r.machine_name))];
  const speedData = summaries.map((s) => ({ name: s.model.replace(/:latest$/, ''), speed: s.speed ?? 0 }));

  const SortHeader = ({ label, sortBy }: { label: string; sortBy: keyof ModelSummary }): React.ReactElement => (
    <th
      className={`px-4 py-3 text-right text-sm font-medium cursor-pointer select-none ${sortKey === sortBy ? 'text-gray-900 underline' : 'text-gray-500 hover:text-gray-700'}`}
      onClick={() => setSortKey(sortBy)}
    >
      {label}
    </th>
  );

  return (
    <div className="space-y-8">
      {/* Score Table */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Modell-Scores</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Modell</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Maschine</th>
                <SortHeader label="Coding" sortBy="coding" />
                <SortHeader label="General" sortBy="general" />
                <SortHeader label="Project" sortBy="project" />
                <SortHeader label="Overall" sortBy="overall" />
                <SortHeader label="Speed (t/s)" sortBy="speed" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {summaries.map((s) => (
                <tr key={s.model} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{s.model}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{s.machines.join(', ')}</td>
                  <ScoreCell score={s.coding} />
                  <ScoreCell score={s.general} />
                  <ScoreCell score={s.project} />
                  <ScoreCell score={s.overall} />
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{s.speed != null ? s.speed.toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-1">Klick auf Spalten-Header zum Sortieren</p>
      </div>

      {/* Speed Chart */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Speed: Tokens/Sekunde</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={speedData} margin={{ top: 4, right: 16, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-40} textAnchor="end" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="speed" name="t/s" fill="#6366f1" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Machine Comparison */}
      {machines.length > 1 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Maschinen-Vergleich</h2>
          <div className="grid grid-cols-2 gap-4">
            {machines.map((machine) => {
              const machineSummaries = buildSummaries(runs.filter((r) => r.machine_name === machine));
              const avg = (key: keyof ModelSummary): string => {
                const vals = machineSummaries.map((s) => s[key] as number | null).filter((v): v is number => v != null);
                return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
              };
              return (
                <div key={machine} className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-medium text-sm mb-2">{machine}</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-gray-500">Ø Coding</span><span className="font-semibold">{avg('coding')}</span>
                    <span className="text-gray-500">Ø General</span><span className="font-semibold">{avg('general')}</span>
                    <span className="text-gray-500">Ø Project</span><span className="font-semibold">{avg('project')}</span>
                    <span className="text-gray-500">Ø Speed</span><span className="font-semibold">{avg('speed')} t/s</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Run History */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Run-Verlauf</h2>
        <div className="space-y-1">
          {[...new Set(runs.map((r) => r.run_id))].slice(0, 20).map((runId) => {
            const runRows = runs.filter((r) => r.run_id === runId);
            const first = runRows[0];
            if (!first) return null;
            const models = [...new Set(runRows.map((r) => r.model_name))];
            return (
              <div key={runId} className="text-sm flex gap-4 py-2 border-b border-gray-100">
                <span className="text-gray-400 font-mono text-xs">{new Date(first.created_at).toLocaleString('de-DE')}</span>
                <span className="text-gray-600">{first.machine_name}</span>
                <span className="text-gray-400">{first.mode}</span>
                <span className="text-gray-500">{models.length} Modell(e)</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
