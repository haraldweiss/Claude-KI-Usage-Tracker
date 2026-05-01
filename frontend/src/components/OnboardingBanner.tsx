import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiToken } from '../services/api';

const STORAGE_KEY = 'onboarding_banner_dismissed';

export default function OnboardingBanner(): React.ReactElement | null {
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Skip if already dismissed
    if (localStorage.getItem(STORAGE_KEY) === 'true') {
      setLoading(false);
      return;
    }

    // Check if API token exists
    getApiToken()
      .then((token) => {
        setShow(token === null);
        setLoading(false);
      })
      .catch(() => {
        // If error fetching token, don't show banner (likely auth issue)
        setLoading(false);
      });
  }, []);

  if (loading || !show) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setShow(false);
  };

  return (
    <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r mb-6 flex items-start gap-3">
      <span className="text-2xl">🔌</span>
      <div className="flex-1">
        <p className="font-semibold text-blue-900">Browser-Extension einrichten</p>
        <p className="text-sm text-blue-800">
          Generiere einen API-Token in <Link to="/settings" className="underline hover:no-underline font-medium">Settings → API-Token</Link>,
          installiere die Extension und trage den Token ein, um automatisch zu syncen.
        </p>
      </div>
      <button
        onClick={dismiss}
        className="text-blue-600 hover:text-blue-800 text-sm font-medium flex-shrink-0"
        aria-label="Banner schließen"
      >
        ✕
      </button>
    </div>
  );
}
