# Hive meta_user 认证集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将登录认证从本地 SQLite bcrypt 改为讯飞 Hive `meta_user` 表明文验证，去掉注册功能。

**Architecture:** 新增 `server/database/hive.js` 封装 Hive 连接和用户查询。后端 login 端点改为调 Hive 验证 + 自动创建本地 SQLite 用户记录。前端去掉注册/设置相关组件，首屏直接登录。

**Tech Stack:** hive-driver (已安装), Express.js, better-sqlite3, React 18, JWT

---

## 文件变更总览

| 操作 | 文件 | 职责 |
|------|------|------|
| 新增 | `server/database/hive.js` | Hive 连接管理 + verifyUser() |
| 修改 | `server/database/db.js` | 新增 findOrCreateUserFromHive() |
| 修改 | `server/routes/auth.js` | login 走 Hive，移除 register，简化 status |
| 修改 | `.env` | 新增 Hive 连接配置 |
| 修改 | `.env.example` | 新增 Hive 配置模板 |
| 修改 | `src/components/auth/types.ts` | 移除 needsSetup/allowRegistration/register |
| 修改 | `src/components/auth/context/AuthContext.tsx` | 移除注册和 needsSetup 逻辑 |
| 修改 | `src/components/auth/view/ProtectedRoute.tsx` | 简化为：未登录→登录，已登录→主应用 |
| 修改 | `src/components/auth/view/LoginForm.tsx` | 移除注册链接 |
| 删除 | `src/components/auth/view/RegisterForm.tsx` | 不再需要 |
| 删除 | `src/components/auth/view/SetupForm.tsx` | 不再需要 |
| 修改 | `src/utils/api.js` | 移除 api.auth.register 方法 |
| 清理 | `package.json` | 移除 bcrypt 依赖 |
| 清理 | `.env.example` | 移除 ALLOW_REGISTRATION |

---

### Task 1: 新增 Hive 连接模块

**Files:**
- Create: `server/database/hive.js`

- [ ] **Step 1: 创建 hive.js 模块**

