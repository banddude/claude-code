require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { query } = require('@anthropic-ai/claude-agent-sdk');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ADMIN_USER = 'mike@shaffercon.com';

// User database (simple file-based for now)
const USERS_FILE = path.join(__dirname, 'users.json');
const PERMISSIONS_FILE = path.join(__dirname, 'permissions.json');
const CONVERSATIONS_DIR = path.join(__dirname, 'conversations');
const CLAUDE_SESSIONS_DIR = path.join(__dirname, 'users');
const USER_CONFIGS_DIR = path.join(__dirname, 'user-configs');
const SKILLS_DIR = path.join(process.env.HOME, '.claude', 'skills');

// Ensure directories exist
if (!fs.existsSync(CONVERSATIONS_DIR)) {
  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
}
if (!fs.existsSync(CLAUDE_SESSIONS_DIR)) {
  fs.mkdirSync(CLAUDE_SESSIONS_DIR, { recursive: true });
}

// Initialize users file if it doesn't exist
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({}));
}

// Initialize permissions file if it doesn't exist
if (!fs.existsSync(PERMISSIONS_FILE)) {
  fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify({}));
}

app.use(cors());
app.use(express.json());
app.use(session({
  secret: JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));
app.use(passport.initialize());
app.use(passport.session());

// Configure Passport with Google Strategy
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: '/api/auth/google/callback',
    passReqToCallback: true
  },
  (req, accessToken, refreshToken, profile, done) => {
    // Validate email domain
    const email = profile.emails[0].value;
    if (!email.endsWith('@shaffercon.com')) {
      return done(new Error('Only @shaffercon.com email addresses are allowed'));
    }

    // Create or update user in database
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));

    if (!users[email]) {
      // Create new user with OAuth
      users[email] = {
        googleId: profile.id,
        name: profile.displayName,
        email: email,
        createdAt: new Date().toISOString(),
        isOAuthUser: true
      };
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    }

    return done(null, { username: email, googleId: profile.id });
  }));

  passport.serializeUser((user, done) => {
    done(null, user.username);
  });

  passport.deserializeUser((username, done) => {
    done(null, { username });
  });
}

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error('[AUTH] Token verification failed:', err.message);
      return res.status(403).json({ error: 'Invalid token', details: err.message });
    }
    console.log('[AUTH] Token verified for user:', user.username);
    req.user = user;
    next();
  });
};

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const user = users[username];

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

