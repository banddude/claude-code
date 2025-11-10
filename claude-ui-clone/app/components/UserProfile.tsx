'use client';

import { useState, useEffect } from 'react';

interface UserConfig {
  firstName: string;
  lastName: string;
  email: string;
  title: string;
}

interface UserProfileProps {
  token: string;
  currentUsername: string;
  onClose: () => void;
}

const getBackendUrl = () => {
  if (typeof window === 'undefined') return '';
  return `http://${window.location.hostname}:3001`;
};

export default function UserProfile({ token, currentUsername, onClose }: UserProfileProps) {
  const [userConfig, setUserConfig] = useState<UserConfig>({
    firstName: '',
    lastName: '',
    email: currentUsername,
    title: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<UserConfig>({...userConfig});

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      setLoading(true);
      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/api/user/config/${currentUsername.toLowerCase()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const config = await response.json();
        setUserConfig(config);
        setEditValues(config);
      } else {
        setError('Failed to load profile');
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      setError('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');

      const backendUrl = getBackendUrl();
      const url = `${backendUrl}/api/user/config/${currentUsername.toLowerCase()}`;
      console.log('[UserProfile] Saving profile to:', url);
      console.log('[UserProfile] Data:', editValues);

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(editValues)
      });

      console.log('[UserProfile] Response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('[UserProfile] Save successful:', data);
        setUserConfig(editValues);
        setIsEditing(false);
        setSuccess('Profile saved successfully');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        const errorText = await response.text();
        console.error('[UserProfile] Save failed:', response.status, errorText);
        setError(`Failed to save profile (${response.status})`);
      }
    } catch (error) {
      console.error('Error saving profile:', error);
      setError(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setEditValues({...userConfig});
    setIsEditing(false);
    setError('');
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'rgb(250, 249, 245)', minWidth: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div className="sticky top-0" style={{ backgroundColor: 'rgb(250, 249, 245)', borderBottom: '1px solid rgba(31, 30, 29, 0.15)', padding: '24px 32px', zIndex: 10 }}>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-zinc-900">Profile</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-700 rounded-lg hover:bg-zinc-100 transition-colors"
            style={{ padding: '8px' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-y-auto" style={{ flex: 1, padding: '32px', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', paddingBottom: '32px', maxWidth: '600px' }}>
          {/* Error Message */}
          {error && (
            <div className="rounded-lg" style={{ backgroundColor: '#fee2e2', borderLeft: '4px solid #dc2626', padding: '12px 16px' }}>
              <p className="text-sm text-red-900">{error}</p>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="rounded-lg" style={{ backgroundColor: '#dcfce7', borderLeft: '4px solid #16a34a', padding: '12px 16px' }}>
              <p className="text-sm text-green-900">{success}</p>
            </div>
          )}

          {loading && !isEditing ? (
            <div className="text-center py-8">
              <p className="text-zinc-600">Loading...</p>
            </div>
          ) : (
            <>
              {/* First Name */}
              <div>
                <label className="block text-sm font-medium text-zinc-900" style={{ marginBottom: '12px' }}>
                  First Name
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editValues.firstName}
                    onChange={(e) => setEditValues({...editValues, firstName: e.target.value})}
                    className="w-full rounded-lg text-zinc-900 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-opacity-20"
                    style={{
                      border: '1px solid rgba(31, 30, 29, 0.15)',
                      backgroundColor: 'rgb(255, 255, 255)',
                      padding: '10px 16px'
                    }}
                    placeholder="First name"
                  />
                ) : (
                  <p className="text-zinc-700">{userConfig.firstName || '—'}</p>
                )}
              </div>

              {/* Last Name */}
              <div>
                <label className="block text-sm font-medium text-zinc-900" style={{ marginBottom: '12px' }}>
                  Last Name
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editValues.lastName}
                    onChange={(e) => setEditValues({...editValues, lastName: e.target.value})}
                    className="w-full rounded-lg text-zinc-900 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-opacity-20"
                    style={{
                      border: '1px solid rgba(31, 30, 29, 0.15)',
                      backgroundColor: 'rgb(255, 255, 255)',
                      padding: '10px 16px'
                    }}
                    placeholder="Last name"
                  />
                ) : (
                  <p className="text-zinc-700">{userConfig.lastName || '—'}</p>
                )}
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-zinc-900" style={{ marginBottom: '12px' }}>
                  Email
                </label>
                <p className="text-zinc-700">{userConfig.email}</p>
                <p className="text-xs text-zinc-500" style={{ marginTop: '6px' }}>Cannot be changed</p>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-zinc-900" style={{ marginBottom: '12px' }}>
                  Title
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editValues.title}
                    onChange={(e) => setEditValues({...editValues, title: e.target.value})}
                    className="w-full rounded-lg text-zinc-900 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-opacity-20"
                    style={{
                      border: '1px solid rgba(31, 30, 29, 0.15)',
                      backgroundColor: 'rgb(255, 255, 255)',
                      padding: '10px 16px'
                    }}
                    placeholder="Your title"
                  />
                ) : (
                  <p className="text-zinc-700">{userConfig.title || '—'}</p>
                )}
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: '12px', paddingTop: '12px' }}>
                {isEditing ? (
                  <>
                    <button
                      onClick={handleSave}
                      disabled={loading}
                      className="rounded-lg font-medium transition-colors"
                      style={{
                        flex: 1,
                        backgroundColor: 'rgb(0, 0, 0)',
                        color: 'white',
                        padding: '10px 16px',
                        opacity: loading ? 0.6 : 1,
                        cursor: loading ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {loading ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={loading}
                      className="rounded-lg font-medium transition-colors"
                      style={{
                        flex: 1,
                        backgroundColor: 'white',
                        border: '1px solid rgba(31, 30, 29, 0.15)',
                        color: 'rgb(0, 0, 0)',
                        padding: '10px 16px',
                        opacity: loading ? 0.6 : 1,
                        cursor: loading ? 'not-allowed' : 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="w-full rounded-lg font-medium transition-colors"
                    style={{
                      backgroundColor: 'rgb(0, 0, 0)',
                      color: 'white',
                      padding: '10px 16px'
                    }}
                  >
                    Edit Profile
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
