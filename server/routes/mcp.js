import express from 'express';
import { userMcpDb } from '../database/db.js';

const router = express.Router();

// GET /api/mcp/cli/list - List MCP servers for current user
router.get('/cli/list', async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`📋 Listing MCP servers for user ${req.user.username}`);

    const rows = userMcpDb.getAll(userId);
    const servers = rows.map(row => {
      let config = {};
      try { config = JSON.parse(row.config_json); } catch {}
      return {
        name: row.name,
        type: row.type,
        status: 'active',
        description: config.url || config.command || '',
      };
    });

    res.json({ success: true, output: '', servers });
  } catch (error) {
    console.error('Error listing MCP servers:', error);
    res.status(500).json({ error: 'Failed to list MCP servers', details: error.message });
  }
});

// POST /api/mcp/cli/add - Add MCP server for current user
router.post('/cli/add', async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, type = 'stdio', command, args = [], url, headers = {}, env = {}, scope = 'user' } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Server name is required' });
    }

    console.log(`➕ Adding MCP server "${name}" for user ${req.user.username} (id=${userId})`);

    let config = {};
    if (type === 'stdio') {
      config = { command, args, env };
    } else {
      config = { url, headers };
    }

    userMcpDb.upsert(userId, name, type, config, scope);

    res.json({ success: true, message: `MCP server "${name}" added successfully` });
  } catch (error) {
    console.error('Error adding MCP server:', error);
    res.status(500).json({ error: 'Failed to add MCP server', details: error.message });
  }
});

// POST /api/mcp/cli/add-json - Add MCP server using JSON format
router.post('/cli/add-json', async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, jsonConfig, scope = 'user' } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Server name is required' });
    }

    let parsedConfig;
    try {
      parsedConfig = typeof jsonConfig === 'string' ? JSON.parse(jsonConfig) : jsonConfig;
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid JSON configuration', details: parseError.message });
    }

    if (!parsedConfig.type) {
      return res.status(400).json({ error: 'Invalid configuration', details: 'Missing required field: type' });
    }

    console.log(`➕ Adding MCP server "${name}" (JSON) for user ${req.user.username}`);

    const { type, ...configWithoutType } = parsedConfig;
    userMcpDb.upsert(userId, name, type, configWithoutType, scope);

    res.json({ success: true, message: `MCP server "${name}" added successfully via JSON` });
  } catch (error) {
    console.error('Error adding MCP server via JSON:', error);
    res.status(500).json({ error: 'Failed to add MCP server', details: error.message });
  }
});

// DELETE /api/mcp/cli/remove/:name - Remove MCP server for current user
router.delete('/cli/remove/:name', async (req, res) => {
  try {
    const userId = req.user.id;
    let { name } = req.params;

    if (name.includes(':')) {
      name = name.split(':')[1];
    }

    console.log(`🗑️ Removing MCP server "${name}" for user ${req.user.username}`);

    const removed = userMcpDb.remove(userId, name);
    if (!removed) {
      return res.status(404).json({ error: `MCP server "${name}" not found` });
    }

    res.json({ success: true, message: `MCP server "${name}" removed successfully` });
  } catch (error) {
    console.error('Error removing MCP server:', error);
    res.status(500).json({ error: 'Failed to remove MCP server', details: error.message });
  }
});

// GET /api/mcp/cli/get/:name - Get MCP server details for current user
router.get('/cli/get/:name', async (req, res) => {
  try {
    const userId = req.user.id;
    let { name } = req.params;

    if (name.includes(':')) {
      name = name.split(':')[1];
    }

    const row = userMcpDb.getByName(userId, name);
    if (!row) {
      return res.status(404).json({ error: `MCP server "${name}" not found` });
    }

    let config = {};
    try { config = JSON.parse(row.config_json); } catch {}

    res.json({ success: true, output: '', server: { name: row.name, type: row.type, ...config } });
  } catch (error) {
    console.error('Error getting MCP server:', error);
    res.status(500).json({ error: 'Failed to get MCP server details', details: error.message });
  }
});

// GET /api/mcp/config/read - Read MCP servers from DB for current user
router.get('/config/read', async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`📖 Reading MCP servers from DB for user ${req.user.username} (id=${userId})`);

    const rows = userMcpDb.getAll(userId);
    const servers = rows.map(row => {
      let config = {};
      try { config = JSON.parse(row.config_json); } catch {}

      const server = {
        id: row.name,
        name: row.name,
        type: row.type,
        scope: row.scope,
        config: {},
        raw: { type: row.type, ...config },
      };

      if (config.command) {
        server.config.command = config.command;
        server.config.args = config.args || [];
        server.config.env = config.env || {};
      } else if (config.url) {
        server.config.url = config.url;
        server.config.headers = config.headers || {};
      }

      server.created = row.created_at;
      server.updated = row.updated_at;

      return server;
    });

    console.log(`📋 Found ${servers.length} MCP servers for user ${req.user.username}`);
    res.json({ success: true, configPath: 'database', servers });
  } catch (error) {
    console.error('Error reading MCP servers from DB:', error);
    res.status(500).json({ error: 'Failed to read MCP configuration', details: error.message });
  }
});

export default router;