// Register endpoint (for initial setup)
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));

  if (users[username]) {
    return res.status(400).json({ error: 'User already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  users[username] = { passwordHash, createdAt: new Date().toISOString() };

  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

// Google OAuth routes
app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/api/auth/google/callback',
  (req, res, next) => {
    passport.authenticate('google', (err, user, info) => {
      if (err) {
        // Email domain validation failed
        const frontendHost = req.get('host').replace(':3001', ':3000') || 'localhost:3000';
        return res.redirect(`http://${frontendHost}?error=unauthorized`);
      }
      if (!user) {
        const frontendHost = req.get('host').replace(':3001', ':3000') || 'localhost:3000';
        return res.redirect(`http://${frontendHost}?error=unauthorized`);
      }

      // Generate JWT token for authenticated user
      const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      const frontendHost = req.get('host').replace(':3001', ':3000') || 'localhost:3000';
      const redirectUrl = `http://${frontendHost}?token=${token}&username=${user.username}`;
      res.redirect(redirectUrl);
    })(req, res, next);
  }
);

// Get conversations for user from projects folder
app.get('/api/conversations', authenticateToken, async (req, res) => {
  try {
    const readline = require('readline');
    const username = req.user.username;

    // Extract short username (e.g., "mike" from "mike@shaffercon.com")
    const shortUsername = username.split('@')[0];

    // Get the user's working directory path (same as used in chat endpoint)
    const userDir = path.join(__dirname, 'users', shortUsername);

    // Encode the user directory path as folder name
    // /Users/mikeshaffer/claude-code/claude-ui-clone/claude-ui-backend/users/mike
    // -> -Users-mikeshaffer-claude-code-claude-ui-clone-claude-ui-backend-users-mike
    const projectFolderName = userDir.split(path.sep).join('-').replace(/^-/, '-');

    const projectsFolder = path.join(process.env.HOME, '.claude', 'projects');
    const targetProjectFolder = path.join(projectsFolder, projectFolderName);

    if (!fs.existsSync(targetProjectFolder)) {
      console.log(`Project folder not found: ${targetProjectFolder}`);
      return res.json([]);
    }

    const conversations = [];

    // Helper to read one JSONL file
    const readJsonlFile = (filePath) => {
      return new Promise((resolve) => {
        const stream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
          input: stream,
          crlfDelay: Infinity
        });

        let firstEntry = null;
        const messages = [];
        let lineNum = 0;

        rl.on('line', (line) => {
          lineNum++;
          if (!line.trim()) return;

          try {
            const entry = JSON.parse(line);
            if (lineNum === 1) {
              firstEntry = entry;
            }

            if (entry.type === 'user' || entry.type === 'assistant') {
              // Extract text from content array and preserve content blocks
              let contentText = '';
              let contentBlocks = [];

              if (Array.isArray(entry.message?.content)) {
                // Build content blocks preserving both text and tool_use
                contentBlocks = entry.message.content.map(block => {
                  if (block.type === 'text') {
                    return { type: 'text', content: block.text };
                  } else if (block.type === 'tool_use') {
                    return {
                      type: 'tool',
                      tool: block.name,
                      toolUseId: block.id,
                      input: block.input
                    };
                  }
                  return null;
                }).filter(Boolean);

                // Also build plain text for backwards compatibility
                contentText = entry.message.content
                  .filter(block => block.type === 'text')
                  .map(block => block.text)
                  .join('\n');
              } else if (typeof entry.message?.content === 'string') {
                contentText = entry.message.content;
              }

              messages.push({
                id: entry.uuid,
                role: entry.type === 'user' ? 'user' : 'assistant',
                content: contentText,
                contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
                timestamp: entry.timestamp
              });
            }
          } catch (e) {
            // Skip malformed lines
          }
        });

        rl.on('close', () => {
          resolve({ firstEntry, messages });
        });

        rl.on('error', () => {
          resolve({ firstEntry: null, messages: [] });
        });
      });
    };

    // Read all JSONL files from the target project folder
    const files = fs.readdirSync(targetProjectFolder).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const filePath = path.join(targetProjectFolder, file);
      const { firstEntry, messages } = await readJsonlFile(filePath);

      if (firstEntry && firstEntry.sessionId) {
        const sessionId = firstEntry.sessionId;
        const timestamp = new Date(firstEntry.timestamp);
        const fileId = file.replace('.jsonl', ''); // Use filename as unique ID

        const title = timestamp.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });

        conversations.push({
          id: fileId, // Use filename as unique ID
          title: title,
          timestamp: timestamp,
          messages: messages,
          sessionId: sessionId
        });
      }
    }

    // Sort by timestamp descending (newest first)
    conversations.sort((a, b) => b.timestamp - a.timestamp);

    console.log(`Returning ${conversations.length} conversations`);

    res.json(conversations);
  } catch (error) {
    console.error('Error reading conversations:', error);
    res.json([]);
  }
});

// Get folder structure with counts (fast, no file reading)
app.get('/api/folders', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;

    // Only admin can view all folders
    if (username !== ADMIN_USER) {
      return res.status(403).json({ error: 'Admin only' });
    }

    const projectsFolder = path.join(process.env.HOME, '.claude', 'projects');

    if (!fs.existsSync(projectsFolder)) {
      return res.json([]);
    }

    // Get all folders in projects directory
    const allFolders = fs.readdirSync(projectsFolder, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const folderInfo = [];

    for (const folderName of allFolders) {
      const folderPath = path.join(projectsFolder, folderName);

      try {
        const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));

        if (files.length > 0) {
          folderInfo.push({
            name: folderName,
            count: files.length,
            path: folderPath
          });
        }
      } catch (err) {
        // Skip folders we can't read
        continue;
      }
    }

    console.log(`Returning ${folderInfo.length} folders`);
    res.json(folderInfo);
  } catch (error) {
    console.error('Error reading folders:', error);
    res.json([]);
  }
});

