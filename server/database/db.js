import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

// Use DATABASE_PATH environment variable if set, otherwise use default location
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'auth.db');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');

// Ensure database directory exists if custom path is provided
if (process.env.DATABASE_PATH) {
  const dbDir = path.dirname(DB_PATH);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`Created database directory: ${dbDir}`);
    }
  } catch (error) {
    console.error(`Failed to create database directory ${dbDir}:`, error.message);
    throw error;
  }
}

// As part of 1.19.2 we are introducing a new location for auth.db. The below handles exisitng moving legacy database from install directory to new location
const LEGACY_DB_PATH = path.join(__dirname, 'auth.db');
if (DB_PATH !== LEGACY_DB_PATH && !fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
  try {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    console.log(`[MIGRATION] Copied database from ${LEGACY_DB_PATH} to ${DB_PATH}`);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(LEGACY_DB_PATH + suffix)) {
        fs.copyFileSync(LEGACY_DB_PATH + suffix, DB_PATH + suffix);
      }
    }
  } catch (err) {
    console.warn(`[MIGRATION] Could not copy legacy database: ${err.message}`);
  }
}

// Create database connection
const db = new Database(DB_PATH);

// Show app installation path prominently
const appInstallPath = path.join(__dirname, '../..');
console.log('');
console.log(c.dim('═'.repeat(60)));
console.log(`${c.info('[INFO]')} App Installation: ${c.bright(appInstallPath)}`);
console.log(`${c.info('[INFO]')} Database: ${c.dim(path.relative(appInstallPath, DB_PATH))}`);
if (process.env.DATABASE_PATH) {
  console.log(`       ${c.dim('(Using custom DATABASE_PATH from environment)')}`);
}
console.log(c.dim('═'.repeat(60)));
console.log('');

