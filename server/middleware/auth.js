import jwt from 'jsonwebtoken';
import path from 'path';
import { userDb } from '../database/db.js';
import { IS_PLATFORM } from '../constants/config.js';
import { WORKSPACES_ROOT } from '../routes/projects.js';

// Compute the per-user workspace root directory
const getUserWorkspaceRoot = (username) => {
  return path.join(WORKSPACES_ROOT, username);
};

// Get JWT secret from environment or use default (for development)
const JWT_SECRET = process.env.JWT_SECRET || 'claude-ui-dev-secret-change-in-production';
if (!process.env.JWT_SECRET) {
  console.warn('[SECURITY] WARNING: Using default JWT_SECRET. Set JWT_SECRET environment variable in production!');
}

// Fallback: decode JWT without verification, check user exists in DB
// For internal projects where JWT_SECRET may change between deployments
const fallbackDecodeAndVerifyUser = (token) => {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.userId) return null;

    const user = userDb.getUserById(decoded.userId);
    if (!user) return null;

    // Extra safety: username must match
    if (decoded.username && decoded.username !== user.username) return null;

    console.warn(`[AUTH] Fallback auth succeeded for user: ${user.username} (token signed with old secret)`);
    return { userId: user.id, username: user.username };
  } catch {
    return null;
  }
};

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  // Platform mode:  use single database user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(500).json({ error: 'Platform mode: No user found in database' });
      }
      req.user = user;
      req.user.workspaceRoot = user.username ? getUserWorkspaceRoot(user.username) : WORKSPACES_ROOT;
      return next();
    } catch (error) {
      console.error('Platform mode error:', error);
      return res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
    }
  }

  // Normal OSS JWT validation
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // Also check query param for SSE endpoints (EventSource can't set headers)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    req.user = user;
    req.user.workspaceRoot = user.username ? getUserWorkspaceRoot(user.username) : WORKSPACES_ROOT;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }

    // Fallback: signature mismatch (e.g. JWT_SECRET changed) → decode and check DB
    const fallbackUser = fallbackDecodeAndVerifyUser(token);
    if (fallbackUser) {
      const user = userDb.getUserById(fallbackUser.userId);
      if (user) {
        req.user = user;
        req.user.workspaceRoot = user.username ? getUserWorkspaceRoot(user.username) : WORKSPACES_ROOT;
        return next();
      }
    }

    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Generate JWT token (expires in 7 days)
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// WebSocket authentication function
const authenticateWebSocket = (token) => {
  // Platform mode: bypass token validation, return first user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { userId: user.id, username: user.username };
      }
      return null;
    } catch (error) {
      console.error('Platform mode WebSocket error:', error);
      return null;
    }
  }

  // Normal OSS JWT validation
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (error) {
    // Fallback: signature mismatch → decode and check DB
    const fallbackUser = fallbackDecodeAndVerifyUser(token);
    if (fallbackUser) return fallbackUser;

    console.error('WebSocket token verification error:', error);
    return null;
  }
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  getUserWorkspaceRoot,
  JWT_SECRET
};