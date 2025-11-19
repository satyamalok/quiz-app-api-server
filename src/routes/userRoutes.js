const express = require('express');
const router = express.Router();
const { getProfile, updateProfile, upload } = require('../controllers/userController');
const validationRules = require('../middleware/validation');
const authenticateJWT = require('../middleware/auth');

// All routes require authentication
router.use(authenticateJWT);

// GET /api/v1/user/profile
router.get('/profile', getProfile);

// PATCH /api/v1/user/profile
router.patch('/profile', upload.single('profile_image'), validationRules.updateProfile, updateProfile);

module.exports = router;
