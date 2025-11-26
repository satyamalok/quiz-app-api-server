const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const quizRoutes = require('./quizRoutes');
const videoRoutes = require('./videoRoutes');
const statsRoutes = require('./statsRoutes');
const reelsRoutes = require('./reelsRoutes');

// Mount routes
router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/', quizRoutes); // Includes /level/* and /question/*
router.use('/video', videoRoutes);
router.use('/', statsRoutes); // Includes /leaderboard/*, /app/*
router.use('/reels', reelsRoutes); // Video reels feature

// Health check
router.get('/health', (req, res) => {
  res.json({ success: true, message: 'API server is running', timestamp: new Date() });
});

module.exports = router;
