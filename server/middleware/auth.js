import jwt from 'jsonwebtoken';
import { userDb, teamDb } from '../database/db.js';
import { IS_PLATFORM } from '../constants/config.js';

// Get JWT secret from environment or use default (for development)
const JWT_SECRET = process.env.JWT_SECRET || 'claude-ui-dev-secret-change-in-production';

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
      try { req.teamRoles = teamDb.getUserTeamRoles(user.id); } catch { req.teamRoles = {}; }
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

    // Inject team roles for team-aware endpoints
    try {
      req.teamRoles = teamDb.getUserTeamRoles(user.id);
    } catch {
      req.teamRoles = {};
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: { code: 'TOKEN_EXPIRED', message: 'Token 已过期，请重新登录' } });
    }
    console.error('Token verification error:', error);
    return res.status(403).json({ error: { code: 'INVALID_TOKEN', message: 'Token 无效' } });
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
    console.error('WebSocket token verification error:', error);
    return null;
  }
};

// Team role authorization middleware
// Usage: router.put('/path', checkTeamRole(['pm', 'sm']), handler)
const checkTeamRole = (requiredRoles) => {
  return (req, res, next) => {
    const teamId = parseInt(req.params.teamId || req.body.teamId);
    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    const userRole = req.teamRoles?.[teamId];
    if (!userRole) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(userRole)) {
      return res.status(403).json({ error: `Requires one of roles: ${requiredRoles.join(', ')}` });
    }

    req.currentTeamRole = userRole;
    next();
  };
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  checkTeamRole,
  JWT_SECRET
};