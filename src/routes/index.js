const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const quizRoutes = require('./quizRoutes');
const videoRoutes = require('./videoRoutes');
const statsRoutes = require('./statsRoutes');
const reelsRoutes = require('./reelsRoutes');
const levelsRoutes = require('./levelsRoutes');

// Import tenant middleware
const { tenantMiddleware, attachTenantHelpers } = require('../middleware/tenantMiddleware');

// Health check (global, no tenant context needed)
router.get('/health', (req, res) => {
  res.json({ success: true, message: 'API server is running', timestamp: new Date() });
});

// ============================================
// MULTI-TENANT ROUTES: /api/v1/:appId/*
// All routes below require tenant context
// ============================================

// Apply tenant middleware for all routes under /:appId
router.use('/:appId', tenantMiddleware(), attachTenantHelpers());

// Mount routes under tenant context
router.use('/:appId/auth', authRoutes);
router.use('/:appId/user', userRoutes);
router.use('/:appId/levels', levelsRoutes); // Quiz levels metadata (unauthenticated) - MUST be before quizRoutes
router.use('/:appId', quizRoutes); // Includes /level/* and /question/*
router.use('/:appId/video', videoRoutes);
router.use('/:appId', statsRoutes); // Includes /leaderboard/*, /app/*
router.use('/:appId/reels', reelsRoutes); // Video reels feature

module.exports = router;