const runMigrations = () => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(users)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('git_name')) {
      console.log('Running migration: Adding git_name column');
      db.exec('ALTER TABLE users ADD COLUMN git_name TEXT');
    }

    if (!columnNames.includes('git_email')) {
      console.log('Running migration: Adding git_email column');
      db.exec('ALTER TABLE users ADD COLUMN git_email TEXT');
    }

    if (!columnNames.includes('has_completed_onboarding')) {
      console.log('Running migration: Adding has_completed_onboarding column');
      db.exec('ALTER TABLE users ADD COLUMN has_completed_onboarding BOOLEAN DEFAULT 0');
    }

    if (!columnNames.includes('email')) {
      console.log('Running migration: Adding email column');
      db.exec('ALTER TABLE users ADD COLUMN email TEXT UNIQUE');
      db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    }

    if (!columnNames.includes('nickname')) {
      console.log('Running migration: Adding nickname column');
      db.exec('ALTER TABLE users ADD COLUMN nickname TEXT');
    }

    if (!columnNames.includes('avatar_url')) {
      console.log('Running migration: Adding avatar_url column');
      db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
    }

    if (!columnNames.includes('roles')) {
      console.log('Running migration: Adding roles column');
      db.exec("ALTER TABLE users ADD COLUMN roles TEXT DEFAULT '[]'");
    }

    if (!columnNames.includes('active_role')) {
      console.log('Running migration: Adding active_role column');
      db.exec("ALTER TABLE users ADD COLUMN active_role TEXT DEFAULT ''");
    }

    // Create session_names table if it doesn't exist (for existing installations)
    db.exec(`CREATE TABLE IF NOT EXISTS session_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'claude',
      custom_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, provider)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_session_names_lookup ON session_names(session_id, provider)');

    // Create user_projects table if it doesn't exist (multi-user project isolation)
    db.exec(`CREATE TABLE IF NOT EXISTS user_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, project_name)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_user_projects_user_id ON user_projects(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_user_projects_project_name ON user_projects(project_name)');

    // Team collaboration tables migration
    db.exec(`CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      settings TEXT DEFAULT '{}'
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_teams_created_by ON teams(created_by)');

    db.exec(`CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      role TEXT NOT NULL DEFAULT 'developer',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1,
      UNIQUE(team_id, user_id)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_members_active ON team_members(is_active)');

    db.exec(`CREATE TABLE IF NOT EXISTS team_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      invite_code TEXT UNIQUE NOT NULL,
      created_by INTEGER REFERENCES users(id),
      expires_at DATETIME,
      max_uses INTEGER DEFAULT 1,
      use_count INTEGER DEFAULT 0
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_invites_code ON team_invites(invite_code)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(team_id)');

    db.exec(`CREATE TABLE IF NOT EXISTS team_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      project_path TEXT NOT NULL,
      added_by INTEGER REFERENCES users(id),
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, project_path)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_projects_team ON team_projects(team_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_team_projects_path ON team_projects(project_path)');

    db.exec(`CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER REFERENCES teams(id),
      user_id INTEGER REFERENCES users(id),
      action_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_activity_log_team ON activity_log(team_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at)');

    db.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      team_id INTEGER REFERENCES teams(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_team ON notifications(team_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read)');

    // team_projects table expansion: name, description, default_branch, remote_url
    const tpInfo = db.prepare("PRAGMA table_info(team_projects)").all();
    const tpCols = tpInfo.map(c => c.name);
    if (!tpCols.includes('name')) {
      console.log('Running migration: Adding name column to team_projects');
      db.exec("ALTER TABLE team_projects ADD COLUMN name TEXT DEFAULT ''");
    }
    if (!tpCols.includes('description')) {
      console.log('Running migration: Adding description column to team_projects');
      db.exec("ALTER TABLE team_projects ADD COLUMN description TEXT DEFAULT ''");
    }
    if (!tpCols.includes('default_branch')) {
      console.log('Running migration: Adding default_branch column to team_projects');
      db.exec("ALTER TABLE team_projects ADD COLUMN default_branch TEXT DEFAULT 'main'");
    }
    if (!tpCols.includes('remote_url')) {
      console.log('Running migration: Adding remote_url column to team_projects');
      db.exec("ALTER TABLE team_projects ADD COLUMN remote_url TEXT DEFAULT ''");
    }

    // file_activities table for file change tracking (Story 4.3)
    db.exec(`CREATE TABLE IF NOT EXISTS file_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      session_id TEXT,
      file_path TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'modified',
      project_path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_file_activities_team ON file_activities(team_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_file_activities_user ON file_activities(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_file_activities_created ON file_activities(created_at)');

    // Sprints table (Kanban)
    db.exec(`CREATE TABLE IF NOT EXISTS sprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT 'planning' CHECK(status IN ('planning','active','completed')),
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_sprints_team_id ON sprints(team_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sprints_status ON sprints(status)');

    // Stories table (Kanban)
    db.exec(`CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      sprint_id INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done')),
      assigned_to INTEGER REFERENCES users(id),
      file_scope TEXT DEFAULT '[]',
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      position INTEGER DEFAULT 0
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_stories_team_sprint ON stories(team_id, sprint_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_stories_assigned_to ON stories(assigned_to)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status)');

    // Conflicts table (Epic 6)
    db.exec(`CREATE TABLE IF NOT EXISTS conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      sprint_id INTEGER REFERENCES sprints(id),
      level TEXT DEFAULT 'yellow' CHECK(level IN ('yellow','orange','red')),
      status TEXT DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','confirmed')),
      type TEXT DEFAULT 'file_overlap' CHECK(type IN ('file_overlap','same_file','same_region')),
      story_ids TEXT DEFAULT '[]',
      member_ids TEXT DEFAULT '[]',
      files TEXT DEFAULT '[]',
      description TEXT,
      resolution_note TEXT,
      assigned_to INTEGER REFERENCES users(id),
      resolved_by INTEGER REFERENCES users(id),
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_conflicts_team ON conflicts(team_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_conflicts_status ON conflicts(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_conflicts_sprint ON conflicts(sprint_id)');

    // Workflow instances table (Epic 7)
    db.exec(`CREATE TABLE IF NOT EXISTS workflow_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      workflow_type TEXT NOT NULL CHECK(workflow_type IN ('product_brief','prd','architecture','epic_breakdown')),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','active','waiting_input','completed','cancelled')),
      context_json TEXT DEFAULT '{}',
      current_step TEXT,
      total_steps INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_workflow_instances_team ON workflow_instances(team_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_workflow_instances_user ON workflow_instances(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_workflow_instances_status ON workflow_instances(status)');

    // Workflow messages table (Epic 7)
    db.exec(`CREATE TABLE IF NOT EXISTS workflow_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      role TEXT CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      step_name TEXT,
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_workflow_messages_workflow ON workflow_messages(workflow_id)');

    console.log('Database migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error.message);
    throw error;
  }
};

// Initialize database with schema
const initializeDatabase = async () => {
  try {
    const initSQL = fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(initSQL);
    console.log('Database initialized successfully');
    runMigrations();
  } catch (error) {
    console.error('Error initializing database:', error.message);
    throw error;
  }
};

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: () => {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
      return row.count > 0;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user
  createUser: (username, passwordHash, email = null) => {
    try {
      const stmt = db.prepare('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)');
      const result = stmt.run(username, passwordHash, email);
      return { id: result.lastInsertRowid, username, email };
    } catch (err) {
      throw err;
    }
  },

  // Get user by username
  getUserByUsername: (username) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Get user by email
  getUserByEmail: (email) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Update last login time (non-fatal — logged but not thrown)
  updateLastLogin: (userId) => {
    try {
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    } catch (err) {
      console.warn('Failed to update last login:', err.message);
    }
  },

  // Get user by ID (includes nickname and avatar_url)
  getUserById: (userId) => {
    try {
      const row = db.prepare('SELECT id, username, email, nickname, avatar_url, roles, active_role, created_at, last_login FROM users WHERE id = ? AND is_active = 1').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  getFirstUser: () => {
    try {
      const row = db.prepare('SELECT id, username, email, nickname, avatar_url, roles, active_role, created_at, last_login FROM users WHERE is_active = 1 LIMIT 1').get();
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Update user profile (nickname, avatar_url)
  updateProfile: (userId, { nickname, avatarUrl }) => {
    try {
      if (nickname !== undefined && avatarUrl !== undefined) {
        db.prepare('UPDATE users SET nickname = ?, avatar_url = ? WHERE id = ?').run(nickname, avatarUrl, userId);
      } else if (nickname !== undefined) {
        db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, userId);
      } else if (avatarUrl !== undefined) {
        db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, userId);
      }
      return userDb.getUserById(userId);
    } catch (err) {
      throw err;
    }
  },

  // Update user roles (JSON array)
  updateRoles: (userId, roles) => {
    try {
      const rolesJson = JSON.stringify(roles);
      // Check current active_role to decide if it needs updating
      const currentActive = db.prepare('SELECT active_role FROM users WHERE id = ?').get(userId)?.active_role || '';
      let newActive = currentActive;
      if (currentActive && !roles.includes(currentActive)) {
        newActive = roles.length > 0 ? roles[0] : '';
      } else if (!currentActive && roles.length > 0) {
        newActive = roles[0];
      }
      // Single UPDATE for both fields
      db.prepare('UPDATE users SET roles = ?, active_role = ? WHERE id = ?').run(rolesJson, newActive, userId);
      return userDb.getUserById(userId);
    } catch (err) {
      throw err;
    }
  },

  // Set active role
  setActiveRole: (userId, role) => {
    try {
      db.prepare('UPDATE users SET active_role = ? WHERE id = ?').run(role, userId);
      return userDb.getUserById(userId);
    } catch (err) {
      throw err;
    }
  },

  updateGitConfig: (userId, gitName, gitEmail) => {
    try {
      const stmt = db.prepare('UPDATE users SET git_name = ?, git_email = ? WHERE id = ?');
      stmt.run(gitName, gitEmail, userId);
    } catch (err) {
      throw err;
    }
  },

  getGitConfig: (userId) => {
    try {
      const row = db.prepare('SELECT git_name, git_email FROM users WHERE id = ?').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  completeOnboarding: (userId) => {
    try {
      const stmt = db.prepare('UPDATE users SET has_completed_onboarding = 1 WHERE id = ?');
      stmt.run(userId);
    } catch (err) {
      throw err;
    }
  },

  hasCompletedOnboarding: (userId) => {
    try {
      const row = db.prepare('SELECT has_completed_onboarding FROM users WHERE id = ?').get(userId);
      return row?.has_completed_onboarding === 1;
    } catch (err) {
      throw err;
    }
  }
};

// API Keys database operations
const apiKeysDb = {
  // Generate a new API key
  generateApiKey: () => {
    return 'ck_' + crypto.randomBytes(32).toString('hex');
  },

  // Create a new API key
  createApiKey: (userId, keyName) => {
    try {
      const apiKey = apiKeysDb.generateApiKey();
      const stmt = db.prepare('INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)');
      const result = stmt.run(userId, keyName, apiKey);
      return { id: result.lastInsertRowid, keyName, apiKey };
    } catch (err) {
      throw err;
    }
  },

  // Get all API keys for a user
  getApiKeys: (userId) => {
    try {
      const rows = db.prepare('SELECT id, key_name, api_key, created_at, last_used, is_active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Validate API key and get user
  validateApiKey: (apiKey) => {
    try {
      const row = db.prepare(`
        SELECT u.id, u.username, ak.id as api_key_id
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.api_key = ? AND ak.is_active = 1 AND u.is_active = 1
      `).get(apiKey);

      if (row) {
        // Update last_used timestamp
        db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(row.api_key_id);
      }

      return row;
    } catch (err) {
      throw err;
    }
  },

  // Delete an API key
  deleteApiKey: (userId, apiKeyId) => {
    try {
      const stmt = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?');
      const result = stmt.run(apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle API key active status
  toggleApiKey: (userId, apiKeyId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE api_keys SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// User credentials database operations (for GitHub tokens, GitLab tokens, etc.)
const credentialsDb = {
  // Create a new credential
  createCredential: (userId, credentialName, credentialType, credentialValue, description = null) => {
    try {
      const stmt = db.prepare('INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description) VALUES (?, ?, ?, ?, ?)');
      const result = stmt.run(userId, credentialName, credentialType, credentialValue, description);
      return { id: result.lastInsertRowid, credentialName, credentialType };
    } catch (err) {
      throw err;
    }
  },

  // Get all credentials for a user, optionally filtered by type
  getCredentials: (userId, credentialType = null) => {
    try {
      let query = 'SELECT id, credential_name, credential_type, description, created_at, is_active FROM user_credentials WHERE user_id = ?';
      const params = [userId];

      if (credentialType) {
        query += ' AND credential_type = ?';
        params.push(credentialType);
      }

      query += ' ORDER BY created_at DESC';

      const rows = db.prepare(query).all(...params);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Get active credential value for a user by type (returns most recent active)
  getActiveCredential: (userId, credentialType) => {
    try {
      const row = db.prepare('SELECT credential_value FROM user_credentials WHERE user_id = ? AND credential_type = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1').get(userId, credentialType);
      return row?.credential_value || null;
    } catch (err) {
      throw err;
    }
  },

  // Delete a credential
  deleteCredential: (userId, credentialId) => {
    try {
      const stmt = db.prepare('DELETE FROM user_credentials WHERE id = ? AND user_id = ?');
      const result = stmt.run(credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle credential active status
  toggleCredential: (userId, credentialId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE user_credentials SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// Session custom names database operations
const sessionNamesDb = {
  // Set (insert or update) a custom session name
  setName: (sessionId, provider, customName) => {
    db.prepare(`
      INSERT INTO session_names (session_id, provider, custom_name)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id, provider)
      DO UPDATE SET custom_name = excluded.custom_name, updated_at = CURRENT_TIMESTAMP
    `).run(sessionId, provider, customName);
  },

  // Get a single custom session name
  getName: (sessionId, provider) => {
    const row = db.prepare(
      'SELECT custom_name FROM session_names WHERE session_id = ? AND provider = ?'
    ).get(sessionId, provider);
    return row?.custom_name || null;
  },

  // Batch lookup — returns Map<sessionId, customName>
  getNames: (sessionIds, provider) => {
    if (!sessionIds.length) return new Map();
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT session_id, custom_name FROM session_names
       WHERE session_id IN (${placeholders}) AND provider = ?`
    ).all(...sessionIds, provider);
    return new Map(rows.map(r => [r.session_id, r.custom_name]));
  },

  // Delete a custom session name
  deleteName: (sessionId, provider) => {
    return db.prepare(
      'DELETE FROM session_names WHERE session_id = ? AND provider = ?'
    ).run(sessionId, provider).changes > 0;
  },
};

// Apply custom session names from the database (overrides CLI-generated summaries)
function applyCustomSessionNames(sessions, provider) {
  if (!sessions?.length) return;
  try {
    const ids = sessions.map(s => s.id);
    const customNames = sessionNamesDb.getNames(ids, provider);
    for (const session of sessions) {
      const custom = customNames.get(session.id);
      if (custom) session.summary = custom;
    }
  } catch (error) {
    console.warn(`[DB] Failed to apply custom session names for ${provider}:`, error.message);
  }
}

// User-project ownership mapping (multi-user isolation)
const userProjectsDb = {
  // Associate a project with a user
  addProject: (userId, projectName) => {
    try {
      db.prepare(
        'INSERT OR IGNORE INTO user_projects (user_id, project_name) VALUES (?, ?)'
      ).run(userId, projectName);
    } catch (err) {
      throw err;
    }
  },

  // Get all project names owned by a user
  getProjectNames: (userId) => {
    try {
      const rows = db.prepare(
        'SELECT project_name FROM user_projects WHERE user_id = ?'
      ).all(userId);
      return new Set(rows.map(r => r.project_name));
    } catch (err) {
      throw err;
    }
  },

  // Check if a user owns a specific project
  hasProject: (userId, projectName) => {
    try {
      const row = db.prepare(
        'SELECT 1 FROM user_projects WHERE user_id = ? AND project_name = ?'
      ).get(userId, projectName);
      return !!row;
    } catch (err) {
      throw err;
    }
  },

  // Remove a project association for a user
  removeProject: (userId, projectName) => {
    try {
      db.prepare(
        'DELETE FROM user_projects WHERE user_id = ? AND project_name = ?'
      ).run(userId, projectName);
    } catch (err) {
      throw err;
    }
  },

  // Assign all given project names to a user (for first-user migration)
  assignAllToUser: (userId, projectNames) => {
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO user_projects (user_id, project_name) VALUES (?, ?)'
    );
    const transaction = db.transaction((names) => {
      for (const name of names) {
        stmt.run(userId, name);
      }
    });
    transaction(projectNames);
  },

  // One-time fix: reassign all projects from a wrong user to the correct first user
  reassignAllToFirstUser: (firstUserId) => {
    try {
      const rows = db.prepare('SELECT DISTINCT user_id FROM user_projects WHERE user_id != ?').all(firstUserId);
      if (rows.length > 0) {
        const firstUserProjects = db.prepare('SELECT project_name FROM user_projects WHERE user_id = ?').all(firstUserId);
        if (firstUserProjects.length === 0) {
          // First user has no projects but other users do — likely a mis-migration
          const transaction = db.transaction(() => {
            // Move all orphan records to the first user
            db.prepare('UPDATE user_projects SET user_id = ? WHERE user_id != ?').run(firstUserId, firstUserId);
            // Remove duplicates that might result
            db.prepare(`DELETE FROM user_projects WHERE rowid NOT IN (
              SELECT MIN(rowid) FROM user_projects GROUP BY user_id, project_name
            )`).run();
          });
          transaction();
          console.log(`[Migration] Reassigned orphan project records to first user (id=${firstUserId})`);
        }
      }
    } catch (err) {
      console.warn('Failed to reassign orphan projects:', err.message);
    }
  },

  // Get all project names that are assigned to any user
  getAllAssignedProjectNames: () => {
    try {
      const rows = db.prepare('SELECT DISTINCT project_name FROM user_projects').all();
      return new Set(rows.map(r => r.project_name));
    } catch (err) {
      return new Set();
    }
  },

  // Check if any records exist (for first-run migration)
  hasAnyRecords: () => {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM user_projects').get();
      return row.count > 0;
    } catch (err) {
      return false;
    }
  },
};

// Team database operations
const teamDb = {
  // Create a new team
  createTeam: (name, description, createdBy, settings = '{}') => {
    const transaction = db.transaction(() => {
      const stmt = db.prepare('INSERT INTO teams (name, description, created_by, settings) VALUES (?, ?, ?, ?)');
      const result = stmt.run(name, description, createdBy, settings);
      // Auto-add creator as team owner (pm role)
      db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(result.lastInsertRowid, createdBy, 'pm');
      return { id: result.lastInsertRowid, name, description };
    });
    return transaction();
  },

  // Get team by ID
  getTeamById: (teamId) => {
    return db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  },

  // Get all teams for a user
  getTeamsForUser: (userId) => {
    return db.prepare(`
      SELECT t.*, tm.role as user_role
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      WHERE tm.user_id = ? AND tm.is_active = 1
      ORDER BY t.updated_at DESC
    `).all(userId);
  },

  // Update team
  updateTeam: (teamId, name, description, settings) => {
    const stmt = db.prepare('UPDATE teams SET name = ?, description = ?, settings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    return stmt.run(name, description, settings || '{}', teamId).changes > 0;
  },

  // Delete team
  deleteTeam: (teamId) => {
    return db.prepare('DELETE FROM teams WHERE id = ?').run(teamId).changes > 0;
  },

  // Get team members
  getTeamMembers: (teamId) => {
    return db.prepare(`
      SELECT tm.*, u.username, u.git_name, u.git_email, u.nickname, u.avatar_url
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = ? AND tm.is_active = 1
      ORDER BY tm.joined_at ASC
    `).all(teamId);
  },

  // Add member to team
  addMember: (teamId, userId, role = 'developer') => {
    const stmt = db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)');
    return stmt.run(teamId, userId, role).changes > 0;
  },

  // Update member role
  updateMemberRole: (teamId, userId, role) => {
    return db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run(role, teamId, userId).changes > 0;
  },

  // Remove member from team (soft delete)
  removeMember: (teamId, userId) => {
    return db.prepare('UPDATE team_members SET is_active = 0 WHERE team_id = ? AND user_id = ?').run(teamId, userId).changes > 0;
  },

  // Check if user is member of team
  isMember: (teamId, userId) => {
    const row = db.prepare('SELECT id FROM team_members WHERE team_id = ? AND user_id = ? AND is_active = 1').get(teamId, userId);
    return !!row;
  },

  // Count active members with a specific role in team
  countMembersByRole: (teamId, role) => {
    const row = db.prepare('SELECT COUNT(*) as count FROM team_members WHERE team_id = ? AND role = ? AND is_active = 1').get(teamId, role);
    return row.count;
  },

  // Get member role in team
  getMemberRole: (teamId, userId) => {
    const row = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ? AND is_active = 1').get(teamId, userId);
    return row?.role || null;
  },

  // Get all team roles for a user (returns Map<teamId, role>)
  getUserTeamRoles: (userId) => {
    const rows = db.prepare('SELECT team_id, role FROM team_members WHERE user_id = ? AND is_active = 1').all(userId);
    const map = {};
    for (const row of rows) {
      map[row.team_id] = row.role;
    }
    return map;
  },

  // Create invite
  createInvite: (teamId, createdBy, expiresAt = null, maxUses = 1) => {
    const inviteCode = crypto.randomBytes(16).toString('hex');
    const stmt = db.prepare('INSERT INTO team_invites (team_id, invite_code, created_by, expires_at, max_uses) VALUES (?, ?, ?, ?, ?)');
    stmt.run(teamId, inviteCode, createdBy, expiresAt, maxUses);
    return inviteCode;
  },

  // Use invite code to join team
  useInvite: (inviteCode, userId) => {
    const invite = db.prepare('SELECT * FROM team_invites WHERE invite_code = ?').get(inviteCode);
    if (!invite) return { success: false, error: 'Invalid invite code' };
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) return { success: false, error: 'Invite expired' };
    if (invite.max_uses > 0 && invite.use_count >= invite.max_uses) return { success: false, error: 'Invite has been used up' };

    // Check if already a member
    if (teamDb.isMember(invite.team_id, userId)) {
      return { success: false, error: 'Already a team member', teamId: invite.team_id };
    }

    // Add member and increment use count atomically
    const transaction = db.transaction(() => {
      const addResult = teamDb.addMember(invite.team_id, userId, 'developer');
      if (addResult) {
        db.prepare('UPDATE team_invites SET use_count = use_count + 1 WHERE id = ?').run(invite.id);
      }
      return addResult;
    });
    transaction();
    return { success: true, teamId: invite.team_id };
  },

  // Get invites for a team
  getInvites: (teamId) => {
    return db.prepare('SELECT id, invite_code, created_by, expires_at, max_uses, use_count FROM team_invites WHERE team_id = ?').all(teamId);
  },

  // Delete invite
  deleteInvite: (inviteId, teamId) => {
    return db.prepare('DELETE FROM team_invites WHERE id = ? AND team_id = ?').run(inviteId, teamId).changes > 0;
  },

  // Add project to team (with name, description, git info)
  addProject: (teamId, projectPath, addedBy, { name, description, defaultBranch, remoteUrl } = {}) => {
    const stmt = db.prepare('INSERT OR IGNORE INTO team_projects (team_id, project_path, added_by, name, description, default_branch, remote_url) VALUES (?, ?, ?, ?, ?, ?, ?)');
    return stmt.run(teamId, projectPath, addedBy, name || '', description || '', defaultBranch || 'main', remoteUrl || '').changes > 0;
  },

  // Get team projects
  getProjects: (teamId) => {
    return db.prepare('SELECT * FROM team_projects WHERE team_id = ? ORDER BY added_at DESC').all(teamId);
  },

  // Get a single project by ID (with team_id check)
  getProjectById: (teamId, projectId) => {
    return db.prepare('SELECT * FROM team_projects WHERE id = ? AND team_id = ?').get(projectId, teamId) || null;
  },

  // Remove project from team
  removeProject: (teamId, projectPath) => {
    return db.prepare('DELETE FROM team_projects WHERE team_id = ? AND project_path = ?').run(teamId, projectPath).changes > 0;
  },

  // Get teams for a project
  getTeamsForProject: (projectPath) => {
    return db.prepare(`
      SELECT t.* FROM teams t
      JOIN team_projects tp ON t.id = tp.team_id
      WHERE tp.project_path = ?
    `).all(projectPath);
  }
};

// Activity log database operations
const activityDb = {
  log: (teamId, userId, actionType, entityType = null, entityId = null, metadata = '{}') => {
    const stmt = db.prepare('INSERT INTO activity_log (team_id, user_id, action_type, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)');
    return stmt.run(teamId, userId, actionType, entityType, entityId, metadata);
  },

  getForTeam: (teamId, limit = 50, offset = 0) => {
    return db.prepare(`
      SELECT al.*, u.username
      FROM activity_log al
      JOIN users u ON al.user_id = u.id
      WHERE al.team_id = ?
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(teamId, limit, offset);
  }
};

// Notifications database operations
const notificationsDb = {
  create: (userId, teamId, type, title, body = null, link = null) => {
    const stmt = db.prepare('INSERT INTO notifications (user_id, team_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)');
    return { id: stmt.run(userId, teamId, type, title, body, link).lastInsertRowid };
  },

  getForUser: (userId, limit = 50, offset = 0, unreadOnly = false) => {
    const whereClause = unreadOnly ? 'AND n.is_read = 0' : '';
    return db.prepare(`
      SELECT n.*, t.name as team_name
      FROM notifications n
      LEFT JOIN teams t ON n.team_id = t.id
      WHERE n.user_id = ? ${whereClause}
      ORDER BY n.created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
  },

  getUnreadCount: (userId) => {
    const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(userId);
    return row.count;
  },

  markAsRead: (notificationId, userId) => {
    return db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(notificationId, userId).changes > 0;
  },

  markAllAsRead: (userId, teamId = null) => {
    if (teamId) {
      return db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND team_id = ?').run(userId, teamId).changes;
    }
    return db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId).changes;
  }
};

// Backward compatibility - keep old names pointing to new system
const githubTokensDb = {
  createGithubToken: (userId, tokenName, githubToken, description = null) => {
    return credentialsDb.createCredential(userId, tokenName, 'github_token', githubToken, description);
  },
  getGithubTokens: (userId) => {
    return credentialsDb.getCredentials(userId, 'github_token');
  },
  getActiveGithubToken: (userId) => {
    return credentialsDb.getActiveCredential(userId, 'github_token');
  },
  deleteGithubToken: (userId, tokenId) => {
    return credentialsDb.deleteCredential(userId, tokenId);
  },
  toggleGithubToken: (userId, tokenId, isActive) => {
    return credentialsDb.toggleCredential(userId, tokenId, isActive);
  }
};

// File activities (Story 4.3)
const fileActivitiesDb = {
  log: (teamId, userId, sessionId, filePath, action, projectPath) => {
    db.prepare(`INSERT INTO file_activities (team_id, user_id, session_id, file_path, action, project_path)
      VALUES (?, ?, ?, ?, ?, ?)`).run(teamId, userId, sessionId, filePath, action, projectPath);
  },
  getRecent: (teamId, limit = 50) => {
    return db.prepare(`SELECT fa.*, u.username, u.nickname FROM file_activities fa
      LEFT JOIN users u ON fa.user_id = u.id
      WHERE fa.team_id = ?
      ORDER BY fa.created_at DESC LIMIT ?`).all(teamId, limit);
  },
  getByUser: (teamId, userId, limit = 20) => {
    return db.prepare(`SELECT * FROM file_activities
      WHERE team_id = ? AND user_id = ?
      ORDER BY created_at DESC LIMIT ?`).all(teamId, userId, limit);
  },
  cleanup: (olderThanHours = 24) => {
    db.prepare(`DELETE FROM file_activities WHERE created_at < datetime('now', '-' || ? || ' hours')`)
      .run(olderThanHours);
  },
};

// Kanban (Sprint & Story)
const kanbanDb = {
  // Sprint CRUD
  createSprint: (teamId, name, description, startDate, endDate, createdBy) => {
    const stmt = db.prepare('INSERT INTO sprints (team_id, name, description, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?, ?)');
    const result = stmt.run(teamId, name, description || null, startDate || null, endDate || null, createdBy);
    return db.prepare('SELECT * FROM sprints WHERE id = ?').get(result.lastInsertRowid);
  },

  getActiveSprint: (teamId) => {
    return db.prepare('SELECT * FROM sprints WHERE team_id = ? AND status = ?').get(teamId, 'active') || null;
  },

  getSprints: (teamId, limit = 20, offset = 0) => {
    return db.prepare('SELECT * FROM sprints WHERE team_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(teamId, limit, offset);
  },

  getSprintById: (teamId, sprintId) => {
    return db.prepare('SELECT * FROM sprints WHERE id = ? AND team_id = ?').get(sprintId, teamId) || null;
  },

  updateSprint: (sprintId, teamId, updates) => {
    const ALLOWED_FIELDS = { name: 'name', description: 'description', start_date: 'start_date', end_date: 'end_date' };
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_FIELDS[key]) {
        fields.push(`${ALLOWED_FIELDS[key]} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return false;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(sprintId, teamId);
    return db.prepare(`UPDATE sprints SET ${fields.join(', ')} WHERE id = ? AND team_id = ?`).run(...values).changes > 0;
  },

  activateSprint: (sprintId, teamId) => {
    const transaction = db.transaction(() => {
      db.prepare("UPDATE sprints SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE team_id = ? AND status = 'active'").run(teamId);
      db.prepare("UPDATE sprints SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND team_id = ?").run(sprintId, teamId);
    });
    transaction();
    return db.prepare('SELECT * FROM sprints WHERE id = ? AND team_id = ?').get(sprintId, teamId);
  },

  completeSprint: (sprintId, teamId) => {
    const result = db.prepare("UPDATE sprints SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND team_id = ? AND status = 'active'").run(sprintId, teamId);
    return result.changes > 0;
  },

  // Story CRUD
  createStory: (teamId, sprintId, title, description, fileScope, priority, createdBy) => {
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM stories WHERE team_id = ? AND sprint_id = ? AND status = ?').get(teamId, sprintId, 'todo');
    const stmt = db.prepare('INSERT INTO stories (team_id, sprint_id, title, description, file_scope, priority, created_by, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(teamId, sprintId, title, description || null, JSON.stringify(fileScope || []), priority || 'medium', createdBy, maxPos.next_pos);
    return db.prepare('SELECT s.*, u.username as assigned_username, u.nickname as assigned_nickname, u.avatar_url as assigned_avatar FROM stories s LEFT JOIN users u ON s.assigned_to = u.id WHERE s.id = ?').get(result.lastInsertRowid);
  },

  getStoriesBySprint: (teamId, sprintId) => {
    return db.prepare(`SELECT s.*, u.username as assigned_username, u.nickname as assigned_nickname, u.avatar_url as assigned_avatar
      FROM stories s LEFT JOIN users u ON s.assigned_to = u.id
      WHERE s.team_id = ? AND s.sprint_id = ?
      ORDER BY s.position ASC`).all(teamId, sprintId);
  },

  getStoryById: (teamId, storyId) => {
    return db.prepare(`SELECT s.*, u.username as assigned_username, u.nickname as assigned_nickname, u.avatar_url as assigned_avatar
      FROM stories s LEFT JOIN users u ON s.assigned_to = u.id
      WHERE s.id = ? AND s.team_id = ?`).get(storyId, teamId) || null;
  },

  updateStory: (storyId, teamId, updates) => {
    const ALLOWED_FIELDS = { title: 'title', description: 'description', priority: 'priority', sprint_id: 'sprint_id' };
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_FIELDS[key]) {
        fields.push(`${ALLOWED_FIELDS[key]} = ?`);
        values.push(value);
      } else if (key === 'file_scope') {
        fields.push('file_scope = ?');
        values.push(JSON.stringify(value));
      }
    }
    if (fields.length === 0) return null;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(storyId, teamId);
    db.prepare(`UPDATE stories SET ${fields.join(', ')} WHERE id = ? AND team_id = ?`).run(...values);
    return kanbanDb.getStoryById(teamId, storyId);
  },

  deleteStory: (storyId, teamId) => {
    return db.prepare('DELETE FROM stories WHERE id = ? AND team_id = ?').run(storyId, teamId).changes > 0;
  },

  assignStory: (storyId, teamId, userId) => {
    db.prepare('UPDATE stories SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND team_id = ?').run(userId, storyId, teamId);
    return kanbanDb.getStoryById(teamId, storyId);
  },

  updateStoryStatus: (storyId, teamId, status, position) => {
    if (position !== undefined && position !== null) {
      db.prepare('UPDATE stories SET status = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND team_id = ?').run(status, position, storyId, teamId);
    } else {
      db.prepare('UPDATE stories SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND team_id = ?').run(status, storyId, teamId);
    }
    return kanbanDb.getStoryById(teamId, storyId);
  },

  reorderStories: (teamId, storyIds, status) => {
    const transaction = db.transaction(() => {
      const stmt = db.prepare('UPDATE stories SET position = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND team_id = ?');
      storyIds.forEach((id, index) => {
        stmt.run(index, status, id, teamId);
      });
    });
    transaction();
  },

  getMemberWorkScope: (teamId) => {
    return db.prepare(`
      SELECT s.id as story_id, s.title, s.status, s.file_scope, s.priority,
             s.assigned_to as user_id, u.username, u.nickname, u.avatar_url
      FROM stories s
      LEFT JOIN users u ON s.assigned_to = u.id
      WHERE s.team_id = ? AND s.assigned_to IS NOT NULL
      ORDER BY u.id, s.position
    `).all(teamId);
  },

  findFileScopeOverlaps: (teamId, sprintId) => {
    const stories = db.prepare(`
      SELECT id, title, assigned_to, file_scope
      FROM stories
      WHERE team_id = ? AND sprint_id = ? AND assigned_to IS NOT NULL AND file_scope != '[]'
    `).all(teamId, sprintId);

    const overlaps = [];
    for (let i = 0; i < stories.length; i++) {
      for (let j = i + 1; j < stories.length; j++) {
        if (stories[i].assigned_to === stories[j].assigned_to) continue;
        const scopeA = JSON.parse(stories[i].file_scope || '[]');
        const scopeB = JSON.parse(stories[j].file_scope || '[]');
        const sharedFiles = [];
        for (const a of scopeA) {
          for (const b of scopeB) {
            if (a === b || a.startsWith(b) || b.startsWith(a)) {
              sharedFiles.push(a === b ? a : (a.length < b.length ? a : b));
            }
          }
        }
        if (sharedFiles.length > 0) {
          overlaps.push({
            files: [...new Set(sharedFiles)],
            members: [stories[i].assigned_to, stories[j].assigned_to],
            storyIds: [stories[i].id, stories[j].id],
            storyTitles: [stories[i].title, stories[j].title]
          });
        }
      }
    }
    return overlaps;
  }
};

// Conflicts (Epic 6)
const conflictDb = {
  create: (teamId, sprintId, level, type, storyIds, memberIds, files, description) => {
    const stmt = db.prepare(`INSERT INTO conflicts (team_id, sprint_id, level, type, story_ids, member_ids, files, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const result = stmt.run(teamId, sprintId || null, level, type,
      JSON.stringify(storyIds), JSON.stringify(memberIds), JSON.stringify(files), description);
    return db.prepare('SELECT * FROM conflicts WHERE id = ?').get(result.lastInsertRowid);
  },

  getByTeam: (teamId, filters = {}) => {
    let where = 'WHERE c.team_id = ?';
    const params = [teamId];
    if (filters.status) { where += ' AND c.status = ?'; params.push(filters.status); }
    if (filters.sprintId) { where += ' AND c.sprint_id = ?'; params.push(filters.sprintId); }
    if (filters.level) { where += ' AND c.level = ?'; params.push(filters.level); }
    return db.prepare(`
      SELECT c.*, u1.username as assigned_username, u1.nickname as assigned_nickname,
             u2.username as resolved_username, u2.nickname as resolved_nickname
      FROM conflicts c
      LEFT JOIN users u1 ON c.assigned_to = u1.id
      LEFT JOIN users u2 ON c.resolved_by = u2.id
      ${where}
      ORDER BY c.created_at DESC
    `).all(...params);
  },

  getById: (conflictId, teamId) => {
    return db.prepare(`
      SELECT c.*, u1.username as assigned_username, u1.nickname as assigned_nickname,
             u2.username as resolved_username, u2.nickname as resolved_nickname
      FROM conflicts c
      LEFT JOIN users u1 ON c.assigned_to = u1.id
      LEFT JOIN users u2 ON c.resolved_by = u2.id
      WHERE c.id = ? AND c.team_id = ?
    `).get(conflictId, teamId) || null;
  },

  assign: (conflictId, teamId, userId) => {
    db.prepare(`UPDATE conflicts SET assigned_to = ?, status = 'in_progress', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND team_id = ?`).run(userId, conflictId, teamId);
    return conflictDb.getById(conflictId, teamId);
  },

  resolve: (conflictId, teamId, userId, resolutionNote) => {
    db.prepare(`UPDATE conflicts SET resolved_by = ?, resolution_note = ?, status = 'resolved',
      resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND team_id = ?`).run(userId, resolutionNote || null, conflictId, teamId);
    return conflictDb.getById(conflictId, teamId);
  },

  confirm: (conflictId, teamId) => {
    db.prepare(`UPDATE conflicts SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND team_id = ?`).run(conflictId, teamId);
    return conflictDb.getById(conflictId, teamId);
  },

  updateLevel: (conflictId, teamId, level) => {
    db.prepare('UPDATE conflicts SET level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND team_id = ?')
      .run(level, conflictId, teamId);
    return conflictDb.getById(conflictId, teamId);
  },

  findExisting: (teamId, storyIds, files) => {
    const conflicts = db.prepare(`SELECT * FROM conflicts WHERE team_id = ? AND status IN ('open','in_progress')`).all(teamId);
    return conflicts.find(c => {
      const cStoryIds = JSON.parse(c.story_ids || '[]');
      const cFiles = JSON.parse(c.files || '[]');
      const sameStories = storyIds.every(id => cStoryIds.includes(id)) && cStoryIds.every(id => storyIds.includes(id));
      const sameFiles = files.some(f => cFiles.includes(f));
      return sameStories && sameFiles;
    }) || null;
  },

  getStats: (teamId) => {
    return db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_count,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_count,
        COUNT(CASE WHEN level = 'yellow' AND status IN ('open','in_progress') THEN 1 END) as yellow_count,
        COUNT(CASE WHEN level = 'orange' AND status IN ('open','in_progress') THEN 1 END) as orange_count,
        COUNT(CASE WHEN level = 'red' AND status IN ('open','in_progress') THEN 1 END) as red_count
      FROM conflicts WHERE team_id = ?
    `).get(teamId);
  }
};

// Workflow (Epic 7)
const workflowDb = {
  createInstance: (teamId, userId, workflowType, steps) => {
    const stepNames = Array.isArray(steps) ? steps : [];
    const stmt = db.prepare(`INSERT INTO workflow_instances (team_id, user_id, workflow_type, status, current_step, total_steps, context_json)
      VALUES (?, ?, ?, 'active', ?, ?, ?)`);
    const result = stmt.run(teamId, userId, workflowType, stepNames[0] || null, stepNames.length,
      JSON.stringify({ steps: stepNames, completedSteps: [] }));
    return db.prepare('SELECT * FROM workflow_instances WHERE id = ?').get(result.lastInsertRowid);
  },

  getInstance: (workflowId, teamId) => {
    return db.prepare(`
      SELECT w.*, u.username, u.nickname, u.avatar_url
      FROM workflow_instances w
      LEFT JOIN users u ON w.user_id = u.id
      WHERE w.id = ? AND w.team_id = ?
    `).get(workflowId, teamId) || null;
  },

  getByTeam: (teamId, filters = {}) => {
    let where = 'WHERE w.team_id = ?';
    const params = [teamId];
    if (filters.status) { where += ' AND w.status = ?'; params.push(filters.status); }
    if (filters.userId) { where += ' AND w.user_id = ?'; params.push(filters.userId); }
    return db.prepare(`
      SELECT w.*, u.username, u.nickname, u.avatar_url
      FROM workflow_instances w
      LEFT JOIN users u ON w.user_id = u.id
      ${where}
      ORDER BY w.updated_at DESC
    `).all(...params);
  },

  getUserActive: (userId, teamId) => {
    return db.prepare(`
      SELECT w.*, u.username, u.nickname
      FROM workflow_instances w
      LEFT JOIN users u ON w.user_id = u.id
      WHERE w.user_id = ? AND w.team_id = ? AND w.status IN ('active','waiting_input')
    `).get(userId, teamId) || null;
  },

  updateStatus: (workflowId, status, contextJson) => {
    if (contextJson !== undefined) {
      db.prepare('UPDATE workflow_instances SET status = ?, context_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(status, typeof contextJson === 'string' ? contextJson : JSON.stringify(contextJson), workflowId);
    } else {
      db.prepare('UPDATE workflow_instances SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(status, workflowId);
    }
  },

  updateStep: (workflowId, currentStep, contextJson) => {
    db.prepare('UPDATE workflow_instances SET current_step = ?, context_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(currentStep, typeof contextJson === 'string' ? contextJson : JSON.stringify(contextJson), workflowId);
  },

  cancel: (workflowId, teamId) => {
    return db.prepare("UPDATE workflow_instances SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND team_id = ? AND status IN ('active','waiting_input','pending')")
      .run(workflowId, teamId).changes > 0;
  },

  addMessage: (workflowId, role, content, stepName, metadata) => {
    const stmt = db.prepare('INSERT INTO workflow_messages (workflow_id, role, content, step_name, metadata) VALUES (?, ?, ?, ?, ?)');
    const result = stmt.run(workflowId, role, content, stepName || null, JSON.stringify(metadata || {}));
    return db.prepare('SELECT * FROM workflow_messages WHERE id = ?').get(result.lastInsertRowid);
  },

  getMessages: (workflowId, limit = 100, offset = 0) => {
    return db.prepare('SELECT * FROM workflow_messages WHERE workflow_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?')
      .all(workflowId, limit, offset);
  },

  getCompletedDocuments: (teamId) => {
    return db.prepare(`
      SELECT w.id as workflow_id, w.workflow_type, w.created_at, w.updated_at,
             u.username, u.nickname, u.avatar_url,
             (SELECT content FROM workflow_messages WHERE workflow_id = w.id AND role = 'system' AND step_name = 'final_document' ORDER BY created_at DESC LIMIT 1) as document_content,
             (SELECT metadata FROM workflow_messages WHERE workflow_id = w.id AND role = 'system' AND step_name = 'final_document' ORDER BY created_at DESC LIMIT 1) as document_metadata
      FROM workflow_instances w
      LEFT JOIN users u ON w.user_id = u.id
      WHERE w.team_id = ? AND w.status = 'completed'
      ORDER BY w.updated_at DESC
    `).all(teamId);
  }
};

export {
  db,
  initializeDatabase,
  userDb,
  apiKeysDb,
  credentialsDb,
  sessionNamesDb,
  applyCustomSessionNames,
  userProjectsDb,
  githubTokensDb, // Backward compatibility
  teamDb,
  activityDb,
  notificationsDb,
  fileActivitiesDb,
  kanbanDb,
  conflictDb,
  workflowDb
};