// Get conversations for a path pattern (can match multiple folders)
app.get('/api/path-conversations', authenticateToken, async (req, res) => {
  try {
    const readline = require('readline');
    const username = req.user.username;
    const pathPattern = req.query.path; // e.g., "claude-code"

    // Only admin can view all conversations
    if (username !== ADMIN_USER) {
      return res.status(403).json({ error: 'Admin only' });
    }

    const projectsFolder = path.join(process.env.HOME, '.claude', 'projects');

    if (!fs.existsSync(projectsFolder)) {
      return res.json([]);
    }

    // Convert path like "claude-code/claude-ui-clone" to pattern "-claude-code-claude-ui-clone"
    const folderPattern = '-' + pathPattern.replace(/\//g, '-');

    // Get all folders that match the pattern EXACTLY (not startsWith)
    // This ensures we only return conversations from folders at this exact level
    const allFolders = fs.readdirSync(projectsFolder, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .filter(name => {
        // Remove user prefix for matching
        const cleanName = name.replace(/^-Users-[^-]+-/, '');
        return cleanName === folderPattern.substring(1);
      });

    console.log(`Path pattern "${pathPattern}" matched ${allFolders.length} folders (exact match)`);

    // Helper to read one JSONL file
    const readJsonlFile = (filePath) => {
      return new Promise((resolve) => {
        const stream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
          input: stream,
          crlfDelay: Infinity
        });

        let firstEntry = null;
        const messages = [];
        let lineNum = 0;

        rl.on('line', (line) => {
          lineNum++;
          if (!line.trim()) return;

          try {
            const entry = JSON.parse(line);
            if (lineNum === 1) {
              firstEntry = entry;
            }

            if (entry.type === 'user' || entry.type === 'assistant') {
              let contentText = '';
              if (Array.isArray(entry.message?.content)) {
                contentText = entry.message.content
                  .filter(block => block.type === 'text')
                  .map(block => block.text)
                  .join('\n');
              } else if (typeof entry.message?.content === 'string') {
                contentText = entry.message.content;
              }

              messages.push({
                id: entry.uuid,
                role: entry.type === 'user' ? 'user' : 'assistant',
                content: contentText,
                timestamp: entry.timestamp
              });
            }
          } catch (e) {
            // Skip malformed lines
          }
        });

        rl.on('close', () => {
          resolve({ firstEntry, messages });
        });

        rl.on('error', () => {
          resolve({ firstEntry: null, messages: [] });
        });
      });
    };

    const conversations = [];

    // Process all matching folders
    for (const folderName of allFolders) {
      const folderPath = path.join(projectsFolder, folderName);
      const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const { firstEntry, messages } = await readJsonlFile(filePath);

        if (firstEntry && firstEntry.sessionId) {
          const sessionId = firstEntry.sessionId;
          const timestamp = new Date(firstEntry.timestamp);
          const fileId = file.replace('.jsonl', '');

          const title = timestamp.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });

          conversations.push({
            id: fileId,
            title: title,
            timestamp: timestamp,
            messages: messages,
            sessionId: sessionId,
            username: folderName,
            folderName: folderName
          });
        }
      }
    }

    conversations.sort((a, b) => b.timestamp - a.timestamp);
    console.log(`Returning ${conversations.length} conversations for path "${pathPattern}"`);
    res.json(conversations);
  } catch (error) {
    console.error('Error reading path conversations:', error);
    res.json([]);
  }
});

// Get conversations for a specific folder
app.get('/api/folder-conversations/:folderName', authenticateToken, async (req, res) => {
  try {
    const readline = require('readline');
    const username = req.user.username;
    const folderName = req.params.folderName;

    // Only admin can view all conversations
    if (username !== ADMIN_USER) {
      return res.status(403).json({ error: 'Admin only' });
    }

    const projectsFolder = path.join(process.env.HOME, '.claude', 'projects');
    const folderPath = path.join(projectsFolder, folderName);

    if (!fs.existsSync(folderPath)) {
      return res.json([]);
    }

    // Helper to read one JSONL file
    const readJsonlFile = (filePath) => {
      return new Promise((resolve) => {
        const stream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
          input: stream,
          crlfDelay: Infinity
        });

        let firstEntry = null;
        const messages = [];
        let lineNum = 0;

        rl.on('line', (line) => {
          lineNum++;
          if (!line.trim()) return;

          try {
            const entry = JSON.parse(line);
            if (lineNum === 1) {
              firstEntry = entry;
            }

            if (entry.type === 'user' || entry.type === 'assistant') {
              let contentText = '';
              if (Array.isArray(entry.message?.content)) {
                contentText = entry.message.content
                  .filter(block => block.type === 'text')
                  .map(block => block.text)
                  .join('\n');
              } else if (typeof entry.message?.content === 'string') {
                contentText = entry.message.content;
              }

              messages.push({
                id: entry.uuid,
                role: entry.type === 'user' ? 'user' : 'assistant',
                content: contentText,
                timestamp: entry.timestamp
              });
            }
          } catch (e) {
            // Skip malformed lines
          }
        });

        rl.on('close', () => {
          resolve({ firstEntry, messages });
        });

        rl.on('error', () => {
          resolve({ firstEntry: null, messages: [] });
        });
      });
    };

    const conversations = [];
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const { firstEntry, messages } = await readJsonlFile(filePath);

      if (firstEntry && firstEntry.sessionId) {
        const sessionId = firstEntry.sessionId;
        const timestamp = new Date(firstEntry.timestamp);
        const fileId = file.replace('.jsonl', '');

        const title = timestamp.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });

        conversations.push({
          id: fileId,
          title: title,
          timestamp: timestamp,
          messages: messages,
          sessionId: sessionId,
          username: folderName,
          folderName: folderName
        });
      }
    }

    conversations.sort((a, b) => b.timestamp - a.timestamp);
    res.json(conversations);
  } catch (error) {
    console.error('Error reading folder conversations:', error);
    res.json([]);
  }
});