```javascript
import hive from 'hive-driver';

const { TCLIService, TCLIService_types } = hive.thrift;
const { PlainTcpAuthentication } = hive.auth;
const { TcpConnection } = hive.connections;

// 配置
const HIVE_HOST = process.env.HIVE_HOST || '10.100.108.90';
const HIVE_PORT = parseInt(process.env.HIVE_PORT || '10010', 10);
const HIVE_USER = process.env.HIVE_USER || 'sr';
const HIVE_PASSWORD = process.env.HIVE_PASSWORD || 'iflytek';
const HIVE_DATABASE = process.env.HIVE_DATABASE || 'ossp';
const HIVE_DOMAIN = process.env.HIVE_DOMAIN || 'claudeweb';
const HIVE_USER_TABLE = process.env.HIVE_USER_TABLE || 'default_catalog.dw_meta.meta_user';

let client = null;
let session = null;
let connectingPromise = null;

async function ensureSession() {
  if (session) return session;
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
  try {
    const connection = new TcpConnection();
    const auth = new PlainTcpAuthentication({ username: HIVE_USER, password: HIVE_PASSWORD });
    client = new hive.HiveClient(TCLIService, TCLIService_types);

    await client.connect(
      { host: HIVE_HOST, port: HIVE_PORT },
      connection,
      auth
    );

    session = await client.openSession({
      client_protocol: TCLIService_types.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V11,
      configuration: {
        'kyuubi.session.domain': HIVE_DOMAIN,
        'use:database': HIVE_DATABASE
      }
    });

    console.log(`[HIVE] Connected to ${HIVE_HOST}:${HIVE_PORT}, domain=${HIVE_DOMAIN}`);
    return session;
  } catch (err) {
    client = null;
    session = null;
    throw err;
  } finally {
    connectingPromise = null;
  }
  })();

  return connectingPromise;
}

function resetConnection() {
  try {
    if (session) session.close().catch(() => {});
    if (client) client.close();
  } catch (_) {}
  session = null;
  client = null;
}

/**
 * 查询 meta_user 表验证用户
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{username: string, role: string, status: number} | null>}
 */
async function verifyUser(username, password) {
  // 白名单校验防止 SQL 注入
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return null;
  }

  let retried = false;
  while (true) {
    try {
      const sess = await ensureSession();
      const escapedUsername = username.replace(/'/g, "\\'");
      const sql = `SELECT username, password, role, status FROM ${HIVE_USER_TABLE} WHERE username='${escapedUsername}' AND status=1 LIMIT 1`;

      const operation = await sess.executeStatement(sql, { runAsync: true });

      // 等待查询完成（超时 10s）
      const startTime = Date.now();
      let finished = false;
      while (Date.now() - startTime < 10000) {
        const status = await operation.status();
        if (status.operationState === TCLIService_types.TOperationState.FINISHED_STATE) {
          finished = true;
          break;
        }
        if (status.operationState === TCLIService_types.TOperationState.ERROR_STATE) {
          await operation.close();
          throw new Error('Hive query error');
        }
        await new Promise(r => setTimeout(r, 300));
      }

      if (!finished) {
        await operation.close().catch(() => {});
        throw new Error('Hive query timeout');
      }

      // 获取结果
      operation.setMaxRows(1);
      operation.setFetchType(TCLIService_types.TFetchOrientation.FETCH_NEXT);
      const chunk = await operation.nextFetch();
      await operation.close();

      const columns = chunk.results?.columns;
      if (!columns || !columns[0]?.stringVal?.values?.length) {
        return null; // 用户不存在
      }

      const hiveUsername = columns[0].stringVal.values[0];
      const hivePassword = columns[1].stringVal.values[0];
      const hiveRole = columns[2].stringVal.values[0];
      const hiveStatus = columns[3].i32Val.values[0];

      // 转 Buffer 为字符串
      const uname = Buffer.isBuffer(hiveUsername) ? hiveUsername.toString() : hiveUsername;
      const pwd = Buffer.isBuffer(hivePassword) ? hivePassword.toString() : hivePassword;
      const role = Buffer.isBuffer(hiveRole) ? hiveRole.toString() : hiveRole;

      // 明文密码比对
      if (pwd !== password) {
        return null;
      }

      return { username: uname, role, status: hiveStatus };
    } catch (err) {
      if (!retried) {
        retried = true;
        console.warn('[HIVE] Query failed, reconnecting:', err.message);
        resetConnection();
        continue;
      }
      console.error('[HIVE] verifyUser failed after retry:', err.message);
      throw err;
    }
  }
}

export { verifyUser };
```

- [ ] **Step 2: 验证模块可加载**

Run: `node -e "import('./server/database/hive.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`
Expected: OK（不会建立连接，只检查语法）

- [ ] **Step 3: 提交**

```bash
git add server/database/hive.js
git commit -m "feat: add Hive connection module for meta_user authentication"
```

---

### Task 2: 新增本地用户自动创建方法

**Files:**
- Modify: `server/database/db.js:139-220`

- [ ] **Step 1: 在 userDb 对象中新增 findOrCreateUserFromHive 方法**

在 `server/database/db.js` 的 `userDb` 对象中（`completeOnboarding` 方法之后）新增：

```javascript
  // Find or create a local user record for Hive-authenticated users
  findOrCreateUserFromHive: (username) => {
    try {
      let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (user) {
        db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
        return { id: user.id, username: user.username };
      }
      // Create new local user with placeholder password (auth is via Hive)
      const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
      const result = stmt.run(username, 'HIVE_AUTH_NO_LOCAL_PASSWORD');
      return { id: result.lastInsertRowid, username };
    } catch (err) {
      throw err;
    }
  },
```

- [ ] **Step 2: 验证方法可调用**

Run: `node -e "import('./server/database/db.js').then(m => { console.log(typeof m.userDb.findOrCreateUserFromHive); })"`
Expected: `function`

- [ ] **Step 3: 提交**

```bash
git add server/database/db.js
git commit -m "feat: add findOrCreateUserFromHive to userDb"
```

---

### Task 3: 改造后端认证路由

**Files:**
- Modify: `server/routes/auth.js`

- [ ] **Step 1: 替换整个 auth.js 文件**

```javascript
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
```

- [ ] **Step 2: 先完成 Task 4（.env 配置），再进行以下验证**

