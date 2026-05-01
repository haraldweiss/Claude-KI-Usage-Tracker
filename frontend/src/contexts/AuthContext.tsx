import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getCurrentUser, logout as apiLogout } from '../services/api';
import type { CurrentUser } from '../types/api';

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async (): Promise<void> => {
    try {
      const u = await getCurrentUser();
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    await apiLogout();
    setUser(null);
    window.location.assign('/claudetracker/login');
  };

  useEffect(() => { refresh(); }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
