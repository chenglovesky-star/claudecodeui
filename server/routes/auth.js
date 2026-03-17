import express from 'express';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import { userDb, db, userProjectsDb } from '../database/db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { WORKSPACES_ROOT } from './projects.js';
import { addProjectManually } from '../projects.js';

const router = express.Router();

const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION !== 'false';

// Check auth status and setup requirements
router.get('/status', async (req, res) => {
  try {
    const hasUsers = await userDb.hasUsers();
    res.json({
      needsSetup: !hasUsers,
      allowRegistration: ALLOW_REGISTRATION,
      isAuthenticated: false // Will be overridden by frontend if token exists
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User registration - open to new users (controlled by ALLOW_REGISTRATION env var)
router.post('/register', async (req, res) => {
  try {
    const hasUsers = await userDb.hasUsers();

    // If users already exist, check if registration is allowed
    if (hasUsers && !ALLOW_REGISTRATION) {
      return res.status(403).json({ error: 'Registration is currently disabled.' });
    }

    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: 'Username must be at least 3 characters, password at least 6 characters' });
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores and hyphens' });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = userDb.createUser(username, passwordHash);

    // Create user workspace directory and register as project
    try {
      const userWorkspace = path.join(WORKSPACES_ROOT, username);
      await fs.promises.mkdir(userWorkspace, { recursive: true });
      const project = await addProjectManually(userWorkspace);
      userProjectsDb.addProject(user.id, project.name);
      console.log(`[AUTH] Created workspace for user ${username}: ${userWorkspace}`);
    } catch (wsError) {
      // Non-fatal: user is created even if workspace setup fails
      console.error(`[AUTH] Failed to create workspace for user ${username}:`, wsError.message);
    }

    // Generate token
    const token = generateToken(user);

    // Update last login (non-fatal)
    userDb.updateLastLogin(user.id);

    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Get user from database
    const user = userDb.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Generate token
    const token = generateToken(user);
    
    // Update last login
    userDb.updateLastLogin(user.id);
    
    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (protected route)
router.get('/user', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

// Logout (client-side token removal, but this endpoint can be used for logging)
router.post('/logout', authenticateToken, (req, res) => {
  // In a simple JWT system, logout is mainly client-side
  // This endpoint exists for consistency and potential future logging
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;