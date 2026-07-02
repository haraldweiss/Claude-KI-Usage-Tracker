// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getBenchmarkRuns, triggerBenchmarkRun, getBenchmarkMachines, getBenchmarkTriggers } from '../services/api';
import type { BenchmarkRun, ModelSummary } from '../types/benchmark';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

const STATUS_LABELS: Record<string, string> = {
  pending: 'Wartet…',
  running: 'Läuft…',
  done: 'Fertig',
  failed: 'Fehlgeschlagen',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  running: 'bg-blue-100 text-blue-800',
  done: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function BenchmarksTab(): React.ReactElement {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [triggers, setTriggers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<keyof ModelSummary>('overall');
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const [runMsg, setRunMsg] = useState<{ machine: string; text: string; ok: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<'scores' | 'machines' | 'history'>('scores');

  // Refresh timer — re-fetches everything every 15s while there's a pending/running trigger
  const [refreshKey, setRefreshKey] = useState(0);
  const hasActiveTrigger = triggers.some((t) => t.status === 'pending' || t.status === 'running');

  // Fetch all data
  const fetchAll = useCallback(async () => {
    try {
      const [runsData, machinesData, triggersData] = await Promise.all([
        getBenchmarkRuns({ limit: '200' }),
        getBenchmarkMachines(),
        getBenchmarkTriggers(20),
      ]);
      setRuns(runsData.runs);
      setMachines(machinesData.machines);
      setTriggers(triggersData.triggers);
    } catch (e) {
      setError(e instanceof Error ? e.message : '?');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Auto-refresh while triggers are active
  useEffect(() => {
    if (!hasActiveTrigger) return;
    const interval = setInterval(() => {
      setRefreshKey((k) => k + 1);
    }, 15000);
    return () => clearInterval(interval);
  }, [hasActiveTrigger]);

  // Re-fetch on refreshKey change
  useEffect(() => {
    if (refreshKey > 0) fetchAll();
  }, [refreshKey, fetchAll]);

  // Trigger a benchmark run
  const handleRun = async (machineName: string) => {
    setRunningMap((prev) => ({ ...prev, [machineName]: true }));
    setRunMsg(null);
    try {
      const res = await triggerBenchmarkRun(machineName);
      setRunMsg({ machine: machineName, text: res.message || 'Angefordert', ok: true });
      // Re-fetch triggers to show the new pending item
      const triggersData = await getBenchmarkTriggers(20);
      setTriggers(triggersData.triggers);
    } catch (e) {
      setRunMsg({ machine: machineName, text: 'Fehler: ' + (e instanceof Error ? e.message : '?'), ok: false });
    } finally {
      setRunningMap((prev) => ({ ...prev, [machineName]: false }));
    }
  };

  // Derived data
  const summaries = buildSummaries(runs).sort((a, b) => {
    const av = a[sortKey] as number | null;
    const bv = b[sortKey] as number | null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });

  const speedData = summaries.map((s) => ({ name: s.model.replace(/:latest$/, ''), speed: s.speed ?? 0 }));

  const SortHeader = ({ label, sortBy }: { label: string; sortBy: keyof ModelSummary }): React.ReactElement => (
    <th
      className={`px-4 py-3 text-right text-sm font-medium cursor-pointer select-none ${sortKey === sortBy ? 'text-gray-900 underline' : 'text-gray-500 hover:text-gray-700'}`}
      onClick={() => setSortKey(sortBy)}
    >
      {label}
    </th>
  );

  // Get the latest trigger status for a given machine
  const machineStatus = (machine: string): { status: string; trigger: any } | null => {
    const machineTriggers = triggers.filter((t) => t.machine_name === machine);
    if (machineTriggers.length === 0) return null;
    return { status: machineTriggers[0].status, trigger: machineTriggers[0] };
  };

  if (loading) return <div className="py-8 text-center text-gray-500">Lade Benchmark-Daten…</div>;
  if (error) return <div className="py-8 text-center text-red-600">Fehler: {error}</div>;

  if (runs.length === 0 && machines.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500">
        <p className="font-medium">Noch keine Benchmark-Daten</p>
        <p className="text-sm mt-1">Starte mit: <code className="bg-gray-100 px-1 rounded">node benchmark/run.js --mode quick</code></p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Tabs */}
      <div className="flex gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('scores')}
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'scores' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Modell-Scores
        </button>
        {machines.length > 0 && (
          <button
            onClick={() => setActiveTab('machines')}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'machines' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Maschinen
          </button>
        )}
        <button
          onClick={() => setActiveTab('history')}
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'history' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Run-Verlauf
        </button>
      </div>

      {/* Tab: Machine Cards with Run Buttons */}
      {activeTab === 'machines' && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Benchmark auf Maschine starten</h2>
          {runMsg && (
            <div className={`mb-4 px-4 py-2 rounded text-sm ${runMsg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {runMsg.text}
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {machines.map((machine) => {
              const status = machineStatus(machine);
              const isRunning = runningMap[machine];
              const machineRuns = runs.filter((r) => r.machine_name === machine);
              const lastRun = machineRuns.length > 0
                ? machineRuns.reduce((a, b) => new Date(a.created_at) > new Date(b.created_at) ? a : b)
                : null;
              const modelCount = new Set(machineRuns.map((r) => r.model_name)).size;
              const runCount = new Set(machineRuns.map((r) => r.run_id)).size;

              return (
                <div key={machine} className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <h3 className="font-medium text-sm truncate" title={machine}>{machine}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {modelCount} Modell(e) · {runCount} Run(s)
                      </p>
                    </div>
                    {status && (
                      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[status.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[status.status] || status.status}
                      </span>
                    )}
                  </div>

                  {lastRun && (
                    <div className="text-xs text-gray-500">
                      Letzter Run: {new Date(lastRun.created_at).toLocaleString('de-DE')}
                    </div>
                  )}

                  <div className="flex gap-2 mt-auto">
                    <button
                      onClick={() => handleRun(machine)}
                      disabled={isRunning}
                      className={`flex-1 px-3 py-2 text-sm font-medium rounded transition-colors ${
                        isRunning
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {isRunning ? 'Wird gestartet…' : 'Quick Run'}
                    </button>
                    <button
                      onClick={() => handleRun(machine)}
                      disabled={isRunning}
                      className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
                        isRunning
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-gray-700 text-white hover:bg-gray-800'
                      }`}
                    >
                      Standard
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active trigger notifications */}
          {hasActiveTrigger && (
            <div className="mt-4 space-y-2">
              <p className="text-sm text-gray-500 font-medium">Aktive Aufträge:</p>
              {triggers.filter((t) => t.status === 'pending' || t.status === 'running').map((t) => (
                <div key={t.id} className="flex items-center gap-3 text-sm px-4 py-2 bg-yellow-50 border border-yellow-200 rounded">
                  <div className="animate-pulse w-2 h-2 rounded-full bg-yellow-500"></div>
                  <span className="font-medium">{t.machine_name}</span>
                  <span className="text-gray-500">{STATUS_LABELS[t.status] || t.status}</span>
                  <span className="text-gray-400 text-xs">({t.mode})</span>
                  <span className="text-gray-400 text-xs">seit {new Date(t.created_at).toLocaleTimeString('de-DE')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Score Table */}
      {activeTab === 'scores' && (
        <>
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
          {speedData.length > 0 && (
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
          )}

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
        </>
      )}

      {/* Tab: Run History + Triggers */}
      {activeTab === 'history' && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Run-Verlauf</h2>
          <div className="space-y-2 mb-8">
            {triggers.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Angeforderte Runs</h3>
                {triggers.slice(0, 10).map((t) => (
                  <div key={t.id} className="text-sm flex gap-3 py-2 border-b border-gray-100 items-center">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[t.status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[t.status] || t.status}
                    </span>
                    <span className="text-gray-400 font-mono text-xs">{new Date(t.created_at).toLocaleString('de-DE')}</span>
                    <span className="text-gray-600">{t.machine_name}</span>
                    <span className="text-gray-400 text-xs">({t.mode})</span>
                    {t.completed_at && (
                      <span className="text-gray-400 text-xs">
                        → {new Date(t.completed_at).toLocaleString('de-DE')}
                      </span>
                    )}
                    {t.error_message && (
                      <span className="text-red-500 text-xs ml-2" title={t.error_message}>⚠</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <h3 className="text-sm font-medium text-gray-500 mb-2">Abgeschlossene Runs</h3>
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
      )}

      {/* Auto-refresh indicator */}
      {hasActiveTrigger && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs px-3 py-2 rounded-full shadow">
          <div className="animate-pulse w-2 h-2 rounded-full bg-indigo-500"></div>
          Benchmark läuft — Auto-Refresh aktiv
        </div>
      )}
    </div>
  );
}
