import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import RecommendationsPage from './pages/RecommendationsPage';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

export default function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Navigation */}
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📊</span>
              <h1 className="text-xl font-bold text-gray-900">Claude Usage Tracker</h1>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setCurrentPage('dashboard')}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  currentPage === 'dashboard'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                Dashboard
              </button>
              <button
                onClick={() => setCurrentPage('recommendations')}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  currentPage === 'recommendations'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                🎯 Recommendations
              </button>
              <button
                onClick={() => setCurrentPage('settings')}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  currentPage === 'settings'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                Settings
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ErrorBoundary>
          {currentPage === 'dashboard' && <Dashboard />}
          {currentPage === 'recommendations' && <RecommendationsPage />}
          {currentPage === 'settings' && <Settings />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
