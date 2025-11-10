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
    callbackURL: 'http://localhost:3001/api/auth/google/callback'
  },
  (accessToken, refreshToken, profile, done) => {
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
        return res.redirect('http://localhost:3000?error=unauthorized');
      }
      if (!user) {
        return res.redirect('http://localhost:3000?error=unauthorized');
      }

      // Generate JWT token for authenticated user
      const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      const redirectUrl = `http://localhost:3000?token=${token}&username=${user.username}`;
      res.redirect(redirectUrl);
    })(req, res, next);
  }
);

// Get conversations for user
app.get('/api/conversations', authenticateToken, (req, res) => {
  const userConvFile = path.join(CONVERSATIONS_DIR, `${req.user.username}.json`);

  if (!fs.existsSync(userConvFile)) {
    return res.json([]);
  }

  const conversations = JSON.parse(fs.readFileSync(userConvFile, 'utf8'));
  res.json(conversations);
});

// Save conversations for user
app.post('/api/conversations', authenticateToken, (req, res) => {
  const userConvFile = path.join(CONVERSATIONS_DIR, `${req.user.username}.json`);
  fs.writeFileSync(userConvFile, JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

// Chat endpoint
app.post('/api/chat', authenticateToken, async (req, res) => {
  const { message, sessionId } = req.body;
  const username = req.user.username;

  console.log(`[CHAT] User: ${username}, Message: ${message.substring(0, 50)}..., SessionId: ${sessionId || 'new'}`);

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

  // Create user's directory
  const userDir = path.join(CLAUDE_SESSIONS_DIR, username);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Enable TCP_NODELAY to disable Nagle's algorithm and send packets immediately
  if (res.socket) {
    res.socket.setNoDelay(true);
  }

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
      console.log(`[CHAT] SDK Message #${messageCount} type:`, sdkMsg.type);
      // Capture the Claude session_id from the first message
      if (sdkMsg.session_id && !currentSessionId) {
        currentSessionId = sdkMsg.session_id;

        // Send session_id to frontend so it can track it
        res.write(`data: ${JSON.stringify({
          type: 'session_id',
          sessionId: currentSessionId,
          done: false
        })}\n\n`);
        if (res.flush) res.flush();
      }

      // Handle stream events for real-time streaming (when using includePartialMessages)
      if (sdkMsg.type === 'stream_event') {
        const event = sdkMsg.event;

        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            // Starting a new text block, flush previous if any
            if (currentTextBlock) {
              res.write(`data: ${JSON.stringify({
                type: 'text_block_end',
                blockIndex: textBlockIndex,
                done: false
              })}\n\n`);
              currentTextBlock = '';
            }
            textBlockIndex = event.index;
            res.write(`data: ${JSON.stringify({
              type: 'text_block_start',
              blockIndex: textBlockIndex,
              done: false
            })}\n\n`);
            if (res.flush) res.flush();
          } else if (event.content_block.type === 'tool_use') {
            // Flush any current text block before tool use
            if (currentTextBlock) {
              res.write(`data: ${JSON.stringify({
                type: 'text_block_end',
                blockIndex: textBlockIndex,
                done: false
              })}\n\n`);
              currentTextBlock = '';
            }
            console.log('[CHAT] Sending tool_use event:', event.content_block.name, 'at index', event.index);
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
            currentTextBlock += event.delta.text;
            fullResponse += event.delta.text;
            res.write(`data: ${JSON.stringify({
              type: 'text',
              content: event.delta.text,
              blockIndex: event.index,
              done: false
            })}\n\n`);
            if (res.flush) res.flush();
          }
        } else if (event.type === 'content_block_stop') {
          // Block finished
          if (currentTextBlock) {
            res.write(`data: ${JSON.stringify({
              type: 'text_block_end',
              blockIndex: event.index,
              done: false
            })}\n\n`);
            currentTextBlock = '';
            if (res.flush) res.flush();
          }
        }
      }

      // Handle result message
      else if (sdkMsg.type === 'result') {
        console.log('[CHAT] Result message:', JSON.stringify(sdkMsg, null, 2));
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
    const auth = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      'http://localhost:3001/api/auth/google/callback'
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
