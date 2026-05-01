import React, { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function RequireAuth({ children }: { children: ReactNode }): React.ReactElement {
  const { user, loading } = useAuth();
  if (loading) return <div className="text-center py-12 text-gray-500">Lade…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
