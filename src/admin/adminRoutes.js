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
  testEventWebhook,
  testPurchaseWebhook, // Feature 5
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
  bulkDeleteVideos,
  duplicateVideo,
  showVideoBulkUpload,
  uploadSingleVideo,
  // Video Categories (Feature 1)
  showVideoCategories,
  createVideoCategory,
  updateVideoCategory,
  deleteVideoCategory,
  getVideoCategoriesAPI,
  // Analytics
  showAnalytics,
  // DB Stats
  getDbStats,
  upload
} = require('./adminController');
const {
  showApps,
  showCreateApp,
  createApp,
  showEditApp,
  updateApp,
  toggleAppStatus,
  deleteApp,
  loadAppsForNav,
  selectApp,
  initializeTenancy
} = require('./appManagementController');
const { getReferralDashboard } = require('./referralAdminController');
const {
  showReels,
  showUploadPage: showReelsUpload,
  uploadReels,
  uploadSingleReel,
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
const {
  showChapters,
  showCreateChapter,
  createChapter,
  showEditChapter,
  updateChapter,
  deleteChapter,
  reorderChapters,
  showItems,
  showCreateItem,
  createItem,
  showEditItem,
  updateItem,
  deleteItem,
  bulkItemAction,
  showBulkUpload: showShopBulkUpload,
  bulkUploadSingle: shopBulkUploadSingle,
  showPurchases,
  showShopAnalytics,
  showBalanceLeaderboard,
  showUserPurchases,
  upload: shopUpload
} = require('./shopAdminController');
// Feature 2: Level Content Admin
const {
  showLevelContent,
  showLevelContentByLevel,
  showCreateContent: showCreateLevelContent,
  createContent: createLevelContent,
  showEditContent: showEditLevelContent,
  updateContent: updateLevelContent,
  deleteContent: deleteLevelContent,
  bulkAction: levelContentBulkAction,
  showBulkUpload: showLevelContentBulkUpload,
  bulkUploadSingle: levelContentBulkUploadSingle,
  showAnalytics: showLevelContentAnalytics,
  upload: levelContentUpload
} = require('./levelContentAdminController');
// Feature 6: Daily Gifts Admin
const {
  showDailyGifts,
  showCalendar: showDailyGiftsCalendar,
  showCreateGift,
  createGift,
  showEditGift,
  updateGift,
  deleteGift,
  toggleGiftStatus,
  showBulkUpload: showDailyGiftsBulkUpload,
  bulkUploadSingle: dailyGiftsBulkUploadSingle,
  upload: dailyGiftUpload
} = require('./dailyGiftAdminController');
// Feature 7: Sales Agents Admin
const {
  showAgents,
  showCreateAgent,
  createAgent,
  showEditAgent,
  updateAgent,
  deleteAgent,
  toggleAgentStatus,
  showMessages: showAgentMessages,
  createMessage: createAgentMessage,
  updateMessage: updateAgentMessage,
  deleteMessage: deleteAgentMessage,
  showDistribution,
  updateDistribution,
  showAnalytics: showAgentAnalytics
} = require('./agentAdminController');
const { requireAdminAuth, redirectIfAuthenticated } = require('../middleware/adminAuth');
const { requireAppSelection } = require('../middleware/requireAppSelection');

// Login routes (public)
router.get('/login', redirectIfAuthenticated, showLogin);
router.post('/login', processLogin);
router.get('/logout', logout);

// Protected routes (require authentication)
router.use(requireAdminAuth);

// Load apps for navigation dropdown on all admin pages
router.use(loadAppsForNav);

// ============================================
// APP MANAGEMENT ROUTES (No app selection required)
// These routes manage apps themselves, not tenant data
// ============================================
router.get('/apps', showApps);
router.get('/apps/create', showCreateApp);
router.post('/apps/create', createApp);
router.post('/apps/select', selectApp);
router.post('/apps/initialize', initializeTenancy);
router.get('/apps/:id/edit', showEditApp);
router.post('/apps/:id/update', updateApp);
router.post('/apps/:id/toggle', toggleAppStatus);
router.post('/apps/:id/delete', deleteApp);

// ============================================
// TENANT-SPECIFIC ROUTES (Require app selection)
// All routes below require an app to be selected
// ============================================
router.use(requireAppSelection);

// Dashboard
router.get('/', showDashboard);
router.get('/dashboard', showDashboard);

// OTP Viewer
router.get('/otp-viewer', showOTPViewer);

// Configuration
router.get('/config', showConfig);
router.post('/config/update', updateConfig);
router.post('/config/test-webhook', testEventWebhook);
router.post('/config/test-purchase-webhook', testPurchaseWebhook); // Feature 5

// Cache Management
const cacheService = require('../services/cacheService');

/**
 * Helper to prepare tenant context from admin session
 * Admin panel uses req.session.currentApp instead of req.tenant
 */
function prepareAdminReqWithTenant(req) {
  if (req.session?.currentApp) {
    req.tenant = {
      slug: req.session.currentApp.slug,
      redisPrefix: `${req.session.currentApp.slug}:`,
      schema: req.session.currentApp.slug
    };
  }
  return req;
}

// Cache management page
router.get('/cache', async (req, res) => {
  res.render('cache-management', {
    currentApp: req.session.currentApp
  });
});

// Get cache stats for current app
router.get('/cache/stats', async (req, res) => {
  try {
    prepareAdminReqWithTenant(req);
    const stats = await cacheService.getCacheStats(req);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message });
  }
});

