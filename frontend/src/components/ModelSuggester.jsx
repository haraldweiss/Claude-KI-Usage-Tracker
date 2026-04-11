import { useState } from 'react';
import { recommendModel } from '../services/api';

export default function ModelSuggester() {
  const [taskInput, setTaskInput] = useState('');
  const [recommendation, setRecommendation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGetRecommendation = async () => {
    if (!taskInput.trim()) {
      setError('Please enter a task description');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await recommendModel(taskInput);
      if (response.success) {
        setRecommendation(response.recommendation);
      } else {
        setError(response.error || 'Failed to get recommendation');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.8) return 'bg-green-600';
    if (confidence >= 0.6) return 'bg-blue-600';
    return 'bg-orange-600';
  };

  const getRiskColor = (risk) => {
    if (risk === 'Low') return 'text-green-600 bg-green-50';
    if (risk === 'Medium') return 'text-orange-600 bg-orange-50';
    return 'text-red-600 bg-red-50';
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border border-slate-200">
      <h2 className="text-2xl font-bold text-slate-800 mb-4">🤖 Model Suggester</h2>
      <p className="text-slate-600 mb-4">
        Describe your task and get a recommended Claude model based on complexity and cost analysis.
      </p>

      {/* Input Section */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Task Description
        </label>
        <textarea
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          placeholder="e.g., Debug async function in React component, summarize research paper, design database schema..."
          className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          rows="3"
          disabled={loading}
        />
        <button
          onClick={handleGetRecommendation}
          disabled={loading}
          className="mt-3 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold rounded-lg transition"
        >
          {loading ? 'Getting Recommendation...' : 'Get Recommendation'}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* Recommendation Display */}
      {recommendation && (
        <div className="space-y-6">
          {/* Main Recommendation Card */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-lg border-2 border-blue-300">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">✨ Recommended Model</h3>

            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-3xl font-bold text-blue-600 mb-2">
                  {recommendation.recommended}
                </p>
                <p className="text-slate-600">
                  Confidence: <span className="font-semibold text-slate-800">{(recommendation.confidence * 100).toFixed(0)}%</span>
                </p>
              </div>
              <div className="w-24 h-24">
                <div className="relative w-24 h-24 rounded-full bg-white border-4 border-blue-600 flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">{(recommendation.confidence * 100).toFixed(0)}%</p>
                    <p className="text-xs text-slate-600">confidence</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Confidence Bar */}
            <div className="mb-6">
              <div className="w-full bg-slate-300 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full ${getConfidenceColor(recommendation.confidence)} transition-all`}
                  style={{ width: `${recommendation.confidence * 100}%` }}
                />
              </div>
            </div>

            {/* Reasoning Details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-lg">
                <p className="text-sm text-slate-600 mb-1">Complexity</p>
                <p className="text-2xl font-bold text-slate-800">{recommendation.reasoning.complexity}/10</p>
                <p className="text-xs text-slate-500 mt-1">{recommendation.reasoning.category}</p>
              </div>
              <div className="bg-white p-4 rounded-lg">
                <p className="text-sm text-slate-600 mb-1">Safety Score</p>
                <p className="text-2xl font-bold text-green-600">{recommendation.reasoning.safetyScore}%</p>
              </div>
              <div className="bg-white p-4 rounded-lg">
                <p className="text-sm text-slate-600 mb-1">Cost Score</p>
                <p className="text-2xl font-bold text-purple-600">{recommendation.reasoning.costScore.toFixed(0)}%</p>
              </div>
              <div className="bg-white p-4 rounded-lg">
                <p className="text-sm text-slate-600 mb-1">Est. Cost</p>
                <p className="text-2xl font-bold text-blue-600">{recommendation.reasoning.estimatedCost}</p>
              </div>
            </div>

            {recommendation.reasoning.matchedKeywords.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-slate-600 mb-2">Keywords detected:</p>
                <div className="flex flex-wrap gap-2">
                  {recommendation.reasoning.matchedKeywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="px-3 py-1 bg-blue-200 text-blue-800 rounded-full text-sm font-medium"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Alternatives Section */}
          {recommendation.alternatives && recommendation.alternatives.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-slate-800 mb-4">📊 Alternative Models</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {recommendation.alternatives.map((alt) => (
                  <div key={alt.model} className="bg-slate-50 p-4 rounded-lg border border-slate-200 hover:border-slate-400 transition">
                    <h4 className="font-semibold text-slate-800 mb-3">{alt.model}</h4>

                    <div className="space-y-2 mb-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Confidence</span>
                        <span className="font-semibold text-slate-800">{(alt.confidence * 100).toFixed(0)}%</span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Savings</span>
                        <span className="font-semibold text-green-600">{alt.savings}</span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Risk</span>
                        <span className={`text-sm font-semibold px-3 py-1 rounded-full ${getRiskColor(alt.riskOfFailure)}`}>
                          {alt.riskOfFailure}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Safety Change</span>
                        <span className="font-semibold text-slate-800">{alt.safetyImprovement}</span>
                      </div>
                    </div>

                    <div className="text-xs text-slate-500 bg-slate-200 p-2 rounded">
                      {alt.confidence >= 0.8
                        ? '✅ Excellent alternative'
                        : alt.confidence >= 0.6
                        ? '⚠️ Consider with caution'
                        : '❌ Not recommended'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Historical Data */}
          {recommendation.historicalData && (
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
              <h4 className="font-semibold text-slate-800 mb-3">📈 Historical Success Rates</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Haiku</p>
                  <p className="text-2xl font-bold text-slate-800">
                    {(recommendation.historicalData.successRateHaiku * 100).toFixed(0)}%
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Sonnet</p>
                  <p className="text-2xl font-bold text-slate-800">
                    {(recommendation.historicalData.successRateSonnet * 100).toFixed(0)}%
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Opus</p>
                  <p className="text-2xl font-bold text-slate-800">
                    {(recommendation.historicalData.successRateOpus * 100).toFixed(0)}%
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!recommendation && !error && !loading && (
        <div className="text-center py-12 text-slate-500">
          <p>💡 Enter a task description and click "Get Recommendation" to get started</p>
        </div>
      )}
    </div>
  );
}
