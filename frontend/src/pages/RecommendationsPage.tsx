import React from 'react';
import ModelSuggester from '../components/ModelSuggester';
import InsightsBlock from '../components/InsightsBlock';

export default function RecommendationsPage(): React.ReactElement {
  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-8 rounded-lg shadow-lg">
        <h1 className="text-3xl font-bold mb-2">🎯 Empfehlungen</h1>
        <p className="text-blue-100">
          Insights aus deinem tatsächlichen Verbrauch — Plan-Right-Sizing,
          Forecast-Warnungen, API-Key-Effizienz. Plus ein interaktiver
          Modell-Suggester für Einzel-Tasks.
        </p>
      </div>

      {/* Insights based on the live sync data */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-slate-800">📊 Insights für dich</h2>
        <InsightsBlock />
      </div>

      <div className="border-t-2 border-slate-200" />

      {/* Model Suggester — interactive: paste a task, get a model recommendation */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-slate-800">🤖 Modell-Suggester</h2>
        <p className="text-sm text-slate-600">
          Beschreibe eine konkrete Aufgabe — der Tracker schlägt vor, welches
          Claude-Modell dafür sinnvoll ist (Komplexität, Sicherheit, Kosten).
        </p>
        <ModelSuggester />
      </div>

      {/* Info Footer */}
      <div className="bg-blue-50 border-l-4 border-blue-500 p-6 rounded-lg">
        <h3 className="font-semibold text-slate-800 mb-2">💡 Wie das funktioniert</h3>
        <ul className="text-sm text-slate-700 space-y-2">
          <li>✓ Insights vergleichen deinen Verbrauch mit der Plan-Tabelle (Settings)</li>
          <li>✓ Forecast extrapoliert deinen Tagesschnitt aufs Monatsende</li>
          <li>✓ Die alte Token-basierte Cost-Optimization funktioniert nur, wenn die Extension per-message Daten liefert — claude.ai tut das aktuell nicht</li>
        </ul>
      </div>
    </div>
  );
}
