import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function UserMenu(): React.ReactElement {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  if (!user) return <></>;
  const initials = (user.display_name || user.email).slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        className="w-9 h-9 rounded-full bg-blue-600 text-white font-semibold flex items-center justify-center">
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border py-1 z-10">
          <div className="px-4 py-2 text-xs text-gray-500 border-b">{user.email}</div>
          <button onClick={logout} className="w-full text-left px-4 py-2 hover:bg-gray-50">
            Abmelden
          </button>
        </div>
      )}
    </div>
  );
}
