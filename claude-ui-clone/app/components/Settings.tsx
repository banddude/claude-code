'use client';

import { useState, useEffect } from 'react';

interface UserPermissions {
  allowedTools: string[];
  deniedTools: string[];
  allowedDirectories: string[];
  allowedSkills: string[];
  deniedSkills: string[];
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
}

interface SettingsProps {
  token: string;
  currentUsername: string;
  onClose: () => void;
}

const getBackendUrl = () => {
  // Build the backend URL dynamically
  if (typeof window === 'undefined') return '';
  return `http://${window.location.hostname}:3001`;
};

const measureTextWidth = (text: string): number => {
  if (typeof document === 'undefined') return 0;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI"';
  return ctx.measureText(text).width;
};

const ALL_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
];

const PERMISSION_MODES = [
  { value: 'default', label: 'Has no access to tools or skills ', description: 'User has no tools or skills available' },
  { value: 'acceptEdits', label: 'Can use selected tools and skills ', description: 'Only allow selected tools and skills' },
  { value: 'bypassPermissions', label: 'Has no restrictions ', description: 'Skip all permission checks' },
];

export default function Settings({ token, currentUsername, onClose }: SettingsProps) {
  const [users, setUsers] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<UserPermissions>({
    allowedTools: [],
    deniedTools: [],
    allowedDirectories: [],
    allowedSkills: [],
    deniedSkills: [],
    permissionMode: 'default',
  });
  // Store selections for acceptEdits mode separately to preserve them when switching modes
  const [acceptEditsState, setAcceptEditsState] = useState<{
    allowedTools: string[];
    deniedTools: string[];
    allowedSkills: string[];
    deniedSkills: string[];
  }>({
    allowedTools: [],
    deniedTools: [],
    allowedSkills: [],
    deniedSkills: [],
  });
  const [error, setError] = useState('');
  const [newDirectory, setNewDirectory] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [toolsMaxWidth, setToolsMaxWidth] = useState(0);
  const [skillsMaxWidth, setSkillsMaxWidth] = useState(0);
  const [permissionModeWidth, setPermissionModeWidth] = useState(0);
  const [userSelectWidth, setUserSelectWidth] = useState(0);

  // Only mike@shaffercon.com can access settings
  if (currentUsername !== 'mike@shaffercon.com') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="rounded-2xl max-w-md shadow-lg" style={{ backgroundColor: 'rgb(250, 249, 245)', border: '1px solid rgba(31, 30, 29, 0.15)', padding: '32px' }}>
          <h2 className="text-xl font-semibold text-zinc-900" style={{ marginBottom: '12px' }}>Access Denied</h2>
          <p className="text-zinc-600" style={{ marginBottom: '24px' }}>Only administrators can access settings.</p>
          <button
            onClick={onClose}
            className="w-full rounded-lg text-zinc-900 font-medium hover:bg-zinc-100 transition-colors"
            style={{ border: '1px solid rgba(31, 30, 29, 0.15)', backgroundColor: 'rgb(255, 255, 255)', padding: '12px 16px' }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  useEffect(() => {
    loadUsers();
    loadSkills();
  }, []);

  useEffect(() => {
    if (selectedUser) {
      loadPermissions(selectedUser);
    }
  }, [selectedUser]);

  // Calculate max width for tools (checkbox + text + gap)
  useEffect(() => {
    const maxWidth = Math.max(...ALL_TOOLS.map(tool => measureTextWidth(tool))) + 32; // 32 = checkbox (16px) + gap (8px) + padding
    setToolsMaxWidth(Math.ceil(maxWidth));
  }, []);

  // Calculate max width for skills (checkbox + text + gap)
  useEffect(() => {
    if (availableSkills.length > 0) {
      const maxWidth = Math.max(...availableSkills.map(skill => measureTextWidth(skill))) + 32; // 32 = checkbox (16px) + gap (8px) + padding
      setSkillsMaxWidth(Math.ceil(maxWidth));
    }
  }, [availableSkills]);

  // Calculate width for permission mode dropdown based on selected option
  useEffect(() => {
    const currentMode = PERMISSION_MODES.find(mode => mode.value === permissions.permissionMode);
    if (currentMode) {
      const textWidth = measureTextWidth(currentMode.label + ' '); // add space to text width
      const totalWidth = textWidth + 22; // text + space + arrow
      setPermissionModeWidth(Math.ceil(totalWidth));
    }
  }, [permissions.permissionMode]);

  // Calculate width for user select dropdown based on selected user
  useEffect(() => {
    if (selectedUser) {
      const displayName = selectedUser.split('@')[0].charAt(0).toUpperCase() + selectedUser.split('@')[0].slice(1);
      const textWidth = measureTextWidth(displayName);
      const totalWidth = textWidth + 22; // text + space for arrow
      setUserSelectWidth(Math.ceil(totalWidth));
    }
  }, [selectedUser]);

  const loadUsers = async () => {
    try {
      const backendUrl = getBackendUrl();
      const workspaceUrl = `${backendUrl}/api/workspace/users`;
      console.log('[Settings] Loading users from Google Workspace:', workspaceUrl);

      // Load from Google Workspace only
      const workspaceResponse = await fetch(workspaceUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      console.log('[Settings] Workspace API response status:', workspaceResponse.status);

      if (workspaceResponse.ok) {
        const workspaceData = await workspaceResponse.json();
        console.log('[Settings] Workspace users received:', workspaceData.users?.length || 0, 'users');
        // Extract emails from workspace users for the user list
        let userEmails = workspaceData.users.map((user: any) => user.email);
        // Sort so mike@shaffercon.com comes first
        userEmails.sort((a: string, b: string) => {
          if (a === 'mike@shaffercon.com') return -1;
          if (b === 'mike@shaffercon.com') return 1;
          return a.localeCompare(b);
        });
        console.log('[Settings] Setting users to:', userEmails);
        setUsers(userEmails);
        if (userEmails.length > 0 && !selectedUser) {
          setSelectedUser(userEmails[0]);
        }
      } else {
        console.error('[Settings] Failed to load Google Workspace users, status:', workspaceResponse.status);
        const errorText = await workspaceResponse.text();
        console.error('[Settings] Error response:', errorText);
        setError('Failed to load Google Workspace users: ' + errorText);
      }
    } catch (err) {
      console.error('[Settings] Error loading users:', err);
      setError('Failed to load users from Google Workspace');
    }
  };

  const loadPermissions = async (username: string) => {
    try {
      const response = await fetch(`${getBackendUrl()}/api/admin/permissions/${username}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setPermissions(data);
        // Initialize acceptEditsState with the loaded data if permissionMode is acceptEdits
        if (data.permissionMode === 'acceptEdits') {
          setAcceptEditsState({
            allowedTools: data.allowedTools,
            deniedTools: data.deniedTools,
            allowedSkills: data.allowedSkills,
            deniedSkills: data.deniedSkills
          });
        }
      }
    } catch (err) {
      setError('Failed to load permissions');
    }
  };

  const loadSkills = async () => {
    try {
      const backendUrl = getBackendUrl();
      const skillsUrl = `${backendUrl}/api/skills`;
      console.log('[Settings] Loading skills from:', skillsUrl);

      const response = await fetch(skillsUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      console.log('[Settings] Skills API response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('[Settings] Skills received:', data.skills?.length || 0, 'skills');
        console.log('[Settings] Skills:', data.skills);
        setAvailableSkills(data.skills || []);
      } else {
        const errorText = await response.text();
        console.error('[Settings] Failed to load skills, status:', response.status);
        console.error('[Settings] Error response:', errorText);
      }
    } catch (err) {
      console.error('Failed to load skills:', err);
    }
  };

  // Auto-save permissions with debouncing
  useEffect(() => {
    if (!selectedUser) return;

    const saveTimer = setTimeout(() => {
      setIsSaving(true);
      setError('');

      fetch(`${getBackendUrl()}/api/admin/permissions/${selectedUser}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(permissions)
      })
        .then((response) => {
          if (response.ok) {
            setError('');
          } else {
            setError('Failed to save changes');
          }
        })
        .catch((err) => {
          console.error('Error auto-saving permissions:', err);
          setError('Failed to save changes');
        })
        .finally(() => {
          setIsSaving(false);
        });
    }, 1000); // 1 second debounce delay

    return () => clearTimeout(saveTimer);
  }, [permissions, selectedUser, token]);

  const toggleTool = (tool: string) => {
    const isEnabled = permissions.allowedTools.includes(tool) && !permissions.deniedTools.includes(tool);

    if (isEnabled) {
      // Remove from allowed
      const newAllowedTools = permissions.allowedTools.filter(t => t !== tool);
      setPermissions({
        ...permissions,
        allowedTools: newAllowedTools
      });
      // Save to acceptEditsState if in that mode
      if (permissions.permissionMode === 'acceptEdits') {
        setAcceptEditsState({
          ...acceptEditsState,
          allowedTools: newAllowedTools
        });
      }
    } else {
      // Add to allowed and remove from denied
      const newAllowedTools = [...permissions.allowedTools, tool];
      const newDeniedTools = permissions.deniedTools.filter(t => t !== tool);
      setPermissions({
        ...permissions,
        allowedTools: newAllowedTools,
        deniedTools: newDeniedTools
      });
      // Save to acceptEditsState if in that mode
      if (permissions.permissionMode === 'acceptEdits') {
        setAcceptEditsState({
          ...acceptEditsState,
          allowedTools: newAllowedTools,
          deniedTools: newDeniedTools
        });
      }
    }
  };

  const toggleSkill = (skill: string) => {
    const isEnabled = permissions.allowedSkills.includes(skill) && !permissions.deniedSkills.includes(skill);

    if (isEnabled) {
      // Remove from allowed
      const newAllowedSkills = permissions.allowedSkills.filter(s => s !== skill);
      setPermissions({
        ...permissions,
        allowedSkills: newAllowedSkills
      });
      // Save to acceptEditsState if in that mode
      if (permissions.permissionMode === 'acceptEdits') {
        setAcceptEditsState({
          ...acceptEditsState,
          allowedSkills: newAllowedSkills
        });
      }
    } else {
      // Add to allowed and remove from denied
      const newAllowedSkills = [...permissions.allowedSkills, skill];
      const newDeniedSkills = permissions.deniedSkills.filter(s => s !== skill);
      setPermissions({
        ...permissions,
        allowedSkills: newAllowedSkills,
        deniedSkills: newDeniedSkills
      });
      // Save to acceptEditsState if in that mode
      if (permissions.permissionMode === 'acceptEdits') {
        setAcceptEditsState({
          ...acceptEditsState,
          allowedSkills: newAllowedSkills,
          deniedSkills: newDeniedSkills
        });
      }
    }
  };

  const addDirectory = () => {
    if (newDirectory && !permissions.allowedDirectories.includes(newDirectory)) {
      setPermissions({
        ...permissions,
        allowedDirectories: [...permissions.allowedDirectories, newDirectory]
      });
      setNewDirectory('');
    }
  };

  const removeDirectory = (dir: string) => {
    setPermissions({
      ...permissions,
      allowedDirectories: permissions.allowedDirectories.filter(d => d !== dir)
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'rgb(250, 249, 245)', minWidth: 0, overflow: 'hidden' }}>
      <div className="sticky top-0" style={{ backgroundColor: 'rgb(250, 249, 245)', borderBottom: '1px solid rgba(31, 30, 29, 0.15)', padding: '24px 32px', zIndex: 10 }}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4" style={{ flex: 1 }}>
            <h2 className="text-2xl font-semibold text-zinc-900">User Permissions</h2>
            {users.length > 0 && (
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="text-zinc-900 appearance-none bg-transparent focus:outline-none"
                style={{
                  width: userSelectWidth > 0 ? `${userSelectWidth}px` : 'auto',
                  fontSize: '0.9375rem',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='2' stroke='%2371717a'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19.5 8.25l-7.5 7.5-7.5-7.5'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right center',
                  backgroundSize: '16px 16px'
                }}
              >
                {users.map(user => {
                  const displayName = user.split('@')[0].charAt(0).toUpperCase() + user.split('@')[0].slice(1);
                  return <option key={user} value={user}>{displayName}</option>;
                })}
              </select>
            )}
            <select
              value={permissions.permissionMode}
              onChange={(e) => {
                const newMode = e.target.value as any;
                if (newMode === 'bypassPermissions') {
                  setPermissions({
                    ...permissions,
                    permissionMode: newMode,
                    allowedTools: ALL_TOOLS,
                    deniedTools: [],
                    allowedSkills: availableSkills,
                    deniedSkills: []
                  });
                } else if (newMode === 'acceptEdits') {
                  // Restore previously saved settings for acceptEdits mode
                  setPermissions({
                    ...permissions,
                    permissionMode: newMode,
                    allowedTools: acceptEditsState.allowedTools,
                    deniedTools: acceptEditsState.deniedTools,
                    allowedSkills: acceptEditsState.allowedSkills,
                    deniedSkills: acceptEditsState.deniedSkills
                  });
                } else {
                  // default mode - no tools or skills
                  setPermissions({
                    ...permissions,
                    permissionMode: newMode,
                    allowedTools: [],
                    deniedTools: [],
                    allowedSkills: [],
                    deniedSkills: []
                  });
                }
              }}
              className="text-zinc-900 appearance-none bg-transparent focus:outline-none"
              style={{
                width: permissionModeWidth > 0 ? `${permissionModeWidth}px` : 'auto',
                fontSize: '0.9375rem',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='2' stroke='%2371717a'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19.5 8.25l-7.5 7.5-7.5-7.5'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right center',
                backgroundSize: '16px 16px'
              }}
            >
              {PERMISSION_MODES.map(mode => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>
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

      <div className="overflow-y-auto" style={{ flex: 1, padding: '32px', minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '40px', paddingBottom: '32px', width: '100%' }}>


          {/* Tools */}
          <div>
            <label className="block text-sm font-medium text-zinc-900" style={{ marginBottom: '12px' }}>
              Tools
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${Math.max(toolsMaxWidth, 100)}px, 1fr))`, gap: '12px 20px', width: '100%' }}>
              {ALL_TOOLS.map(tool => {
                const isEnabled = permissions.allowedTools.includes(tool) && !permissions.deniedTools.includes(tool);
                const isDisabledMode = permissions.permissionMode === 'default' || permissions.permissionMode === 'bypassPermissions';
                return (
                  <label
                    key={tool}
                    className="flex items-center cursor-pointer"
                    style={{
                      gap: '8px',
                      opacity: isDisabledMode ? 0.5 : 1,
                      pointerEvents: isDisabledMode ? 'none' : 'auto',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => toggleTool(tool)}
                      disabled={isDisabledMode}
                    />
                    <span className="text-sm text-zinc-900 font-medium select-none">{tool}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Skills */}
          <div>
            <label className="block text-sm font-medium text-zinc-900" style={{ marginBottom: '12px' }}>
              Skills
            </label>
            {availableSkills.length === 0 ? (
              <p className="text-sm text-zinc-500 italic" style={{ padding: '8px 0' }}>No skills available</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${Math.max(skillsMaxWidth, 100)}px, 1fr))`, gap: '12px 20px', width: '100%' }}>
                {availableSkills.map(skill => {
                  const isEnabled = permissions.allowedSkills.includes(skill) && !permissions.deniedSkills.includes(skill);
                  const isDisabledMode = permissions.permissionMode === 'default' || permissions.permissionMode === 'bypassPermissions';
                  return (
                    <label
                      key={skill}
                      className="flex items-center cursor-pointer"
                      style={{
                        gap: '8px',
                        opacity: isDisabledMode ? 0.5 : 1,
                        pointerEvents: isDisabledMode ? 'none' : 'auto',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => toggleSkill(skill)}
                        disabled={isDisabledMode}
                      />
                      <span className="text-sm text-zinc-900 font-medium select-none">{skill}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Allowed Directories */}
          <div>
            <label className="block text-sm font-medium text-zinc-900" style={{ marginBottom: '12px' }}>
              Allowed Directories
            </label>
            <div className="flex" style={{ gap: '12px', marginBottom: '12px' }}>
              <input
                type="text"
                value={newDirectory}
                onChange={(e) => setNewDirectory(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addDirectory()}
                placeholder="/path/to/directory"
                className="flex-1 rounded-lg text-zinc-900 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-opacity-20"
                style={{
                  border: '1px solid rgba(31, 30, 29, 0.15)',
                  backgroundColor: 'rgb(255, 255, 255)',
                  padding: '10px 16px'
                }}
              />
              <button
                onClick={addDirectory}
                className="rounded-lg text-zinc-900 font-medium hover:bg-zinc-100 transition-colors"
                style={{ border: '1px solid rgba(31, 30, 29, 0.15)', backgroundColor: 'rgb(255, 255, 255)', padding: '10px 20px' }}
              >
                Add
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {permissions.allowedDirectories.map(dir => (
                <div
                  key={dir}
                  className="flex items-center justify-between rounded-lg"
                  style={{ border: '1px solid rgba(31, 30, 29, 0.15)', backgroundColor: 'rgb(255, 255, 255)', padding: '12px 16px' }}
                >
                  <span className="text-sm text-zinc-900 font-mono">{dir}</span>
                  <button
                    onClick={() => removeDirectory(dir)}
                    className="text-sm font-medium transition-colors rounded-md hover:bg-red-50"
                    style={{ color: 'rgb(220, 38, 38)', padding: '6px 12px' }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {permissions.allowedDirectories.length === 0 && (
                <p className="text-sm text-zinc-500 italic" style={{ padding: '8px 0' }}>No directory restrictions</p>
              )}
            </div>
          </div>

          {/* Messages */}
          {error && (
            <div className="rounded-lg text-sm font-medium" style={{ backgroundColor: 'rgb(254, 242, 242)', border: '1px solid rgb(252, 165, 165)', color: 'rgb(220, 38, 38)', padding: '16px' }}>
              {error}
            </div>
          )}

          </div>
      </div>
    </div>
  );
}