// Get all conversations from all users (admin only)
app.get('/api/all-conversations', authenticateToken, async (req, res) => {
  try {
    const readline = require('readline');
    const username = req.user.username;

    // Only admin can view all conversations
    if (username !== ADMIN_USER) {
      // For non-admin users, just return their own conversations
      return res.redirect('/api/conversations');
    }

    const projectsFolder = path.join(process.env.HOME, '.claude', 'projects');

    if (!fs.existsSync(projectsFolder)) {
      console.log(`Projects folder not found: ${projectsFolder}`);
      return res.json([]);
    }

    const allConversations = [];

    // Helper to read one JSONL file
    const readJsonlFile = (filePath) => {
      return new Promise((resolve) => {
        const stream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
          input: stream,
          crlfDelay: Infinity
        });

        let firstEntry = null;
        const messages = [];
        let lineNum = 0;

        rl.on('line', (line) => {
          lineNum++;
          if (!line.trim()) return;

          try {
            const entry = JSON.parse(line);
            if (lineNum === 1) {
              firstEntry = entry;
            }

            if (entry.type === 'user' || entry.type === 'assistant') {
              // Extract text from content array and preserve content blocks
              let contentText = '';
              let contentBlocks = [];

              if (Array.isArray(entry.message?.content)) {
                // Build content blocks preserving both text and tool_use
                contentBlocks = entry.message.content.map(block => {
                  if (block.type === 'text') {
                    return { type: 'text', content: block.text };
                  } else if (block.type === 'tool_use') {
                    return {
                      type: 'tool',
                      tool: block.name,
                      toolUseId: block.id,
                      input: block.input
                    };
                  }
                  return null;
                }).filter(Boolean);

                // Also build plain text for backwards compatibility
                contentText = entry.message.content
                  .filter(block => block.type === 'text')
                  .map(block => block.text)
                  .join('\n');
              } else if (typeof entry.message?.content === 'string') {
                contentText = entry.message.content;
              }

              messages.push({
                id: entry.uuid,
                role: entry.type === 'user' ? 'user' : 'assistant',
                content: contentText,
                contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
                timestamp: entry.timestamp
              });
            }
          } catch (e) {
            // Skip malformed lines
          }
        });

        rl.on('close', () => {
          resolve({ firstEntry, messages });
        });

        rl.on('error', () => {
          resolve({ firstEntry: null, messages: [] });
        });
      });
    };

    // Get all folders in projects directory
    const allFolders = fs.readdirSync(projectsFolder, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    console.log(`Found ${allFolders.length} total folders to scan`);

    // Read conversations from ALL folders
    for (const folderName of allFolders) {
      const folderPath = path.join(projectsFolder, folderName);

      // Use the folder name as the username/group
      const extractedUsername = folderName;

      // Read all JSONL files from this folder
      let files = [];
      try {
        files = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
      } catch (err) {
        // Skip folders we can't read
        continue;
      }

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const { firstEntry, messages } = await readJsonlFile(filePath);

        if (firstEntry && firstEntry.sessionId) {
          const sessionId = firstEntry.sessionId;
          const timestamp = new Date(firstEntry.timestamp);
          const fileId = file.replace('.jsonl', '');

          const title = timestamp.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });

          allConversations.push({
            id: fileId,
            title: title,
            timestamp: timestamp,
            messages: messages,
            sessionId: sessionId,
            username: extractedUsername, // Add username to identify which user's chat this is
            folderName: folderName // Keep folder name for deletion
          });
        }
      }
    }

    // Sort by timestamp descending (newest first)
    allConversations.sort((a, b) => b.timestamp - a.timestamp);

    console.log(`Returning ${allConversations.length} total conversations from all users`);

    res.json(allConversations);
  } catch (error) {
    console.error('Error reading all conversations:', error);
    res.json([]);
  }
});

// Save conversations (disabled - conversations are managed by Claude SDK)
app.post('/api/conversations', authenticateToken, (req, res) => {
  res.json({ success: true });
});

