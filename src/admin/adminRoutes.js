const express = require('express');
const router = express.Router();
const {
  showLogin,
  processLogin,
  logout,
  showDashboard,
  showOTPViewer,
  showConfig,
  updateConfig,
  showWhatsAppConfig,
  updateWhatsAppConfig,
  showUsers,
  listAllUsers,
  viewUserProfile,
  showEditUser,
  updateUser,
  // Question management
  showQuestionUpload,
  uploadCSVForMapping,
  bulkInsertQuestions,
  createQuestion,
  listQuestions,
  showEditQuestion,
  updateQuestion,
  deleteQuestion,
  bulkDeleteQuestions,
  // Video management
  showVideos,
  uploadVideo,
  showEditVideo,
  updateVideo,
  deleteVideo,
  duplicateVideo,
  // Analytics
  showAnalytics,
  // DB Stats
  getDbStats,
  upload
} = require('./adminController');
const { getReferralDashboard } = require('./referralAdminController');
const {
  showReels,
  showUploadPage: showReelsUpload,
  uploadReels,
  showEditReel,
  updateReel,
  toggleReelStatus,
  deleteReel,
  bulkAction: reelsBulkAction,
  showAnalytics: showReelsAnalytics,
  upload: reelsUpload
} = require('./reelsAdminController');
const {
  showLevels,
  showCreateLevel,
  createLevelHandler,
  showEditLevel,
  updateLevelHandler,
  deleteLevelHandler,
  toggleLevelStatus
} = require('./levelsAdminController');
const {
  deleteUser,
  purgeUser,
  resetUserProgress,
  bulkUserAction
} = require('./userManagementController');
const {
  showResetPage,
  performReset,
  resetAllData
} = require('./systemResetController');
const { requireAdminAuth, redirectIfAuthenticated } = require('../middleware/adminAuth');

// Login routes (public)
router.get('/login', redirectIfAuthenticated, showLogin);
router.post('/login', processLogin);
router.get('/logout', logout);

// Protected routes (require authentication)
router.use(requireAdminAuth);

// Dashboard
router.get('/', showDashboard);
router.get('/dashboard', showDashboard);

// OTP Viewer
router.get('/otp-viewer', showOTPViewer);

// Configuration
router.get('/config', showConfig);
router.post('/config/update', updateConfig);

// WhatsApp Configuration
router.get('/config/whatsapp', showWhatsAppConfig);
router.post('/config/whatsapp/update', updateWhatsAppConfig);

// Referral Analytics
router.get('/referrals', getReferralDashboard);

// User Management
router.get('/users', showUsers); // Stats page
router.get('/users/list', listAllUsers); // List all users
router.get('/users/:phone/view', viewUserProfile); // View user profile
router.get('/users/:phone/edit', showEditUser); // Edit user form
router.post('/users/:phone/update', updateUser); // Update user
router.post('/users/:phone/delete', deleteUser); // Soft delete user
router.post('/users/:phone/purge', purgeUser); // Hard delete user and all data
router.post('/users/:phone/reset', resetUserProgress); // Reset user progress
router.post('/users/bulk-action', bulkUserAction); // Bulk actions

// Question Management
router.get('/questions/upload', showQuestionUpload);
router.post('/questions/upload-csv', upload.single('csv_file'), uploadCSVForMapping);
router.post('/questions/bulk-insert', bulkInsertQuestions);
router.post('/questions/bulk-delete', bulkDeleteQuestions);
router.post('/questions/create', upload.fields([
  { name: 'question_image', maxCount: 1 },
  { name: 'explanation_image', maxCount: 1 }
]), createQuestion);
router.get('/questions', listQuestions);
router.get('/questions/:id/edit', showEditQuestion);
router.post('/questions/:id/update', upload.fields([
  { name: 'question_image', maxCount: 1 },
  { name: 'explanation_image', maxCount: 1 }
]), updateQuestion);
router.delete('/questions/:id', deleteQuestion);

// Video Management
router.get('/videos', showVideos);
router.post('/videos/upload', upload.single('video_file'), uploadVideo);
router.get('/videos/:id/edit', showEditVideo);
router.post('/videos/:id/update', updateVideo);
router.post('/videos/:id/duplicate', duplicateVideo);
router.delete('/videos/:id', deleteVideo);

// Analytics
router.get('/analytics', showAnalytics);

// DB Stats (for PM2 cluster monitoring)
router.get('/db-stats', getDbStats);

// Reels Management
router.get('/reels', showReels);
router.get('/reels/upload', showReelsUpload);
router.post('/reels/upload', reelsUpload.array('videos', 20), uploadReels);
router.get('/reels/analytics', showReelsAnalytics);
router.get('/reels/:id/edit', showEditReel);
router.post('/reels/:id/update', updateReel);
router.post('/reels/:id/toggle', toggleReelStatus);
router.delete('/reels/:id', deleteReel);
router.post('/reels/bulk-action', reelsBulkAction);

// Quiz Levels Management
router.get('/levels', showLevels);
router.get('/levels/create', showCreateLevel);
router.post('/levels/create', createLevelHandler);
router.get('/levels/:levelNumber/edit', showEditLevel);
router.post('/levels/:levelNumber/update', updateLevelHandler);
router.post('/levels/:levelNumber/delete', deleteLevelHandler);
router.post('/levels/:levelNumber/toggle', toggleLevelStatus);

// System Reset (Database Management)
router.get('/system/reset', showResetPage);
router.post('/system/reset', performReset);
router.post('/system/reset-all', resetAllData);

module.exports = router;