// Get all cache keys for current app
router.get('/cache/keys', async (req, res) => {
  try {
    prepareAdminReqWithTenant(req);
    const result = await cacheService.getAllCacheKeys(req);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Flush cache (by type or all)
router.post('/cache/flush', async (req, res) => {
  try {
    prepareAdminReqWithTenant(req);
    const { type = 'all' } = req.body;
    const result = await cacheService.flushCache(type, req);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Refresh all caches (alias for flush all)
router.post('/cache/refresh', async (req, res) => {
  try {
    prepareAdminReqWithTenant(req);
    const result = await cacheService.refreshAllCaches(req);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reload cache (pre-warm after flush)
const { reloadCacheForApp } = require('../services/prewarmService');

router.post('/cache/reload', async (req, res) => {
  try {
    prepareAdminReqWithTenant(req);
    if (!req.session?.currentApp?.slug) {
      return res.status(400).json({ success: false, error: 'No app selected' });
    }
    const result = await reloadCacheForApp(req.session.currentApp.slug);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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

// Video Categories (Feature 1)
router.get('/video-categories', showVideoCategories);
router.post('/video-categories', createVideoCategory);
router.post('/video-categories/:id/update', updateVideoCategory);
router.post('/video-categories/:id/delete', deleteVideoCategory);
router.get('/api/video-categories', getVideoCategoriesAPI);

// Video Management
router.get('/videos', showVideos);
router.get('/videos/bulk-upload', showVideoBulkUpload);
router.post('/videos/upload', upload.single('video_file'), uploadVideo);
router.post('/videos/upload-single', upload.single('video'), uploadSingleVideo);
router.post('/videos/bulk-delete', bulkDeleteVideos);
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
router.post('/reels/upload-single', reelsUpload.single('video'), uploadSingleReel);
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

// Shop Management
router.get('/shop/chapters', showChapters);
router.get('/shop/chapters/create', showCreateChapter);
router.post('/shop/chapters/create', shopUpload.single('icon'), createChapter);
router.get('/shop/chapters/:id/edit', showEditChapter);
router.post('/shop/chapters/:id/update', shopUpload.single('icon'), updateChapter);
router.post('/shop/chapters/:id/delete', deleteChapter);
router.post('/shop/chapters/reorder', reorderChapters);

router.get('/shop/items', showItems);
router.get('/shop/items/create', showCreateItem);
router.get('/shop/items/bulk-upload', showShopBulkUpload);
router.post('/shop/items/create', shopUpload.fields([
  { name: 'pdf_file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), createItem);
router.post('/shop/items/bulk-upload-single', shopUpload.fields([
  { name: 'files', maxCount: 1 }
]), shopBulkUploadSingle);
router.get('/shop/items/:id/edit', showEditItem);
router.post('/shop/items/:id/update', shopUpload.fields([
  { name: 'pdf_file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), updateItem);
router.post('/shop/items/:id/delete', deleteItem);
router.post('/shop/items/bulk-action', bulkItemAction);

router.get('/shop/purchases', showPurchases);
router.get('/shop/analytics', showShopAnalytics);
router.get('/shop/leaderboard', showBalanceLeaderboard);
router.get('/shop/user/:phone/purchases', showUserPurchases);

// Feature 2: Level Content Management
router.get('/level-content', showLevelContent);
router.get('/level-content/create', showCreateLevelContent);
router.get('/level-content/bulk-upload', showLevelContentBulkUpload);
router.post('/level-content/create', levelContentUpload.fields([
  { name: 'content_file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), createLevelContent);
router.post('/level-content/bulk-upload-single', levelContentUpload.fields([
  { name: 'files', maxCount: 1 }
]), levelContentBulkUploadSingle);
router.get('/level-content/analytics', showLevelContentAnalytics);
router.get('/level-content/level/:level', showLevelContentByLevel);
router.get('/level-content/:id/edit', showEditLevelContent);
router.post('/level-content/:id/update', levelContentUpload.fields([
  { name: 'content_file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), updateLevelContent);
router.post('/level-content/:id/delete', deleteLevelContent);
router.post('/level-content/bulk-action', levelContentBulkAction);

// Feature 6: Daily Gifts Management
router.get('/daily-gifts', showDailyGifts);
router.get('/daily-gifts/calendar', showDailyGiftsCalendar);
router.get('/daily-gifts/create', showCreateGift);
router.get('/daily-gifts/bulk-upload', showDailyGiftsBulkUpload);
router.post('/daily-gifts/create', dailyGiftUpload.fields([
  { name: 'gift_file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), createGift);
router.post('/daily-gifts/bulk-upload-single', dailyGiftUpload.fields([
  { name: 'files', maxCount: 1 }
]), dailyGiftsBulkUploadSingle);
router.get('/daily-gifts/:id/edit', showEditGift);
router.post('/daily-gifts/:id/update', dailyGiftUpload.fields([
  { name: 'gift_file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), updateGift);
router.post('/daily-gifts/:id/delete', deleteGift);
router.post('/daily-gifts/:id/toggle', toggleGiftStatus);

// Feature 7: Sales Agents Management
router.get('/agents', showAgents);
router.get('/agents/create', showCreateAgent);
router.post('/agents/create', createAgent);
router.get('/agents/:id/edit', showEditAgent);
router.post('/agents/:id/update', updateAgent);
router.post('/agents/:id/delete', deleteAgent);
router.post('/agents/:id/toggle', toggleAgentStatus);

// Agent Messages
router.get('/agent-messages', showAgentMessages);
router.post('/agent-messages/create', createAgentMessage);
router.post('/agent-messages/:id/update', updateAgentMessage);
router.post('/agent-messages/:id/delete', deleteAgentMessage);

// Agent Distribution
router.get('/agent-distribution', showDistribution);
router.post('/agent-distribution/update', updateDistribution);

// Agent Analytics
router.get('/agent-analytics', showAgentAnalytics);

module.exports = router;
