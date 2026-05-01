import React, { useEffect, useState } from 'react';
import { adminListUsers, adminPatchUser, adminDeleteUser } from '../../services/api';
import type { AdminUserRow } from '../../types/api';

export default function AdminUsersSection(): React.ReactElement {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);

  const load = () => adminListUsers().then((r) => setUsers(r.users));
  useEffect(() => { load(); }, []);

  const remove = async (u: AdminUserRow) => {
    if (!window.confirm(`User ${u.email} wirklich löschen? Alle Daten gehen verloren.`)) return;
    await adminDeleteUser(u.id);
    load();
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">User-Verwaltung (Admin)</h2>
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500 uppercase">
          <tr><th className="text-left py-2">Email</th><th className="text-left">Plan</th>
              <th className="text-right">Records</th><th className="text-left">Letzter Login</th><th></th></tr>
        </thead>
        <tbody className="divide-y">
          {users.map((u) => (
            <tr key={u.id}>
              <td className="py-2">{u.email} {u.is_admin === 1 && <span className="text-xs bg-purple-100 px-1.5 rounded ml-1">admin</span>}</td>
              <td>{u.plan_name || '—'}</td>
              <td className="text-right">{u.record_count}</td>
              <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('de-DE') : '—'}</td>
              <td className="text-right">
                <button onClick={() => setEditing(u)} className="text-blue-600 text-xs hover:underline mr-2">Edit</button>
                <button onClick={() => remove(u)} className="text-red-600 text-xs hover:underline">Löschen</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <EditModal user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function EditModal({ user, onClose, onSaved }: { user: AdminUserRow; onClose: () => void; onSaved: () => void }): React.ReactElement {
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [planName, setPlanName] = useState(user.plan_name || '');
  const [isAdmin, setIsAdmin] = useState(user.is_admin === 1);

  const save = async () => {
    await adminPatchUser(user.id, { display_name: displayName, plan_name: planName, is_admin: isAdmin ? 1 : 0 });
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg mb-4">User bearbeiten: {user.email}</h3>
        <div className="space-y-3">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display Name" className="w-full px-3 py-2 border rounded" />
          <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Plan" className="w-full px-3 py-2 border rounded" />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
            <span>Admin-Rechte</span>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-gray-600">Abbrechen</button>
          <button onClick={save} className="px-3 py-1.5 bg-blue-600 text-white rounded">Speichern</button>
        </div>
      </div>
    </div>
  );
}
