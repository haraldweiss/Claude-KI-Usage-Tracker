import React, { useState, FormEvent } from 'react';
import { requestMagicLink } from '../services/api';

export default function LoginPage(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await requestMagicLink(email);
      setSent(true);
    } catch {
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="bg-white p-8 rounded-lg shadow w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">📊 Claude Usage Tracker</h1>
        {sent ? (
          <div className="mt-6">
            <p className="text-gray-700">
              Wir haben dir einen Login-Link an <strong>{email}</strong> geschickt.
              Prüfe dein Postfach und klicke den Link (gültig 15 Minuten).
            </p>
            <button onClick={() => setSent(false)} className="mt-4 text-sm text-blue-600 hover:underline">
              Nochmal anfordern oder andere Email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <p className="text-gray-600">Gib deine Email ein, wir schicken dir einen Login-Link.</p>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="du@example.com"
              className="w-full px-4 py-2 border rounded focus:outline-none focus:border-blue-500" />
            <button type="submit" disabled={submitting}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:opacity-50">
              {submitting ? 'Wird gesendet…' : 'Login-Link anfordern'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
