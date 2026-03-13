import { IS_PLATFORM } from "../constants/config";

// Utility function for authenticated API calls
export const authenticatedFetch = async (url, options = {}) => {
  const token = localStorage.getItem('auth-token');

  const defaultHeaders = {};

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (!IS_PLATFORM && token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });

  // Auto-clear session on token expiry (401) to force re-login
  if (response.status === 401 && token) {
    localStorage.removeItem('auth-token');
    window.location.reload();
  }

  return response;
};

// API endpoints
export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: () => fetch('/api/auth/status'),
    login: (email, password) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
    register: (email, password, username) => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, username }),
    }),
    user: () => authenticatedFetch('/api/auth/user'),
    logout: () => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  projects: () => authenticatedFetch('/api/projects'),
  sessions: (projectName, limit = 5, offset = 0) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions?limit=${limit}&offset=${offset}`),
  sessionMessages: (projectName, sessionId, limit = null, offset = 0, provider = 'claude') => {
    const params = new URLSearchParams();
    if (limit !== null) {
      params.append('limit', limit);
      params.append('offset', offset);
    }
    const queryString = params.toString();

    let url;
    if (provider === 'codex') {
      url = `/api/codex/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    } else if (provider === 'cursor') {
      url = `/api/cursor/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    } else if (provider === 'gemini') {
      url = `/api/gemini/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    } else {
      url = `/api/projects/${projectName}/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    }
    return authenticatedFetch(url);
  },
  renameProject: (projectName, displayName) =>
    authenticatedFetch(`/api/projects/${projectName}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  deleteSession: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  renameSession: (sessionId, summary, provider) =>
    authenticatedFetch(`/api/sessions/${sessionId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ summary, provider }),
    }),
  deleteCodexSession: (sessionId) =>
    authenticatedFetch(`/api/codex/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteGeminiSession: (sessionId) =>
    authenticatedFetch(`/api/gemini/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteProject: (projectName, force = false) =>
    authenticatedFetch(`/api/projects/${projectName}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    }),
  createProject: (path) =>
    authenticatedFetch('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  createWorkspace: (workspaceData) =>
    authenticatedFetch('/api/projects/create-workspace', {
      method: 'POST',
      body: JSON.stringify(workspaceData),
    }),
  readFile: (projectName, filePath) =>
    authenticatedFetch(`/api/projects/${projectName}/file?filePath=${encodeURIComponent(filePath)}`),
  saveFile: (projectName, filePath, content) =>
    authenticatedFetch(`/api/projects/${projectName}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  getFiles: (projectName, options = {}) =>
    authenticatedFetch(`/api/projects/${projectName}/files`, options),

  // File operations
  createFile: (projectName, { path, type, name }) =>
    authenticatedFetch(`/api/projects/${projectName}/files/create`, {
      method: 'POST',
      body: JSON.stringify({ path, type, name }),
    }),

  renameFile: (projectName, { oldPath, newName }) =>
    authenticatedFetch(`/api/projects/${projectName}/files/rename`, {
      method: 'PUT',
      body: JSON.stringify({ oldPath, newName }),
    }),

  deleteFile: (projectName, { path, type }) =>
    authenticatedFetch(`/api/projects/${projectName}/files`, {
      method: 'DELETE',
      body: JSON.stringify({ path, type }),
    }),

  uploadFiles: (projectName, formData) =>
    authenticatedFetch(`/api/projects/${projectName}/files/upload`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),

  transcribe: (formData) =>
    authenticatedFetch('/api/transcribe', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),

  // TaskMaster endpoints
  taskmaster: {
    // Initialize TaskMaster in a project
    init: (projectName) =>
      authenticatedFetch(`/api/taskmaster/init/${projectName}`, {
        method: 'POST',
      }),

    // Add a new task
    addTask: (projectName, { prompt, title, description, priority, dependencies }) =>
      authenticatedFetch(`/api/taskmaster/add-task/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ prompt, title, description, priority, dependencies }),
      }),

    // Parse PRD to generate tasks
    parsePRD: (projectName, { fileName, numTasks, append }) =>
      authenticatedFetch(`/api/taskmaster/parse-prd/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ fileName, numTasks, append }),
      }),

    // Get available PRD templates
    getTemplates: () =>
      authenticatedFetch('/api/taskmaster/prd-templates'),

    // Apply a PRD template
    applyTemplate: (projectName, { templateId, fileName, customizations }) =>
      authenticatedFetch(`/api/taskmaster/apply-template/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ templateId, fileName, customizations }),
      }),

    // Update a task
    updateTask: (projectName, taskId, updates) =>
      authenticatedFetch(`/api/taskmaster/update-task/${projectName}/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),
  },

  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath = null) => {
    const params = new URLSearchParams();
    if (dirPath) params.append('path', dirPath);

    return authenticatedFetch(`/api/browse-filesystem?${params}`);
  },

  createFolder: (folderPath) =>
    authenticatedFetch('/api/create-folder', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath }),
    }),

  // User endpoints
  user: {
    gitConfig: () => authenticatedFetch('/api/user/git-config'),
    updateGitConfig: (gitName, gitEmail) =>
      authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        body: JSON.stringify({ gitName, gitEmail }),
      }),
    onboardingStatus: () => authenticatedFetch('/api/user/onboarding-status'),
    completeOnboarding: () =>
      authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST',
      }),
    updateProfile: (nickname) =>
      authenticatedFetch('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ nickname }),
      }),
    uploadAvatar: (formData) =>
      authenticatedFetch('/api/auth/avatar', {
        method: 'POST',
        body: formData,
      }),
    updateRoles: (roles) =>
      authenticatedFetch('/api/auth/roles', {
        method: 'PUT',
        body: JSON.stringify({ roles }),
      }),
    setActiveRole: (role) =>
      authenticatedFetch('/api/auth/active-role', {
        method: 'PUT',
        body: JSON.stringify({ role }),
      }),
  },

  // Team endpoints
  team: {
    list: () => authenticatedFetch('/api/team'),
    get: (teamId) => authenticatedFetch(`/api/team/${teamId}`),
    create: (name, description, settings) =>
      authenticatedFetch('/api/team', {
        method: 'POST',
        body: JSON.stringify({ name, description, settings }),
      }),
    update: (teamId, name, description, settings) =>
      authenticatedFetch(`/api/team/${teamId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, description, settings }),
      }),
    delete: (teamId) =>
      authenticatedFetch(`/api/team/${teamId}`, { method: 'DELETE' }),

    // Members
    getMembers: (teamId) => authenticatedFetch(`/api/team/${teamId}/members`),
    updateMemberRole: (teamId, userId, role) =>
      authenticatedFetch(`/api/team/${teamId}/members/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      }),
    removeMember: (teamId, userId) =>
      authenticatedFetch(`/api/team/${teamId}/members/${userId}`, { method: 'DELETE' }),

    // Invites
    createInvite: (teamId, expiresInHours, maxUses) =>
      authenticatedFetch(`/api/team/${teamId}/invites`, {
        method: 'POST',
        body: JSON.stringify({ expiresInHours, maxUses }),
      }),
    getInvites: (teamId) => authenticatedFetch(`/api/team/${teamId}/invites`),
    deleteInvite: (teamId, inviteId) =>
      authenticatedFetch(`/api/team/${teamId}/invites/${inviteId}`, { method: 'DELETE' }),
    join: (inviteCode) =>
      authenticatedFetch('/api/team/join', {
        method: 'POST',
        body: JSON.stringify({ inviteCode }),
      }),

    // Projects
    createProject: (teamId, { name, projectPath, description }) =>
      authenticatedFetch(`/api/team/${teamId}/projects`, {
        method: 'POST',
        body: JSON.stringify({ name, projectPath, description }),
      }),
    getProjects: (teamId) => authenticatedFetch(`/api/team/${teamId}/projects`),
    getProjectBranches: (teamId, projectId) => authenticatedFetch(`/api/team/${teamId}/projects/${projectId}/branches`),
    getProjectPRs: (teamId, projectId) => authenticatedFetch(`/api/team/${teamId}/projects/${projectId}/pull-requests`),
    getProjectFiles: (teamId, projectId, ref) => authenticatedFetch(`/api/team/${teamId}/projects/${projectId}/files${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`),
    getProjectCommits: (teamId, projectId, limit = 20, offset = 0) => authenticatedFetch(`/api/team/${teamId}/projects/${projectId}/commits?limit=${limit}&offset=${offset}`),

    // Instances
    createInstance: (teamId, { projectPath, cols, rows }) =>
      authenticatedFetch(`/api/teams/${teamId}/instances`, {
        method: 'POST',
        body: JSON.stringify({ projectPath, cols, rows }),
      }),
    getMyInstance: (teamId) => authenticatedFetch(`/api/teams/${teamId}/instances/mine`),
    getInstances: (teamId) => authenticatedFetch(`/api/teams/${teamId}/instances`),
    getInstanceStats: (teamId) => authenticatedFetch(`/api/teams/${teamId}/instances/stats`),
    deleteInstance: (teamId, sessionId) =>
      authenticatedFetch(`/api/teams/${teamId}/instances/${sessionId}`, { method: 'DELETE' }),
    getFileActivities: (teamId) => authenticatedFetch(`/api/teams/${teamId}/file-activities`),
    removeProject: (teamId, projectPath) =>
      authenticatedFetch(`/api/team/${teamId}/projects`, {
        method: 'DELETE',
        body: JSON.stringify({ projectPath }),
      }),

    // Activity & Notifications
    getActivity: (teamId, limit = 50, offset = 0) =>
      authenticatedFetch(`/api/team/${teamId}/activity?limit=${limit}&offset=${offset}`),
    getNotifications: (limit = 50, offset = 0, unreadOnly = false) =>
      authenticatedFetch(`/api/team/notifications/list?limit=${limit}&offset=${offset}&unreadOnly=${unreadOnly}`),
    markNotificationRead: (notificationId) =>
      authenticatedFetch(`/api/team/notifications/${notificationId}/read`, { method: 'PUT' }),
    markAllNotificationsRead: (teamId) =>
      authenticatedFetch('/api/team/notifications/read-all', {
        method: 'PUT',
        body: JSON.stringify({ teamId }),
      }),

    // Presence
    getPresence: (teamId) => authenticatedFetch(`/api/team/${teamId}/presence`),
  },

  // Generic GET method for any endpoint
  get: (endpoint) => authenticatedFetch(`/api${endpoint}`),

  // Generic POST method for any endpoint
  post: (endpoint, body) => authenticatedFetch(`/api${endpoint}`, {
    method: 'POST',
    ...(body instanceof FormData ? { body } : { body: JSON.stringify(body) }),
  }),

  // Generic PUT method for any endpoint
  put: (endpoint, body) => authenticatedFetch(`/api${endpoint}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),

  // Generic DELETE method for any endpoint
  delete: (endpoint, options = {}) => authenticatedFetch(`/api${endpoint}`, {
    method: 'DELETE',
    ...options,
  }),
};