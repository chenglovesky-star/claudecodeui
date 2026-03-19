import express from 'express';
import { testContextContinuity } from '../claude-cli.js';

const router = express.Router();

// Claude CLI context continuity test endpoint
router.post('/test-context', async (req, res) => {
    try {
        const { projectPath, model } = req.body;
        const result = await testContextContinuity({ projectPath, model });
        res.json(result);
    } catch (error) {
        console.error('Claude CLI context test error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