- [ ] **Step 3: 验证服务器可启动**

Run: `npm run build && node server/index.js`（启动后 Ctrl+C 即可）
Expected: 服务器启动无报错

- [ ] **Step 4: 手动测试登录**

Run: `curl -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"username":"leicheng9","password":"123456"}'`
Expected: 返回 `{"success":true,"user":{...},"token":"..."}`

- [ ] **Step 4: 测试错误密码**

Run: `curl -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"username":"leicheng9","password":"wrongpass"}'`
Expected: 返回 401 `{"error":"Invalid username or password"}`

- [ ] **Step 5: 测试注册已禁用**

Run: `curl -X POST http://localhost:3001/api/auth/register -H "Content-Type: application/json" -d '{"username":"test","password":"test123"}'`
Expected: 返回 403

- [ ] **Step 6: 提交**

```bash
git add server/routes/auth.js
git commit -m "feat: switch login to Hive meta_user verification, disable registration"
```

---

### Task 4: 添加环境变量配置

**Files:**
- Modify: `.env`
- Modify: `.env.example`

- [ ] **Step 1: 在 .env 末尾追加 Hive 配置**

```
# Hive/Kyuubi Authentication
HIVE_HOST=10.100.108.90
HIVE_PORT=10010
HIVE_USER=sr
HIVE_PASSWORD=iflytek
HIVE_DATABASE=ossp
HIVE_DOMAIN=claudeweb
HIVE_USER_TABLE=default_catalog.dw_meta.meta_user
```

- [ ] **Step 2: 在 .env.example 末尾追加 Hive 模板**

```
# Hive/Kyuubi Authentication
HIVE_HOST=
HIVE_PORT=10010
HIVE_USER=
HIVE_PASSWORD=
HIVE_DATABASE=ossp
HIVE_DOMAIN=claudeweb
HIVE_USER_TABLE=default_catalog.dw_meta.meta_user
```

- [ ] **Step 3: 提交**

```bash
git add .env.example
git commit -m "feat: add Hive connection config to .env.example"
```

注意：`.env` 不入库。

---

### Task 5: 简化前端类型定义

**Files:**
- Modify: `src/components/auth/types.ts`

- [ ] **Step 1: 更新类型定义**

将 `AuthStatusPayload` 简化，从 `AuthContextValue` 移除 `needsSetup`、`allowRegistration`、`register`：

```typescript
import type { ReactNode } from 'react';

export type AuthUser = {
  id?: number | string;
  username: string;
  [key: string]: unknown;
};

export type AuthActionResult = { success: true } | { success: false; error: string };

export type AuthSessionPayload = {
  token?: string;
  user?: AuthUser;
  error?: string;
  message?: string;
};

export type AuthStatusPayload = {
  needsSetup?: boolean;
  allowRegistration?: boolean;
};

export type AuthUserPayload = {
  user?: AuthUser;
};

export type OnboardingStatusPayload = {
  hasCompletedOnboarding?: boolean;
};

export type ApiErrorPayload = {
  error?: string;
  message?: string;
};

export type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  hasCompletedOnboarding: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<AuthActionResult>;
  logout: () => void;
  refreshOnboardingStatus: () => Promise<void>;
};

export type AuthProviderProps = {
  children: ReactNode;
};
```

- [ ] **Step 2: 提交**

```bash
git add src/components/auth/types.ts
git commit -m "refactor: remove registration and needsSetup from auth types"
```

---

### Task 6: 简化 AuthContext

**Files:**
- Modify: `src/components/auth/context/AuthContext.tsx`

- [ ] **Step 1: 更新 AuthContext.tsx**

移除 `needsSetup`、`allowRegistration`、`register` 相关逻辑：

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { IS_PLATFORM } from '../../../constants/config';
import { api } from '../../../utils/api';
import { AUTH_ERROR_MESSAGES, AUTH_TOKEN_STORAGE_KEY } from '../constants';
import type {
  AuthContextValue,
  AuthProviderProps,
  AuthSessionPayload,
  AuthUser,
  AuthUserPayload,
  OnboardingStatusPayload,
} from '../types';
import { parseJsonSafely, resolveApiErrorMessage } from '../utils';

