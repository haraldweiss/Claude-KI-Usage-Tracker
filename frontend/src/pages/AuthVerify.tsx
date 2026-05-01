import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AuthVerifyPage(): React.ReactElement {
  const { refresh } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    refresh().then(() => nav('/', { replace: true }));
  }, [refresh, nav]);

  return <div className="min-h-screen flex items-center justify-center text-gray-500">Logge ein…</div>;
}
