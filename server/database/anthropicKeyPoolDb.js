import { db } from './db.js';

const anthropicKeyPoolDb = {
  getAll() {
    return db.prepare('SELECT id, name, api_key, enabled, rpm_limit, total_requests, created_at FROM api_key_pool ORDER BY id').all();
  },

  getEnabled() {
    return db.prepare('SELECT id, name, api_key, enabled, rpm_limit, total_requests, created_at FROM api_key_pool WHERE enabled = 1 ORDER BY id').all();
  },

  add(name, apiKey, rpmLimit = 50) {
    const stmt = db.prepare('INSERT INTO api_key_pool (name, api_key, rpm_limit) VALUES (?, ?, ?)');
    const result = stmt.run(name, apiKey, rpmLimit);
    return { id: result.lastInsertRowid, name, enabled: 1, rpm_limit: rpmLimit };
  },

  remove(id) {
    return db.prepare('DELETE FROM api_key_pool WHERE id = ?').run(id);
  },

  update(id, fields) {
    const allowed = ['name', 'enabled', 'rpm_limit'];
    const updates = [];
    const values = [];
    for (const [key, value] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (updates.length === 0) return null;
    values.push(id);
    return db.prepare(`UPDATE api_key_pool SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  },

  incrementTotalRequests(id) {
    return db.prepare('UPDATE api_key_pool SET total_requests = total_requests + 1 WHERE id = ?').run(id);
  },

  count() {
    return db.prepare('SELECT COUNT(*) as count FROM api_key_pool').get().count;
  },

  getMasked() {
    const rows = this.getAll();
    return rows.map(row => ({
      ...row,
      api_key: row.api_key.slice(0, 8) + '...' + row.api_key.slice(-4)
    }));
  }
};

export { anthropicKeyPoolDb };
