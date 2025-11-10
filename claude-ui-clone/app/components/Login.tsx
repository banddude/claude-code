'use client';

import { useState, useEffect } from 'react';
import ClaudeLogo from './ClaudeLogo';

interface LoginProps {
  onLogin: (token: string, username: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Handle OAuth callback with token in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const oauthUsername = params.get('username');
    const errorParam = params.get('error');

    if (errorParam === 'unauthorized') {
      setError('Only people with @shaffercon.com emails can use this app');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (token && oauthUsername) {
      localStorage.setItem('token', token);
      onLogin(token, oauthUsername);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [onLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // Use relative paths for API calls (works through tunnel and locally)
      const response = await fetch(`/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        throw new Error('Invalid credentials');
      }

      const data = await response.json();
      onLogin(data.token, data.username);
    } catch (err) {
      setError('Invalid username or password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: 'rgb(250, 249, 245)', padding: '24px' }}>
      <div className="w-full max-w-md">
        <div className="mb-12 text-center">
          <div className="mb-6 flex justify-center">
            <ClaudeLogo size={64} />
          </div>
          <h1 className="text-2xl font-semibold text-zinc-900">
            AIVA
          </h1>
          <p className="mt-2 text-zinc-600">
            Sign in to continue
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 mb-6">
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <a
            href="http://localhost:3001/api/auth/google"
            className="inline-flex items-center justify-center gap-2 rounded-2xl text-zinc-900 font-medium transition-colors bg-white shadow-sm"
            style={{
              backgroundColor: 'rgb(255, 255, 255)',
              border: '1px solid rgba(31, 30, 29, 0.15)',
              padding: '8px 32px 8px 32px',
              textDecoration: 'none',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgb(245, 245, 245)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgb(255, 255, 255)')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
            </svg>
            Sign in with Google
          </a>
        </div>
      </div>
    </div>
  );
}
