'use client';

import { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import ChatMessage from './components/ChatMessage';
import ChatInput from './components/ChatInput';
import Sidebar from './components/Sidebar';
import ThemeToggle from './components/ThemeToggle';
import Login from './components/Login';
import Settings from './components/Settings';
import UserProfile from './components/UserProfile';
import ChatsView from './components/ChatsView';
import ClaudeLogo from './components/ClaudeLogo';
import ToolUsage from './components/ToolUsage';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolUses?: { tool: string; toolUseId: string }[];
  contentBlocks?: Array<{type: 'text', content: string} | {type: 'tool', tool: string, toolUseId: string, input?: any}>;
}

interface Conversation {
  id: string;
  title: string;
  timestamp: Date;
  messages: Message[];
  sessionId?: string;
}

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [currentFolderName, setCurrentFolderName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<'chat' | 'settings' | 'profile' | 'chats'>('chat');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [userFirstName, setUserFirstName] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Use relative paths for API calls (works through tunnel and locally)
  const BACKEND_URL = '';

  const currentConversation = conversations.find(c => c.id === currentConversationId);

  // Detect mobile and orientation
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      setIsLandscape(window.innerWidth > window.innerHeight);
      // Auto-collapse sidebar in landscape mode on mobile
      if (window.innerWidth < 768 && window.innerWidth > window.innerHeight) {
        setSidebarCollapsed(true);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', checkMobile);
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, []);

  // Prevent all zoom attempts
  useEffect(() => {
    // Prevent pinch zoom
    const preventZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };

    // Prevent wheel zoom (ctrl+wheel or pinch on trackpad)
    const preventWheelZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    // Prevent keyboard zoom
    const preventKeyboardZoom = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '0' || e.key === '=' || e.key === '_')) {
        e.preventDefault();
      }
    };

    document.addEventListener('touchmove', preventZoom, { passive: false });
    document.addEventListener('wheel', preventWheelZoom, { passive: false });
    document.addEventListener('keydown', preventKeyboardZoom, { passive: false });

    return () => {
      document.removeEventListener('touchmove', preventZoom);
      document.removeEventListener('wheel', preventWheelZoom);
      document.removeEventListener('keydown', preventKeyboardZoom);
    };
  }, []);

  // Handle keyboard visibility using Visual Viewport API
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const updateKeyboardHeight = () => {
      const viewport = window.visualViewport!;
      // Calculate keyboard height more accurately
      const windowHeight = window.innerHeight;
      const viewportHeight = viewport.height;
      const viewportOffsetTop = viewport.offsetTop || 0;

      // Keyboard height is the difference between window height and visible viewport
      const calculatedHeight = windowHeight - viewportHeight - viewportOffsetTop;
      const finalHeight = Math.max(0, calculatedHeight);

      setKeyboardHeight(finalHeight);

      // Force header to stay at viewport top even with keyboard
      const header = document.querySelector('header');
      if (header) {
        (header as HTMLElement).style.top = '0px';
        (header as HTMLElement).style.position = 'fixed';
      }
    };

    // Lock header position constantly
    const lockHeader = () => {
      const header = document.querySelector('header');
      if (header) {
        (header as HTMLElement).style.top = '0px';
        (header as HTMLElement).style.position = 'fixed';
        (header as HTMLElement).style.width = '100%';
        (header as HTMLElement).style.zIndex = '9999';
      }
    };

    // Update on various events
    window.visualViewport.addEventListener('resize', updateKeyboardHeight);
    window.visualViewport.addEventListener('scroll', () => {
      lockHeader();
      updateKeyboardHeight();
    });

    // Also listen to focus events on input fields
    const handleFocusIn = () => {
      setTimeout(updateKeyboardHeight, 300);
    };

    const handleFocusOut = () => {
      setTimeout(() => setKeyboardHeight(0), 300);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    // Lock initially and on interval
    lockHeader();
    updateKeyboardHeight();
    const intervalId = setInterval(lockHeader, 500);

    return () => {
      window.visualViewport?.removeEventListener('resize', updateKeyboardHeight);
      window.visualViewport?.removeEventListener('scroll', updateKeyboardHeight);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      clearInterval(intervalId);
    };
  }, []);

  // Load token from localStorage
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUsername = localStorage.getItem('username');
    if (savedToken && savedUsername) {
      setToken(savedToken);
      setUsername(savedUsername);
    }
  }, []);

  // Load user's first name from config
  useEffect(() => {
    const loadUserConfig = async () => {
      if (!token || !username) return;

      try {
        const response = await fetch(`${BACKEND_URL}/api/user/config/${username.toLowerCase()}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const config = await response.json();
          setUserFirstName(config.firstName || username);
        }
      } catch (error) {
        console.error('Failed to load user config:', error);
      }
    };

    loadUserConfig();
  }, [token, username, BACKEND_URL]);

  const handleLogin = (newToken: string, newUsername: string) => {
    setToken(newToken);
    setUsername(newUsername);
    localStorage.setItem('token', newToken);
    localStorage.setItem('username', newUsername);
  };

  const handleLogout = () => {
    setToken(null);
    setUsername(null);
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setConversations([]);
    setCurrentConversationId(null);
  };

  // Load conversations from backend
  useEffect(() => {
    if (!token) return;

    const loadConversations = async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/api/conversations`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setConversations(data.map((c: any) => ({
            ...c,
            timestamp: new Date(c.timestamp)
          })));
        }
      } catch (error) {
        console.error('Failed to load conversations:', error);
      }
    };

    loadConversations();
  }, [token, BACKEND_URL]);

  // Reload conversations from backend (fetch fresh data)
  const reloadConversations = async () => {
    if (!token) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/conversations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setConversations(data.map((c: any) => ({
          ...c,
          timestamp: new Date(c.timestamp)
        })));
      }
    } catch (error) {
      console.error('Failed to reload conversations:', error);
    }
  };

  // Auto-scroll to bottom only when streaming or user is near bottom
  useEffect(() => {
    if (streamingContent || !messagesEndRef.current) return;

    const scrollContainer = messagesEndRef.current.parentElement;
    if (!scrollContainer) return;

    // Only auto-scroll if user is near the bottom (within 100px)
    const isNearBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 100;

    if (isNearBottom) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentConversation?.messages]);

  // Always scroll when streaming - use instant scroll to keep up with fast updates
  useEffect(() => {
    if (streamingContent && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [streamingContent]);

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  const handleNewConversation = () => {
    const newConv: Conversation = {
      id: Date.now().toString(),
      title: 'New conversation',
      timestamp: new Date(),
      messages: [],
    };
    setConversations(prev => [newConv, ...prev]);
    setCurrentConversationId(newConv.id);
  };

  const handleSelectConversation = (id: string) => {
    setCurrentConversationId(id);
    setStreamingContent('');
    // Close sidebar on mobile when a chat is selected
    if (isMobile) {
      setSidebarCollapsed(true);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/conversations/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        setConversations(prev => prev.filter(c => c.id !== id));
        if (currentConversationId === id) {
          setCurrentConversationId(null);
        }
      } else {
        const error = await response.json();
        console.error('Failed to delete conversation:', error);
        alert('Failed to delete conversation: ' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
      alert('Error deleting conversation');
    }
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to delete all conversations? This cannot be undone.')) {
      setConversations([]);
      setCurrentConversationId(null);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (content: string) => {
    console.log('[handleSendMessage] Called with content:', content);
    console.log('[handleSendMessage] currentConversationId:', currentConversationId);

    if (!currentConversationId) {
      // Send message without conversation ID - backend will create new session
      console.log('[handleSendMessage] Creating new conversation');
      await sendMessageWithConversation(content, null);
      return;
    }
    await sendMessageWithConversation(content, currentConversationId);
  };

  const sendMessageWithConversation = async (content: string, conversationId: string | null) => {
    console.log('[sendMessageWithConversation] Starting with conversationId:', conversationId);

    // Show user message immediately
    setPendingUserMessage(content);

    setIsLoading(true);
    setStreamingContent('');

    // Get the current conversation's sessionId (if any)
    const conversation = conversationId ? conversations.find(c => c.id === conversationId) : null;
    console.log('[sendMessageWithConversation] Found conversation:', conversation);

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    try {
      console.log('[sendMessageWithConversation] Fetching from backend...');
      const response = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: content,
          sessionId: conversation?.sessionId,
          folderName: currentFolderName,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let contentBlocks: Array<{type: 'text', content: string} | {type: 'tool', tool: string, toolUseId: string}> = [];
      let currentTextContent = '';
      let currentBlockIndex = -1;

      console.log('[Stream] Starting to read stream, reader exists:', !!reader);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('[Stream] Stream reading complete');
            break;
          }

          console.log('[Stream] Received chunk, size:', value?.length);

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          console.log('[Stream] Split into', lines.length, 'lines');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              console.log('[Stream] Parsed data:', data.type);

              if (data.error) {
                console.error('Stream error:', data.error);
                break;
              }

              // Store session ID - backend handles this
              if (data.type === 'session_id') {
                // Backend already saved the session ID
                continue;
              }

              // Handle text block start
              if (data.type === 'text_block_start') {
                currentBlockIndex = data.blockIndex;
                currentTextContent = '';
              }

              // Pour in text as it arrives
              if (data.type === 'text' && data.content) {
                currentTextContent += data.content;
                fullContent += data.content;
                setStreamingContent(fullContent);
                console.log('[Stream] Updating streaming content, length:', fullContent.length);
              }

              // Handle text block end - save the completed text block
              if (data.type === 'text_block_end') {
                if (currentTextContent) {
                  contentBlocks.push({ type: 'text', content: currentTextContent });
                  currentTextContent = '';
                }
              }

              // Add tool usage as a proper block
              if (data.type === 'tool_use') {
                // Finish any current text block first
                if (currentTextContent) {
                  contentBlocks.push({ type: 'text', content: currentTextContent });
                  currentTextContent = '';
                }

                // Add tool block
                contentBlocks.push({
                  type: 'tool',
                  tool: data.tool,
                  toolUseId: data.toolUseId
                });

                // Also add to plain content for display during streaming
                fullContent += `\n\n[Using ${data.tool}]\n\n`;
                setStreamingContent(fullContent);
                console.log('[Stream] Tool use:', data.tool);
              }

              // When done, reload from backend
              if (data.type === 'result' || data.done) {
                console.log('[Stream] Stream complete, reloading conversations');
                await reloadConversations();
                console.log('[Stream] Conversations reloaded');

                // If this was a new conversation, select the newest one
                if (!conversationId) {
                  setConversations(prev => {
                    if (prev.length > 0) {
                      // Find the newest conversation by timestamp
                      const newest = prev.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
                      setCurrentConversationId(newest.id);
                      console.log('[Stream] Selected newest conversation:', newest.id);
                    }
                    return prev;
                  });
                }

                // Clear pending states AFTER reload completes
                setIsLoading(false);
                setStreamingContent('');
                setPendingUserMessage(null);
                break;
              }
            }
          }
        }
      }
    } catch (error) {
      // Check if error was due to abort
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Request was aborted by user');
        return; // Don't show error message for user-initiated stops
      }

      console.error('Error sending message:', error);
      // Just reload to show whatever was saved
      await reloadConversations();
      setIsLoading(false);
      setStreamingContent('');
      setPendingUserMessage(null);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: 'rgb(250, 249, 245)', position: 'fixed', width: '100%', height: '100vh', touchAction: 'pan-x pan-y' }}>
      {/* Fixed Header - Always visible, never scrolls, never zooms */}
      <header
        className="fixed top-0 left-0 right-0 flex items-center"
        style={{
          backgroundColor: 'rgb(250, 249, 245)',
          paddingLeft: '0',
          paddingRight: '16px',
          zIndex: 9999,
          position: 'fixed',
          width: '100%',
          touchAction: 'none',
          WebkitTransform: 'translateZ(0)',
          transform: 'translateZ(0)',
          willChange: 'transform',
          height: isLandscape && isMobile ? '36px' : '48px'
        }}
      >
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="rounded-md hover:bg-zinc-100 transition-colors"
          aria-label={sidebarCollapsed ? "Open menu" : "Close menu"}
          style={{
            marginLeft: isMobile ? '8px' : '42px',
            padding: isMobile ? '8px' : '8px 16px'
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="h-6 w-6 text-zinc-600"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
      </header>

      {/* Main content area below header */}
      <div className="flex flex-1 overflow-hidden" style={{ marginTop: isLandscape && isMobile ? '36px' : '48px' }}>
        <Sidebar
          conversations={conversations}
          currentConversationId={currentConversationId}
          onSelectConversation={handleSelectConversation}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
          onClearAll={handleClearAll}
          username={username || 'User'}
          onOpenSettings={() => setCurrentView('settings')}
          onOpenProfile={() => setCurrentView('profile')}
          onOpenChats={() => setCurrentView('chats')}
          onLogout={handleLogout}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        {currentView === 'chat' && (
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {/* Messages - scrollable area that respects fixed header and input box */}
          <div
            style={{
              position: 'fixed',
              top: isLandscape && isMobile ? '36px' : '48px',
              bottom: '0',
              left: isMobile ? '0' : (sidebarCollapsed ? '0' : '256px'),
              right: '0',
              overflowY: 'auto',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
              paddingTop: '20px',
              paddingBottom: `${keyboardHeight > 0 ? keyboardHeight + (isLandscape && isMobile ? 80 : 120) : (isLandscape && isMobile ? 100 : 140)}px`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              transition: 'left 0.3s ease, padding-bottom 0.3s ease',
              zIndex: 10
            }}
          >
          <div style={{ width: '100%', maxWidth: '800px' }}>
            {(!currentConversationId && !pendingUserMessage && !streamingContent) ? (
              <div className="flex items-center justify-center" style={{ paddingLeft: '24px', paddingRight: '24px', minHeight: 'calc(100vh - 228px)' }}>
                <div className="text-center max-w-2xl mx-auto">
                  <div className="mb-6 flex justify-center">
                    <ClaudeLogo size={128} />
                  </div>
                  <h2 className="mb-3 text-3xl font-semibold text-zinc-900">
                    How can I help you today?
                  </h2>
                  <p className="text-zinc-600 max-w-md mx-auto text-sm">
                    Hi, I'm AIVA, your virtual AI assistant for Shaffer Construction. I'm here to help with QuickBooks, Gmail, Calendar, Drive, Sheets, and more.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {currentConversation?.messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    role={message.role}
                    content={message.content}
                    username={userFirstName || username || 'User'}
                    toolUses={message.toolUses}
                    contentBlocks={message.contentBlocks}
                  />
                ))}

                {/* Show pending user message */}
                {pendingUserMessage && (
                  <ChatMessage
                    role="user"
                    content={pendingUserMessage}
                    username={userFirstName || username || 'User'}
                  />
                )}

                {/* Streaming content - raw stream like CLI */}
                {streamingContent && (
                  <ChatMessage
                    role="assistant"
                    content={streamingContent}
                    isStreaming={true}
                    username={userFirstName || username || 'User'}
                  />
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>
          </div>
        </div>
        )}

        {currentView === 'settings' && token && username && (
          <Settings
            token={token}
            currentUsername={username}
            onClose={() => setCurrentView('chat')}
          />
        )}

        {currentView === 'profile' && token && username && (
          <UserProfile
            token={token}
            currentUsername={username}
            onClose={() => setCurrentView('chat')}
          />
        )}

        {currentView === 'chats' && token && username && (
          <ChatsView
            token={token}
            currentUsername={username}
            onClose={() => setCurrentView('chat')}
            onSelectConversation={(conversation) => {
              // Add this conversation to the conversations array if it's not already there
              setConversations(prev => {
                const exists = prev.find(c => c.id === conversation.id);
                if (exists) {
                  return prev;
                }
                return [...prev, conversation];
              });

              setCurrentConversationId(conversation.id);
              setCurrentFolderName(conversation.folderName || null);
              setCurrentView('chat');
            }}
          />
        )}

        {currentView === 'chat' && (
        <>
        {/* Input - FIXED at bottom with spacing, moves with keyboard */}
        <div style={{
          position: 'fixed',
          bottom: `${keyboardHeight > 0 ? keyboardHeight : 0}px`,
          left: isMobile ? '0' : (sidebarCollapsed ? '0' : '256px'),
          right: '0',
          zIndex: 30,
          transition: 'bottom 0.3s ease, left 0.3s ease',
          display: 'flex',
          justifyContent: 'center',
          paddingBottom: keyboardHeight > 0 ? '0' : 'env(safe-area-inset-bottom)'
        }}>
          <div style={{ width: '100%', maxWidth: '800px' }}>
            <ChatInput onSend={handleSendMessage} onStop={handleStop} isLoading={isLoading} />
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
