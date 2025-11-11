'use client';

import { useState, useEffect } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

interface Conversation {
  id: string;
  title: string;
  timestamp: Date;
  messages: Message[];
  username?: string;
  folderName?: string;
  sessionId?: string;
}

interface FolderInfo {
  name: string;
  count: number;
  path: string;
}

interface ChatsViewProps {
  token: string;
  currentUsername: string;
  onClose: () => void;
  onSelectConversation: (conversation: Conversation) => void;
}

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  folderName?: string;
  count: number;
  isLoaded: boolean;
  conversations?: Conversation[];
}

export default function ChatsView({ token, currentUsername, onClose, onSelectConversation }: ChatsViewProps) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const isAdmin = currentUsername === 'mike@shaffercon.com';

  useEffect(() => {
    loadFolderStructure();
  }, []);

  const loadFolderStructure = async () => {
    try {
      const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

      const response = await fetch(`http://${hostname}:3001/api/folders`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const folders: FolderInfo[] = await response.json();
        const builtTree = buildTreeFromFolders(folders);
        setTree(builtTree);
      }
    } catch (error) {
      console.error('Error loading folder structure:', error);
    } finally {
      setLoading(false);
    }
  };

  const buildTreeFromFolders = (folders: FolderInfo[]): TreeNode => {
    const root: TreeNode = {
      name: '',
      path: '',
      children: new Map(),
      count: 0,
      isLoaded: true
    };

    // First pass: build the tree structure
    folders.forEach(folder => {
      let folderPath = folder.name;
      folderPath = folderPath.replace(/^-Users-[^-]+-/, '');
      const parts = folderPath.split('-').filter(p => p);

      let currentNode = root;
      let currentPath = '';

      parts.forEach((part, index) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        if (!currentNode.children.has(part)) {
          const isLeaf = index === parts.length - 1;
          currentNode.children.set(part, {
            name: part,
            path: currentPath,
            children: new Map(),
            folderName: isLeaf ? folder.name : undefined,
            count: 0,
            isLoaded: false
          });
        }

        currentNode = currentNode.children.get(part)!;
      });
    });

    // Second pass: calculate counts (leaf nodes get direct count, parent nodes get sum of children)
    const calculateCounts = (node: TreeNode): number => {
      if (node.children.size === 0) {
        // Leaf node - find its count from folders array
        const folder = folders.find(f => {
          const cleanPath = f.name.replace(/^-Users-[^-]+-/, '');
          return cleanPath === node.path.replace(/\//g, '-');
        });
        node.count = folder?.count || 0;
        return node.count;
      } else {
        // Parent node - sum children counts
        let totalCount = 0;
        node.children.forEach(child => {
          totalCount += calculateCounts(child);
        });
        node.count = totalCount;
        return totalCount;
      }
    };

    // Calculate counts starting from root's children
    root.children.forEach(child => calculateCounts(child));

    return root;
  };


  const togglePath = async (node: TreeNode) => {
    console.log('[togglePath] Called for node:', node.name, 'path:', node.path, 'isLoaded:', node.isLoaded);
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(node.path)) {
      console.log('[togglePath] Collapsing node:', node.path);
      newExpanded.delete(node.path);
    } else {
      console.log('[togglePath] Expanding node:', node.path);
      newExpanded.add(node.path);

      // Load conversations for this node if not already loaded
      if (!node.isLoaded) {
        console.log('[togglePath] Loading conversations for node:', node.path);
        await loadConversationsForNode(node);
      } else {
        console.log('[togglePath] Node already loaded, skipping');
      }
    }
    setExpandedPaths(newExpanded);
  };

  const loadConversationsForNode = async (node: TreeNode) => {
    try {
      console.log('[loadConversationsForNode] Starting load for node:', node.name, 'folderName:', node.folderName, 'path:', node.path);
      const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

      let response;
      let url;
      if (node.folderName) {
        // Leaf node - use specific folder endpoint
        const encodedFolderName = encodeURIComponent(node.folderName);
        url = `http://${hostname}:3001/api/folder-conversations/${encodedFolderName}`;
        console.log('[loadConversationsForNode] Calling leaf endpoint:', url);
        response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      } else {
        // Parent node - use path pattern endpoint
        const encodedPath = encodeURIComponent(node.path);
        url = `http://${hostname}:3001/api/path-conversations?path=${encodedPath}`;
        console.log('[loadConversationsForNode] Calling parent endpoint:', url);
        response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      }

      if (response.ok) {
        const convs: Conversation[] = await response.json();
        console.log('[loadConversationsForNode] Loaded', convs.length, 'conversations for node:', node.name);

        // Update the tree with the conversations
        setTree(prevTree => {
          if (!prevTree) return prevTree;

          const updateNode = (n: TreeNode): TreeNode => {
            if (n.path === node.path) {
              return { ...n, conversations: convs, isLoaded: true };
            }

            const newChildren = new Map<string, TreeNode>();
            n.children.forEach((child, key) => {
              newChildren.set(key, updateNode(child));
            });

            return { ...n, children: newChildren };
          };

          return updateNode(prevTree);
        });
      } else {
        console.error('[loadConversationsForNode] Failed to load conversations, status:', response.status);
      }
    } catch (error) {
      console.error('Error loading conversations for node:', error);
    }
  };


  const handleConversationClick = (conv: Conversation) => {
    onSelectConversation(conv);
  };

  // Render tree recursively for left panel
  const renderTreeNode = (node: TreeNode, depth: number = 0): JSX.Element[] => {
    const elements: JSX.Element[] = [];

    Array.from(node.children.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([name, childNode]) => {
        const isExpanded = expandedPaths.has(childNode.path);
        const hasChildren = childNode.children.size > 0;

        elements.push(
          <div key={childNode.path}>
            <div
              className="flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer transition-colors hover:bg-zinc-100"
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              {hasChildren && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePath(childNode);
                  }}
                  className="w-4 h-4 flex items-center justify-center flex-shrink-0"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className={`w-3 h-3 text-zinc-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              )}

              {!hasChildren && <div className="w-4 flex-shrink-0" />}

              <div className="flex items-center gap-2 flex-1 min-w-0">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-4 h-4 text-zinc-900 flex-shrink-0"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>

                <span className="text-sm text-zinc-900 truncate">{name}</span>
                {childNode.count > 0 && (
                  <span className="text-xs text-zinc-500 ml-auto flex-shrink-0">
                    {childNode.count}
                  </span>
                )}
              </div>
            </div>

            {isExpanded && (
              <div>
                {/* Render child folders first */}
                {hasChildren && renderTreeNode(childNode, depth + 1)}
                {/* Render conversations for this node after folders */}
                {childNode.conversations && childNode.conversations.map(conv => (
                  <div
                    key={conv.id}
                    onClick={() => handleConversationClick(conv)}
                    className="flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer transition-colors hover:bg-zinc-100"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                  >
                    <div className="w-4 flex-shrink-0" />
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      className="w-4 h-4 text-zinc-900 flex-shrink-0"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                    </svg>
                    <span className="text-sm text-zinc-700 truncate">{conv.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      });

    return elements;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: 'rgb(250, 249, 245)' }}>
        <div className="text-zinc-500">Loading folders...</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'rgb(250, 249, 245)', overflow: 'hidden' }}>
      {/* Header */}
      <div
        className="sticky top-0"
        style={{
          backgroundColor: 'rgb(250, 249, 245)',
          borderBottom: '1px solid rgba(31, 30, 29, 0.15)',
          padding: '24px 32px',
          zIndex: 10
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-zinc-900">
            {isAdmin ? 'All Chats' : 'My Chats'}
          </h2>
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

      {/* Folder Tree with inline conversations */}
      <div className="overflow-y-auto" style={{ flex: 1, minHeight: 0, padding: '32px' }}>
        <div className="bg-white rounded-lg" style={{ border: '1px solid rgba(31, 30, 29, 0.15)', padding: '8px' }}>
          {tree && renderTreeNode(tree)}
        </div>
      </div>
    </div>
  );
}
