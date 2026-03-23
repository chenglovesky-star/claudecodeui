import express from 'express';
import { apiKeysDb, credentialsDb } from '../database/db.js';
import { anthropicKeyPoolDb } from '../database/anthropicKeyPoolDb.js';

const router = express.Router();

// ===============================
// API Keys Management
// ===============================

// Get all API keys for the authenticated user
router.get('/api-keys', async (req, res) => {
  try {
    const apiKeys = apiKeysDb.getApiKeys(req.user.id);
    // Don't send the full API key in the list for security
    const sanitizedKeys = apiKeys.map(key => ({
      ...key,
      api_key: key.api_key.substring(0, 10) + '...'
    }));
    res.json({ apiKeys: sanitizedKeys });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Create a new API key
router.post('/api-keys', async (req, res) => {
  try {
    const { keyName } = req.body;

    if (!keyName || !keyName.trim()) {
      return res.status(400).json({ error: 'Key name is required' });
    }

    const result = apiKeysDb.createApiKey(req.user.id, keyName.trim());
    res.json({
      success: true,
      apiKey: result
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// Delete an API key
router.delete('/api-keys/:keyId', async (req, res) => {
  try {
    const { keyId } = req.params;
    const success = apiKeysDb.deleteApiKey(req.user.id, parseInt(keyId));

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// Toggle API key active status
router.patch('/api-keys/:keyId/toggle', async (req, res) => {
  try {
    const { keyId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const success = apiKeysDb.toggleApiKey(req.user.id, parseInt(keyId), isActive);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    console.error('Error toggling API key:', error);
    res.status(500).json({ error: 'Failed to toggle API key' });
  }
});

// ===============================
// Generic Credentials Management
// ===============================

// Get all credentials for the authenticated user (optionally filtered by type)
router.get('/credentials', async (req, res) => {
  try {
    const { type } = req.query;
    const credentials = credentialsDb.getCredentials(req.user.id, type || null);
    // Don't send the actual credential values for security
    res.json({ credentials });
  } catch (error) {
    console.error('Error fetching credentials:', error);
    res.status(500).json({ error: 'Failed to fetch credentials' });
  }
});

// Create a new credential
router.post('/credentials', async (req, res) => {
  try {
    const { credentialName, credentialType, credentialValue, description } = req.body;

    if (!credentialName || !credentialName.trim()) {
      return res.status(400).json({ error: 'Credential name is required' });
    }

    if (!credentialType || !credentialType.trim()) {
      return res.status(400).json({ error: 'Credential type is required' });
    }

    if (!credentialValue || !credentialValue.trim()) {
      return res.status(400).json({ error: 'Credential value is required' });
    }

    const result = credentialsDb.createCredential(
      req.user.id,
      credentialName.trim(),
      credentialType.trim(),
      credentialValue.trim(),
      description?.trim() || null
    );

    res.json({
      success: true,
      credential: result
    });
  } catch (error) {
    console.error('Error creating credential:', error);
    res.status(500).json({ error: 'Failed to create credential' });
  }
});

// Delete a credential
router.delete('/credentials/:credentialId', async (req, res) => {
  try {
    const { credentialId } = req.params;
    const success = credentialsDb.deleteCredential(req.user.id, parseInt(credentialId));

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Credential not found' });
    }
  } catch (error) {
    console.error('Error deleting credential:', error);
    res.status(500).json({ error: 'Failed to delete credential' });
  }
});

// Toggle credential active status
router.patch('/credentials/:credentialId/toggle', async (req, res) => {
  try {
    const { credentialId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const success = credentialsDb.toggleCredential(req.user.id, parseInt(credentialId), isActive);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Credential not found' });
    }
  } catch (error) {
    console.error('Error toggling credential:', error);
    res.status(500).json({ error: 'Failed to toggle credential' });
  }
});

// ========== Anthropic Key Pool Management ==========

router.get('/key-pool', (req, res) => {
  try {
    const dbKeys = anthropicKeyPoolDb.getMasked();
    const runtimeStats = req.app.locals.keyPoolManager?.getStats() || null;
    res.json({ success: true, data: { keys: dbKeys, runtime: runtimeStats } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/key-pool', (req, res) => {
  try {
    const { name, apiKey, rpmLimit } = req.body;
    if (!name || !apiKey) {
      return res.status(400).json({ success: false, error: 'name and apiKey are required' });
    }
    const result = anthropicKeyPoolDb.add(name, apiKey, rpmLimit || 50);
    if (req.app.locals.keyPoolManager) {
      req.app.locals.keyPoolManager.addKey({
        id: result.id, name, api_key: apiKey, rpm_limit: rpmLimit || 50, enabled: 1,
      });
    }
    res.json({ success: true, data: { id: result.id, name, rpm_limit: rpmLimit || 50 } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/key-pool/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    anthropicKeyPoolDb.remove(id);
    if (req.app.locals.keyPoolManager) {
      req.app.locals.keyPoolManager.removeKey(id);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/key-pool/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { enabled, rpmLimit, name } = req.body;
    const fields = {};
    if (enabled !== undefined) fields.enabled = enabled ? 1 : 0;
    if (rpmLimit !== undefined) fields.rpm_limit = rpmLimit;
    if (name !== undefined) fields.name = name;
    anthropicKeyPoolDb.update(id, fields);
    const kpm = req.app.locals.keyPoolManager;
    if (kpm) {
      if (enabled === false) kpm.disableKey(id);
      else if (enabled === true) kpm.enableKey(id);
      if (rpmLimit !== undefined) kpm.updateKeyRpmLimit(id, rpmLimit);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