// Delete conversation (admin only)
app.delete('/api/conversations/:id', authenticateToken, (req, res) => {
  const username = req.user.username;
  const conversationId = req.params.id;

  // Only admin can delete
  if (username !== ADMIN_USER) {
    return res.status(403).json({ error: 'Only admin can delete conversations' });
  }

  try {
    const shortUsername = username.split('@')[0];
    const userDir = path.join(__dirname, 'users', shortUsername);
    const projectFolderName = userDir.split(path.sep).join('-').replace(/^-/, '-');
    const projectsFolder = path.join(process.env.HOME, '.claude', 'projects');
    const targetProjectFolder = path.join(projectsFolder, projectFolderName);

    // Delete the JSONL file (conversationId is the filename without extension)
    const filePath = path.join(targetProjectFolder, `${conversationId}.jsonl`);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted conversation file: ${filePath}`);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Conversation file not found' });
    }
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// Chat endpoint
app.post('/api/chat', authenticateToken, async (req, res) => {
  const { message, sessionId, folderName } = req.body;
  const username = req.user.username;

  // Extract short username (e.g., "mike" from "mike@shaffercon.com")
  const shortUsername = username.split('@')[0];

  console.log(`[CHAT] User: ${username}, Message: ${message.substring(0, 50)}..., SessionId: ${sessionId || 'new'}, FolderName: ${folderName || 'default'}`);

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Invalid message' });
  }

  // Load user permissions
  const permissions = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf8'));
  const userPermissions = permissions[username] || {
    allowedTools: [],
    deniedTools: [],
    allowedDirectories: [],
    permissionMode: 'default'
  };

  // Determine which directory to use
  let userDir;
  if (folderName && username === ADMIN_USER) {
    // Admin is viewing another user's conversation, use the project folder
    userDir = path.join(process.env.HOME, '.claude', 'projects', folderName);
    console.log(`[CHAT] Admin viewing folder: ${folderName}, using dir: ${userDir}`);
  } else {
    // Normal user or admin in their own folder
    userDir = path.join(CLAUDE_SESSIONS_DIR, shortUsername);
  }

  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  // CRITICAL: Set headers BEFORE any writes and use writeHead for immediate effect
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'none',  // Prevents compression buffering
    'Transfer-Encoding': 'chunked'  // Enable HTTP chunked transfer
  });

  // Enable TCP_NODELAY to disable Nagle's algorithm and send packets immediately
  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setTimeout(0);  // Disable socket timeout
  }

  // Disable Node.js internal buffering
  res.flushHeaders();

  // Send an initial comment to establish the connection immediately
  res.write(':\n\n');
  res.flush ? res.flush() : null;

  try {
    // Build options based on user permissions
    const queryOptions = {
      cwd: userDir,
      includePartialMessages: true,  // Enable real-time streaming
      settingSources: ['project'],  // Enable skills discovery from .claude/skills/
    };

    // If sessionId is provided, resume from that session
    if (sessionId) {
      queryOptions.resume = sessionId;
    }

    // Handle permission mode
    if (userPermissions.permissionMode === 'bypassPermissions') {
      // Use permissionMode directly like Python SDK - no restrictions
      queryOptions.permissionMode = 'bypassPermissions';
    } else if (userPermissions.permissionMode === 'default') {
      // Default mode: chat only, no tools or skills allowed
      queryOptions.permissionMode = 'default';
      queryOptions.allowedTools = [];
      queryOptions.allowedSkills = [];
    } else if (userPermissions.permissionMode === 'acceptEdits') {
      // acceptEdits mode: hand-pick specific tools and skills
      queryOptions.permissionMode = 'acceptEdits';
      // Always set allowedTools and allowedSkills (empty array means nothing is allowed)
      queryOptions.allowedTools = userPermissions.allowedTools && userPermissions.allowedTools.length > 0
        ? userPermissions.allowedTools
        : [];
      queryOptions.allowedSkills = userPermissions.allowedSkills && userPermissions.allowedSkills.length > 0
        ? userPermissions.allowedSkills
        : [];
    }

    if (userPermissions.allowedDirectories && userPermissions.allowedDirectories.length > 0) {
      queryOptions.additionalDirectories = userPermissions.allowedDirectories;
    }

    console.log('[CHAT] Query options:', JSON.stringify(queryOptions, null, 2));

    const queryInstance = query({
      prompt: message,
      options: queryOptions
    });

    let fullResponse = '';
    let currentSessionId = null;
    let currentTextBlock = '';
    let textBlockIndex = 0;

    console.log('[CHAT] Starting to process SDK messages...');

    // Process streaming response
    let messageCount = 0;
    for await (const sdkMsg of queryInstance) {
      messageCount++;
      console.log(`[CHAT] SDK Message #${messageCount}:`, JSON.stringify(sdkMsg, null, 2).substring(0, 200));

      // Capture the Claude session_id from the first message
      if (sdkMsg.session_id && !currentSessionId) {
        currentSessionId = sdkMsg.session_id;
        console.log('[CHAT] Captured session_id:', currentSessionId);

        // Send session_id to frontend so it can track it
        res.write(`data: ${JSON.stringify({
          type: 'session_id',
          sessionId: currentSessionId,
          done: false
        })}\n\n`);
        if (res.flush) res.flush();
      }

      // Handle different message types
      if (sdkMsg.type === 'message') {
        console.log('[CHAT] Processing message, role:', sdkMsg.role);

        // Process content blocks
        if (sdkMsg.content && Array.isArray(sdkMsg.content)) {
          for (let i = 0; i < sdkMsg.content.length; i++) {
            const block = sdkMsg.content[i];
            console.log('[CHAT] Content block', i, 'type:', block.type);

            if (block.type === 'text') {
              // Send text block start
              res.write(`data: ${JSON.stringify({
                type: 'text_block_start',
                blockIndex: i,
                done: false
              })}\n\n`);

              // Send the text content
              res.write(`data: ${JSON.stringify({
                type: 'text',
                content: block.text,
                blockIndex: i,
                done: false
              })}\n\n`);

              // Send text block end
              res.write(`data: ${JSON.stringify({
                type: 'text_block_end',
                blockIndex: i,
                done: false
              })}\n\n`);

              if (res.flush) res.flush();
              fullResponse += block.text;
            } else if (block.type === 'tool_use') {
              console.log('[CHAT] Tool use:', block.name);
              res.write(`data: ${JSON.stringify({
                type: 'tool_use',
                tool: block.name,
                toolUseId: block.id,
                blockIndex: i,
                done: false
              })}\n\n`);
              if (res.flush) res.flush();
            }
          }
        }
      }
      // Handle stream events for real-time streaming (when using includePartialMessages)
      else if (sdkMsg.type === 'stream_event') {
        const event = sdkMsg.event;
        console.log('[CHAT] Stream event type:', event.type);

        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            textBlockIndex = event.index;
            res.write(`data: ${JSON.stringify({
              type: 'text_block_start',
              blockIndex: textBlockIndex,
              done: false
            })}\n\n`);
            if (res.flush) res.flush();
          } else if (event.content_block.type === 'tool_use') {
            console.log('[CHAT] Tool use start:', event.content_block.name);
            res.write(`data: ${JSON.stringify({
              type: 'tool_use',
              tool: event.content_block.name,
              toolUseId: event.content_block.id,
              blockIndex: event.index,
              done: false
            })}\n\n`);
            if (res.flush) res.flush();
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            console.log('[CHAT] Text delta, length:', event.delta.text.length);
            currentTextBlock += event.delta.text;
            fullResponse += event.delta.text;

            res.write(`data: ${JSON.stringify({
              type: 'text',
              content: event.delta.text,
              blockIndex: event.index,
              done: false
            })}\n\n`);

            // Force flush immediately
            if (res.flush) res.flush();
          }
        } else if (event.type === 'content_block_stop') {
          console.log('[CHAT] Content block stop');
          res.write(`data: ${JSON.stringify({
            type: 'text_block_end',
            blockIndex: event.index,
            done: false
          })}\n\n`);
          currentTextBlock = '';
          if (res.flush) res.flush();
        }
      }
      // Handle result message
      else if (sdkMsg.type === 'result') {
        console.log('[CHAT] Result message');
        const resultInfo = {
          type: 'result',
          done: true,
          isError: sdkMsg.is_error,
          numTurns: sdkMsg.num_turns,
          totalCostUsd: sdkMsg.total_cost_usd,
          durationMs: sdkMsg.duration_ms
        };

        if (sdkMsg.subtype === 'success') {
          resultInfo.result = sdkMsg.result;
        } else {
          resultInfo.errors = sdkMsg.errors;
          resultInfo.subtype = sdkMsg.subtype;
        }

        res.write(`data: ${JSON.stringify(resultInfo)}\n\n`);
        break;
      }
    }

    res.end();
  } catch (error) {
    console.error('Error in chat:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message,
      done: true
    })}\n\n`);
    res.end();
  }
});

// Clear conversation history endpoint
app.delete('/api/conversations/:sessionId', authenticateToken, (req, res) => {
  const username = req.user.username;
  const sessionId = req.params.sessionId;

  // Delete the session directory
  const sessionDir = path.join(CLAUDE_SESSIONS_DIR, username, 'claude', sessionId);
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  res.json({ success: true });
});

// Admin middleware - only mike can access
const adminOnly = (req, res, next) => {
  if (req.user.username !== 'mike@shaffercon.com') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Get list of all users
app.get('/api/admin/users', authenticateToken, adminOnly, (req, res) => {
  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  res.json({ users: Object.keys(users) });
});

// Get permissions for a specific user
app.get('/api/admin/permissions/:username', authenticateToken, adminOnly, (req, res) => {
  const { username } = req.params;
  const permissions = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf8'));

  const userPermissions = permissions[username] || {
    allowedTools: [],
    deniedTools: [],
    allowedDirectories: [],
    allowedSkills: [],
    deniedSkills: [],
    permissionMode: 'default'
  };

  res.json(userPermissions);
});

// Update permissions for a specific user
app.put('/api/admin/permissions/:username', authenticateToken, adminOnly, (req, res) => {
  const { username } = req.params;
  const newPermissions = req.body;

  const permissions = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf8'));
  permissions[username] = newPermissions;
  fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(permissions, null, 2));

  res.json({ success: true });
});

// Get user config
app.get('/api/user/config/:username', authenticateToken, (req, res) => {
  const { username } = req.params;
  const configFile = path.join(USER_CONFIGS_DIR, `${username.toLowerCase()}.json`);

  if (!fs.existsSync(configFile)) {
    // Ensure user-configs directory exists
    if (!fs.existsSync(USER_CONFIGS_DIR)) {
      fs.mkdirSync(USER_CONFIGS_DIR, { recursive: true });
    }

    // Create default config for new user
    const defaultConfig = {
      firstName: username.split('@')[0].charAt(0).toUpperCase() + username.split('@')[0].slice(1),
      lastName: '',
      email: username,
      title: ''
    };

    // Save the default config
    fs.writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2));

    return res.json(defaultConfig);
  }

  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  res.json(config);
});

// Update user config
app.put('/api/user/config/:username', authenticateToken, (req, res) => {
  const { username } = req.params;
  const configFile = path.join(USER_CONFIGS_DIR, `${username.toLowerCase()}.json`);

  // Ensure user-configs directory exists
  if (!fs.existsSync(USER_CONFIGS_DIR)) {
    fs.mkdirSync(USER_CONFIGS_DIR, { recursive: true });
  }

  // Save the updated config
  const updatedConfig = {
    firstName: req.body.firstName || '',
    lastName: req.body.lastName || '',
    email: req.body.email || username,
    title: req.body.title || ''
  };

  fs.writeFileSync(configFile, JSON.stringify(updatedConfig, null, 2));

  res.json(updatedConfig);
});

// Get file tree from user's claude folder
app.get('/api/files/tree', authenticateToken, (req, res) => {
  const username = req.user.username;
  const claudeDir = path.join(CLAUDE_SESSIONS_DIR, username, 'claude');

  const buildTree = (dirPath, relativePath = '') => {
    if (!fs.existsSync(dirPath)) {
      return null;
    }

    const stats = fs.statSync(dirPath);
    const name = path.basename(dirPath);

    if (stats.isFile()) {
      return {
        name,
        path: relativePath,
        type: 'file'
      };
    }

    if (stats.isDirectory()) {
      const children = fs.readdirSync(dirPath)
        .filter(item => !item.startsWith('.'))
        .map(item => buildTree(
          path.join(dirPath, item),
          path.join(relativePath, item)
        ))
        .filter(item => item !== null)
        .sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === 'directory' ? -1 : 1;
        });

      return {
        name: name || 'claude',
        path: relativePath,
        type: 'directory',
        children
      };
    }

    return null;
  };

  const tree = buildTree(claudeDir, '');
  res.json(tree);
});

// Get users from Google Workspace
app.get('/api/workspace/users', authenticateToken, adminOnly, async (req, res) => {
  try {
    // Use the existing Google OAuth credentials to access Directory API
    const host = req.get('host') || 'localhost:3001';
    const auth = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      `http://${host}/api/auth/google/callback`
    );

    // For domain-wide delegation, we need a service account
    // Check if service account credentials are provided
    const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;

    if (!serviceAccountPath || !fs.existsSync(serviceAccountPath)) {
      return res.status(400).json({
        error: 'Google Workspace service account not configured',
        message: 'Set GOOGLE_SERVICE_ACCOUNT_PATH env variable'
      });
    }

    const configFile = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

    // Extract the service account key from the config file
    let serviceAccount = configFile.service_account_key || configFile;

    if (!serviceAccount || !serviceAccount.client_email) {
      return res.status(400).json({
        error: 'Invalid service account configuration',
        message: 'Service account JSON does not contain client_email field'
      });
    }

    console.log(`[WORKSPACE] Loaded service account: ${serviceAccount.client_email}`);

    // Get the workspace domain from the default_account in config, or use shaffercon.com as fallback
    let domain = 'shaffercon.com';
    let adminEmail = 'mike@shaffercon.com';
    if (configFile.default_account && configFile.default_account.includes('@')) {
      domain = configFile.default_account.split('@')[1];
      adminEmail = configFile.default_account;
    }
    console.log(`[WORKSPACE] Using domain: ${domain}, impersonating: ${adminEmail}`);

    // Create GoogleAuth client with domain-wide delegation by setting the subject
    const authClient = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
      projectId: serviceAccount.project_id
    });
    console.log('[WORKSPACE] Created GoogleAuth client with admin.directory.user.readonly scope');

    // Get an authenticated client that will impersonate the admin user
    const adminAuthClient = await authClient.getClient();
    // Set the subject for domain-wide delegation
    adminAuthClient.subject = adminEmail;

    const directory = google.admin({
      version: 'directory_v1',
      auth: adminAuthClient
    });

    // List all users in the domain
    console.log('[WORKSPACE] Calling directory.users.list()...');
    const result = await directory.users.list({
      domain: domain,
      maxResults: 500,
      orderBy: 'email',
      showDeleted: false
    });

    const users = result.data.users || [];
    console.log(`[WORKSPACE] Google Workspace API returned ${users.length} total users`);

    // Filter for @shaffercon.com domain and return formatted user list
    const workspaceUsers = users
      .filter(user => user.primaryEmail.endsWith('@shaffercon.com'))
      .map(user => ({
        email: user.primaryEmail,
        primaryEmail: user.primaryEmail,
        fullName: user.name?.fullName || '',
        firstName: user.name?.givenName || '',
        lastName: user.name?.familyName || '',
        suspended: user.suspended || false
      }));

    console.log(`[WORKSPACE] Filtered to ${workspaceUsers.length} @shaffercon.com users`);
    res.json({ users: workspaceUsers });
  } catch (error) {
    console.error('[WORKSPACE] Error fetching users:', error);
    console.error('[WORKSPACE] Error stack:', error.stack);
    res.status(500).json({
      error: 'Failed to fetch users from Google Workspace',
      message: error.message,
      code: error.code,
      details: error.errors ? error.errors[0] : null
    });
  }
});

