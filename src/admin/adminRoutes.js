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
  showUsers,
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
  deleteVideo,
  // Analytics
  showAnalytics,
  upload
} = require('./adminController');
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

// User Statistics
router.get('/users', showUsers);

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
router.delete('/videos/:id', deleteVideo);

// Analytics
router.get('/analytics', showAnalytics);

module.exports = router;
