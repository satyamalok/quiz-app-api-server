const express = require('express');
const router = express.Router();
const { getProfile, updateProfile, getReferralStatsHandler, getReferredUsersHandler, upload } = require('../controllers/userController');
const validationRules = require('../middleware/validation');
const authenticateJWT = require('../middleware/auth');

// All routes require authentication
router.use(authenticateJWT);

// GET /api/v1/user/profile
router.get('/profile', getProfile);

// PATCH /api/v1/user/profile
router.patch('/profile', upload.single('profile_image'), validationRules.updateProfile, updateProfile);

// GET /api/v1/user/referral-stats
router.get('/referral-stats', getReferralStatsHandler);

// GET /api/v1/user/referred-users
router.get('/referred-users', getReferredUsersHandler);

module.exports = router;