const AuthContext = createContext<AuthContextValue | null>(null);

const readStoredToken = (): string | null => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

const persistToken = (token: string) => {
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
};

const clearStoredToken = () => {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [isLoading, setIsLoading] = useState(true);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSession = useCallback((nextUser: AuthUser, nextToken: string) => {
    setUser(nextUser);
    setToken(nextToken);
    persistToken(nextToken);
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    clearStoredToken();
  }, []);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonSafely<OnboardingStatusPayload>(response);
      setHasCompletedOnboarding(Boolean(payload?.hasCompletedOnboarding));
    } catch (caughtError) {
      console.error('Error checking onboarding status:', caughtError);
      setHasCompletedOnboarding(true);
    }
  }, []);

  const refreshOnboardingStatus = useCallback(async () => {
    await checkOnboardingStatus();
  }, [checkOnboardingStatus]);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (!token) {
        return;
      }

      const userResponse = await api.auth.user();
      if (!userResponse.ok) {
        clearSession();
        return;
      }

      const userPayload = await parseJsonSafely<AuthUserPayload>(userResponse);
      if (!userPayload?.user) {
        clearSession();
        return;
      }

      setUser(userPayload.user);
      await checkOnboardingStatus();
    } catch (caughtError) {
      console.error('[Auth] Auth status check failed:', caughtError);
      setError(AUTH_ERROR_MESSAGES.authStatusCheckFailed);
    } finally {
      setIsLoading(false);
    }
  }, [checkOnboardingStatus, clearSession, token]);

  useEffect(() => {
    if (IS_PLATFORM) {
      setUser({ username: 'platform-user' });
      void checkOnboardingStatus().finally(() => {
        setIsLoading(false);
      });
      return;
    }

    void checkAuthStatus();
  }, [checkAuthStatus, checkOnboardingStatus]);

  const login = useCallback<AuthContextValue['login']>(
    async (username, password) => {
      try {
        setError(null);
        const response = await api.auth.login(username, password);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        if (!response.ok || !payload?.token || !payload.user) {
          const message = resolveApiErrorMessage(payload, AUTH_ERROR_MESSAGES.loginFailed);
          setError(message);
          return { success: false, error: message };
        }

        setSession(payload.user, payload.token);
        await checkOnboardingStatus();
        return { success: true };
      } catch (caughtError) {
        console.error('Login error:', caughtError);
        setError(AUTH_ERROR_MESSAGES.networkError);
        return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
      }
    },
    [checkOnboardingStatus, setSession],
  );

  const logout = useCallback(() => {
    const tokenToInvalidate = token;
    clearSession();

    if (tokenToInvalidate) {
      void api.auth.logout().catch((caughtError: unknown) => {
        console.error('Logout endpoint error:', caughtError);
      });
    }
  }, [clearSession, token]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      hasCompletedOnboarding,
      error,
      login,
      logout,
      refreshOnboardingStatus,
    }),
    [
      error,
      hasCompletedOnboarding,
      isLoading,
      login,
      logout,
      refreshOnboardingStatus,
      token,
      user,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
```

- [ ] **Step 2: 确认编译通过**

Run: `npx tsc --noEmit 2>&1 | head -20`（可能有其他无关报错，只关注 auth 相关）

- [ ] **Step 3: 提交**

```bash
git add src/components/auth/context/AuthContext.tsx
git commit -m "refactor: remove registration and needsSetup from AuthContext"
```

---

### Task 7: 简化 ProtectedRoute 和 LoginForm

**Files:**
- Modify: `src/components/auth/view/ProtectedRoute.tsx`
- Modify: `src/components/auth/view/LoginForm.tsx`

- [ ] **Step 1: 简化 ProtectedRoute.tsx**

```tsx
import type { ReactNode } from 'react';
import { IS_PLATFORM } from '../../../constants/config';
import { useAuth } from '../context/AuthContext';
import Onboarding from '../../onboarding/view/Onboarding';
import AuthLoadingScreen from './AuthLoadingScreen';
import LoginForm from './LoginForm';

type ProtectedRouteProps = {
  children: ReactNode;
};

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, hasCompletedOnboarding, refreshOnboardingStatus } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (IS_PLATFORM) {
    if (!hasCompletedOnboarding) {
      return <Onboarding onComplete={refreshOnboardingStatus} />;
    }

    return <>{children}</>;
  }

  if (!user) {
    return <LoginForm />;
  }

  if (!hasCompletedOnboarding) {
    return <Onboarding onComplete={refreshOnboardingStatus} />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: 简化 LoginForm.tsx — 移除注册链接**

从 `LoginForm.tsx` 移除 `onSwitchToRegister` prop 和相关 UI：

```tsx
import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import AuthErrorAlert from './AuthErrorAlert';
import AuthInputField from './AuthInputField';
import AuthScreenLayout from './AuthScreenLayout';

type LoginFormState = {
  username: string;
  password: string;
};

const initialState: LoginFormState = {
  username: '',
  password: '',
};

export default function LoginForm() {
  const { t } = useTranslation('auth');
  const { login } = useAuth();

  const [formState, setFormState] = useState<LoginFormState>(initialState);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback((field: keyof LoginFormState, value: string) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      if (!formState.username.trim() || !formState.password) {
        setErrorMessage(t('login.errors.requiredFields'));
        return;
      }

      setIsSubmitting(true);
      const result = await login(formState.username.trim(), formState.password);
      if (!result.success) {
        setErrorMessage(result.error);
      }
      setIsSubmitting(false);
    },
    [formState.password, formState.username, login, t],
  );

  return (
    <AuthScreenLayout
      title={t('login.title')}
      description={t('login.description')}
      footerText="Enter your credentials to access Claude Code UI"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInputField
          id="username"
          label={t('login.username')}
          value={formState.username}
          onChange={(value) => updateField('username', value)}
          placeholder={t('login.placeholders.username')}
          isDisabled={isSubmitting}
        />

        <AuthInputField
          id="password"
          label={t('login.password')}
          value={formState.password}
          onChange={(value) => updateField('password', value)}
          placeholder={t('login.placeholders.password')}
          isDisabled={isSubmitting}
          type="password"
        />

        <AuthErrorAlert errorMessage={errorMessage} />

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-blue-700 disabled:bg-blue-400"
        >
          {isSubmitting ? t('login.loading') : t('login.submit')}
        </button>
      </form>
    </AuthScreenLayout>
  );
}
```

- [ ] **Step 3: 删除 RegisterForm.tsx 和 SetupForm.tsx**

```bash
rm src/components/auth/view/RegisterForm.tsx
rm src/components/auth/view/SetupForm.tsx
```

- [ ] **Step 4: 从 api.js 移除 register 方法**

在 `src/utils/api.js` 中，删除 `auth` 对象里的 `register` 方法定义。

- [ ] **Step 5: 确认前端编译通过**

Run: `npm run build`
Expected: 编译成功

- [ ] **Step 6: 提交**

```bash
git add -A src/components/auth/view/ src/utils/api.js
git commit -m "refactor: simplify ProtectedRoute and LoginForm, remove registration UI and unused components"
```

---

### Task 8: 清理依赖和配置

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: 移除 bcrypt 依赖**

Run: `npm uninstall bcrypt`

- [ ] **Step 2: 从 .env.example 移除 ALLOW_REGISTRATION 配置**

删除 `.env.example` 中 `ALLOW_REGISTRATION` 相关行。

- [ ] **Step 3: 确认构建通过**

Run: `npm run build`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: remove bcrypt dependency and ALLOW_REGISTRATION config"
```

---

### Task 9: 端到端验证

- [ ] **Step 1: 启动应用**

Run: `npm run dev`

- [ ] **Step 2: 验证首屏直接显示登录页**

打开浏览器访问 http://localhost:5173，确认：
- 无注册按钮/链接
- 无 SetupForm
- 直接显示登录表单

- [ ] **Step 3: 验证 Hive 用户登录**

用 Hive 中的账号登录（如 leicheng9 / 123456），确认：
- 登录成功
- 进入主应用
- WebSocket 连接正常

- [ ] **Step 4: 验证错误密码**

输入错误密码，确认显示错误提示

- [ ] **Step 5: 提交最终验证通过的状态**

如有任何修复，提交后标记完成。