// Get available skills by reading Skill.md files
app.get('/api/skills', authenticateToken, adminOnly, (req, res) => {
  try {
    if (!fs.existsSync(SKILLS_DIR)) {
      return res.json({ skills: [] });
    }

    const skills = [];
    const items = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });

    for (const item of items) {
      if (item.isDirectory() && !item.name.startsWith('.')) {
        const skillMdPath = path.join(SKILLS_DIR, item.name, 'Skill.md');

        if (fs.existsSync(skillMdPath)) {
          try {
            const content = fs.readFileSync(skillMdPath, 'utf-8');

            // Extract name from YAML frontmatter
            const nameMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (nameMatch) {
              const frontmatter = nameMatch[1];
              const skillNameMatch = frontmatter.match(/name:\s*(.+?)(?:\n|$)/);

              if (skillNameMatch) {
                const skillName = skillNameMatch[1].trim();
                skills.push(skillName);
              }
            }
          } catch (error) {
            console.warn(`[SKILLS] Error reading ${skillMdPath}:`, error.message);
          }
        }
      }
    }

    skills.sort();
    res.json({ skills });
  } catch (error) {
    console.error('[SKILLS] Error listing skills:', error);
    res.status(500).json({
      error: 'Failed to list skills',
      message: error.message
    });
  }
});

// File upload endpoint
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const username = req.user.username;
      const userDir = path.join(CLAUDE_SESSIONS_DIR, username);
      const attachmentsDir = path.join(userDir, 'attachments');

      // Ensure attachments directory exists
      if (!fs.existsSync(attachmentsDir)) {
        fs.mkdirSync(attachmentsDir, { recursive: true });
      }

      cb(null, attachmentsDir);
    },
    filename: (req, file, cb) => {
      // Keep original filename
      cb(null, file.originalname);
    }
  })
});

app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Return relative path from user directory (includes attachments/ prefix)
  const relativePath = `attachments/${req.file.filename}`;
  res.json({
    success: true,
    filename: req.file.filename,
    relativePath: relativePath,
    size: req.file.size
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT} and accessible from network`);
});
