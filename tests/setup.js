import express from 'express';
import jwt from 'jsonwebtoken';
import { initializeDatabase, db, userDb, teamDb, kanbanDb, conflictDb, workflowDb, notificationsDb } from '../server/database/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'claude-ui-dev-secret-change-in-production';

// Clean all test data from database
function cleanDatabase() {
  const tables = [
    'workflow_messages', 'workflow_instances',
    'conflicts', 'conflict_members',
    'stories', 'sprints',
    'activity_log', 'notifications', 'file_activities',
    'team_invites', 'team_projects', 'team_members', 'teams',
    'users'
  ];
  for (const table of tables) {
    try { db.prepare(`DELETE FROM ${table}`).run(); } catch { /* table may not exist */ }
  }
}

// Auth middleware (simplified for tests)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = userDb.getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    try { req.teamRoles = teamDb.getUserTeamRoles(user.id); } catch { req.teamRoles = {}; }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Create test app with routes
export async function createTestApp() {
  // Initialize database
  initializeDatabase();
  // Clean data from prior runs
  cleanDatabase();

  const app = express();
  app.use(express.json());
  app.locals.connectedClients = new Map();

  // Import routes
  const { default: authRoutes } = await import('../server/routes/auth.js');
  const { default: teamRoutes } = await import('../server/routes/team.js');
  const { default: kanbanRoutes } = await import('../server/routes/kanban.js');
  const { default: conflictRoutes } = await import('../server/routes/conflict.js');
  const { default: workflowRoutes } = await import('../server/routes/workflow.js');
  const { default: userRoutes } = await import('../server/routes/user.js');

  // Mount routes
  app.use('/api/auth', authRoutes);
  app.use('/api/team', authenticateToken, teamRoutes);
  app.use('/api/teams', authenticateToken, kanbanRoutes);
  app.use('/api/teams', authenticateToken, conflictRoutes);
  app.use('/api/teams', authenticateToken, workflowRoutes);
  app.use('/api/user', authenticateToken, userRoutes);

  return app;
}

// Create test user and get JWT token
export function createTestUser(username = 'testuser', password = 'Test1234!') {
  const user = userDb.createUser(username, password);
  const token = jwt.sign({ userId: user.id, username }, JWT_SECRET, { expiresIn: '1h' });
  return { user, token };
}

// Create a second test user
export function createTestUser2(username = 'testuser2', password = 'Test1234!') {
  const user = userDb.createUser(username, password);
  const token = jwt.sign({ userId: user.id, username }, JWT_SECRET, { expiresIn: '1h' });
  return { user, token };
}

// Create test team with a user as PM
export function createTestTeam(userId, name = 'Test Team') {
  return teamDb.createTeam(name, 'Test team description', userId);
}

export { userDb, teamDb, kanbanDb, conflictDb, workflowDb, notificationsDb };
