import express from 'express';
import bcrypt from 'bcrypt';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { userDb, db } from '../database/db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION !== 'false';

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Ensure uploads/avatars directory exists
const AVATARS_DIR = path.join(__dirname, '../../uploads/avatars');
if (!fs.existsSync(AVATARS_DIR)) {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

// Allowed avatar file extensions and MIME types
const ALLOWED_AVATAR_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const ALLOWED_AVATAR_MIMES = ['image/jpeg', 'image/png'];

// Multer configuration for avatar uploads
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, AVATARS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Force safe extension even if originalname was manipulated
    const safeExt = ALLOWED_AVATAR_EXTENSIONS.includes(ext) ? ext : '.jpg';
    cb(null, `${req.user.id}_${Date.now()}${safeExt}`);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    // Validate both MIME type and file extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_AVATAR_MIMES.includes(file.mimetype) && ALLOWED_AVATAR_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 jpg/png 格式的图片'));
    }
  }
});

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
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
});

// User registration - multi-user support with email
router.post('/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '邮箱和密码为必填项' } });
    }

    // Validate email format
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '邮箱格式无效' } });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '密码至少需要6个字符' } });
    }

    // Use username from email prefix if not provided
    const finalUsername = username && username.trim().length >= 3 ? username.trim() : email.split('@')[0];

    // Hash password (done outside transaction since it's CPU-bound)
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Use transaction to prevent race conditions between email check and user creation
    db.prepare('BEGIN').run();
    try {
      // Check email uniqueness inside transaction
      const existingUser = userDb.getUserByEmail(email);
      if (existingUser) {
        db.prepare('ROLLBACK').run();
        return res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: '该邮箱已注册' } });
      }

      // Create user
      const user = userDb.createUser(finalUsername, passwordHash, email);

      // Generate token
      const token = generateToken(user);

      db.prepare('COMMIT').run();

      // Update last login (non-fatal, outside transaction)
      userDb.updateLastLogin(user.id);

      res.json({
        data: {
          user: { id: user.id, username: user.username, email: user.email },
          token
        }
      });
    } catch (txError) {
      db.prepare('ROLLBACK').run();
      throw txError;
    }

  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: '用户名或邮箱已存在' } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
    }
  }
});

// User login - supports email + password
router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    // Support both email and username for backward compatibility
    const loginIdentifier = email || username;

    // Validate input
    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '邮箱和密码为必填项' } });
    }

    // Try to find user by email first, then by username (backward compatibility)
    let user = null;
    if (email || EMAIL_REGEX.test(loginIdentifier)) {
      user = userDb.getUserByEmail(loginIdentifier);
    }
    if (!user) {
      user = userDb.getUserByUsername(loginIdentifier);
    }

    if (!user) {
      // Unified error message - don't reveal whether email exists
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: '邮箱或密码错误' } });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: '邮箱或密码错误' } });
    }

    // Generate token
    const token = generateToken(user);

    // Update last login
    userDb.updateLastLogin(user.id);

    res.json({
      data: {
        user: { id: user.id, username: user.username, email: user.email, nickname: user.nickname, avatar_url: user.avatar_url },
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
});

// Get current user (protected route)
router.get('/user', authenticateToken, (req, res) => {
  const user = req.user;
  const userData = { id: user.id, username: user.username, email: user.email, nickname: user.nickname, avatar_url: user.avatar_url };
  // Include both top-level `user` (legacy) and `data.user` (new format) for backward compatibility
  res.json({ user: userData, data: { user: userData } });
});

// Update profile (nickname)
router.put('/profile', authenticateToken, (req, res) => {
  try {
    const { nickname } = req.body;

    if (nickname === undefined) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '请提供要更新的字段' } });
    }

    // Validate nickname length
    if (typeof nickname !== 'string' || nickname.trim().length < 2 || nickname.trim().length > 20) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '昵称长度需在2-20个字符之间' } });
    }

    const updatedUser = userDb.updateProfile(req.user.id, { nickname: nickname.trim() });

    res.json({
      data: {
        user: { id: updatedUser.id, username: updatedUser.username, email: updatedUser.email, nickname: updatedUser.nickname, avatar_url: updatedUser.avatar_url }
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
});

// Upload avatar
router.post('/avatar', authenticateToken, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: { code: 'FILE_TOO_LARGE', message: '头像文件大小不能超过2MB' } });
        }
        return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.message } });
      }
      return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.message } });
    }

    if (!req.file) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '请选择要上传的头像文件' } });
    }

    try {
      // Delete old avatar file if exists
      const currentUser = userDb.getUserById(req.user.id);
      if (currentUser && currentUser.avatar_url) {
        const oldPath = path.join(__dirname, '../..', currentUser.avatar_url);
        try { fs.unlinkSync(oldPath); } catch (_) { /* ignore if file doesn't exist */ }
      }

      const avatarUrl = `/uploads/avatars/${req.file.filename}`;
      userDb.updateProfile(req.user.id, { avatarUrl });

      res.json({
        data: { avatar_url: avatarUrl }
      });
    } catch (error) {
      console.error('Avatar upload error:', error);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
    }
  });
});

// Logout (client-side token removal, but this endpoint can be used for logging)
router.post('/logout', authenticateToken, (req, res) => {
  // In a simple JWT system, logout is mainly client-side
  // This endpoint exists for consistency and potential future logging
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
