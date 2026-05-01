import React, { useEffect, useState } from 'react';
import { adminStats } from '../../services/api';
import type { AdminStats } from '../../types/api';

export default function AdminStatsSection(): React.ReactElement {
  const [stats, setStats] = useState<AdminStats | null>(null);
  useEffect(() => { adminStats().then(setStats); }, []);
  if (!stats) return <div className="text-gray-500">Lade…</div>;
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">System-Stats (Admin)</h2>
      <div className="grid grid-cols-3 gap-4">
        <div><div className="text-2xl font-bold">{stats.total_users}</div><div className="text-sm text-gray-500">User insgesamt</div></div>
        <div><div className="text-2xl font-bold">{stats.active_last_7d}</div><div className="text-sm text-gray-500">Aktiv (7 Tage)</div></div>
        <div><div className="text-2xl font-bold">{stats.total_records.toLocaleString('de-DE')}</div><div className="text-sm text-gray-500">Records gesamt</div></div>
      </div>
    </div>
  );
}
