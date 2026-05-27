// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import RequireAuth from './components/RequireAuth';
import ErrorBoundary from './components/ErrorBoundary';
import UserMenu from './components/UserMenu';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import RecommendationsPage from './pages/RecommendationsPage';
import CatalogPage from './pages/CatalogPage';
import LoginPage from './pages/Login';
import AuthVerifyPage from './pages/AuthVerify';
import './index.css';

const NAV_LINKS = [
  { path: '/', label: 'Dashboard' },
  { path: '/recommendations', label: '🎯 Recommendations' },
  { path: '/catalog', label: '📚 Modell-Katalog' },
  { path: '/settings', label: 'Settings' },
];

function NavBar(): React.ReactElement {
  const loc = useLocation();
  return (
    <nav className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center h-16">
        <div className="flex items-center gap-2">
          <span className="text-2xl">💻</span>
          <h1 className="text-xl font-bold text-gray-900">Claude Usage Tracker</h1>
        </div>
        <div className="flex gap-4 items-center">
          {NAV_LINKS.map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                loc.pathname === path ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {label}
            </Link>
          ))}
          <UserMenu />
        </div>
      </div>
    </nav>
  );
}

function ProtectedShell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <RequireAuth>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <NavBar />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
      </div>
    </RequireAuth>
  );
}

export default function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.PROD ? '/claudetracker' : ''}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/verify" element={<AuthVerifyPage />} />
            <Route path="/" element={<ProtectedShell><Dashboard /></ProtectedShell>} />
            <Route path="/recommendations" element={<ProtectedShell><RecommendationsPage /></ProtectedShell>} />
            <Route path="/catalog" element={<ProtectedShell><CatalogPage /></ProtectedShell>} />
            <Route path="/settings" element={<ProtectedShell><Settings /></ProtectedShell>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
