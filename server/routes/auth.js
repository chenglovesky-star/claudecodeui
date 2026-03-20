import express from 'express';
import path from 'path';
import fs from 'fs';
import { userDb, userProjectsDb } from '../database/db.js';
import { verifyUser } from '../database/hive.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { WORKSPACES_ROOT } from './projects.js';
import { addProjectManually } from '../projects.js';

const router = express.Router();

// Check auth status
router.get('/status', async (req, res) => {
  try {
    res.json({
      needsSetup: false,
      allowRegistration: false,
      isAuthenticated: false
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User login via Hive meta_user
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Verify against Hive meta_user
    let hiveUser;
    try {
      hiveUser = await verifyUser(username, password);
    } catch (err) {
      console.error('[AUTH] Hive verification error:', err.message);
      return res.status(503).json({ error: 'Authentication service temporarily unavailable' });
    }

    if (!hiveUser) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Find or create local user record
    const localUser = userDb.findOrCreateUserFromHive(username);

    // Ensure user workspace exists
    try {
      const userWorkspace = path.join(WORKSPACES_ROOT, username);
      await fs.promises.mkdir(userWorkspace, { recursive: true });
      const project = await addProjectManually(userWorkspace);
      userProjectsDb.addProject(localUser.id, project.name);
    } catch (wsError) {
      // Non-fatal
      console.error(`[AUTH] Workspace setup for ${username}:`, wsError.message);
    }

    // Generate token
    const token = generateToken(localUser);

    res.json({
      success: true,
      user: { id: localUser.id, username: localUser.username },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Registration disabled - all users come from Hive
router.post('/register', (req, res) => {
  res.status(403).json({ error: 'Registration is disabled. Please use your Hive account to login.' });
});

// Get current user (protected route)
router.get('/user', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

// Logout
router.post('/logout', authenticateToken, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
