// backend/src/routes/meetings.js
/**
 * Meeting Routes
 * Handles all meeting-related API endpoints
 */

const express = require('express');
const router = express.Router();
const meetingController = require('../controllers/meetingController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateFileUpload } = require('../middleware/fileUpload');
const { rateLimiter } = require('../middleware/rateLimiter');
const { cacheMiddleware } = require('../middleware/cache');

// Apply authentication to all routes
router.use(authenticate);

/**
 * @route   POST /api/meetings
 * @desc    Create a new meeting
 * @access  Private
 */
router.post('/', 
  rateLimiter.createMeeting,
  meetingController.createMeeting
);

/**
 * @route   GET /api/meetings
 * @desc    Get user's meetings with pagination and filters
 * @access  Private
 */
router.get('/',
  rateLimiter.getMeetings,
  cacheMiddleware(300), // Cache for 5 minutes
  meetingController.getMeetings
);

/**
 * @route   GET /api/meetings/stats
 * @desc    Get meeting statistics
 * @access  Private
 */
router.get('/stats',
  rateLimiter.getStats,
  cacheMiddleware(600), // Cache for 10 minutes
  meetingController.getMeetingStats
);

/**
 * @route   GET /api/meetings/search
 * @desc    Search meetings
 * @access  Private
 */
router.get('/search',
  rateLimiter.search,
  meetingController.searchMeetings
);

/**
 * @route   GET /api/meetings/:id
 * @desc    Get meeting by ID
 * @access  Private
 */
router.get('/:id',
  rateLimiter.getMeeting,
  cacheMiddleware(600),
  meetingController.getMeeting
);

/**
 * @route   PUT /api/meetings/:id
 * @desc    Update meeting
 * @access  Private
 */
router.put('/:id',
  rateLimiter.updateMeeting,
  meetingController.updateMeeting
);

/**
 * @route   DELETE /api/meetings/:id
 * @desc    Delete meeting
 * @access  Private
 */
router.delete('/:id',
  rateLimiter.deleteMeeting,
  meetingController.deleteMeeting
);

/**
 * @route   POST /api/meetings/:id/files
 * @desc    Upload files to meeting
 * @access  Private
 */
router.post('/:id/files',
  rateLimiter.uploadFile,
  validateFileUpload({
    maxSize: 100 * 1024 * 1024, // 100MB
    allowedTypes: ['audio/*', 'video/*', 'application/pdf', 'text/*'],
    maxFiles: 10
  }),
  meetingController.uploadFiles
);

/**
 * @route   GET /api/meetings/:id/files
 * @desc    Get meeting files
 * @access  Private
 */
router.get('/:id/files',
  rateLimiter.getFiles,
  cacheMiddleware(300),
  meetingController.getMeetingFiles
);

/**
 * @route   DELETE /api/meetings/:id/files/:fileId
 * @desc    Delete meeting file
 * @access  Private
 */
router.delete('/:id/files/:fileId',
  rateLimiter.deleteFile,
  meetingController.deleteFile
);

/**
 * @route   POST /api/meetings/:id/share
 * @desc    Share meeting with other users
 * @access  Private
 */
router.post('/:id/share',
  rateLimiter.shareMeeting,
  meetingController.shareMeeting
);

/**
 * @route   GET /api/meetings/:id/share
 * @desc    Get meeting sharing settings
 * @access  Private
 */
router.get('/:id/share',
  rateLimiter.getShare,
  meetingController.getSharingSettings
);

/**
 * @route   PUT /api/meetings/:id/share
 * @desc    Update sharing settings
 * @access  Private
 */
router.put('/:id/share',
  rateLimiter.updateShare,
  meetingController.updateSharingSettings
);

/**
 * @route   DELETE /api/meetings/:id/share
 * @desc    Remove sharing
 * @access  Private
 */
router.delete('/:id/share',
  rateLimiter.removeShare,
  meetingController.removeSharingSettings
);

/**
 * @route   POST /api/meetings/:id/duplicate
 * @desc    Duplicate meeting
 * @access  Private
 */
router.post('/:id/duplicate',
  rateLimiter.duplicateMeeting,
  meetingController.duplicateMeeting
);

/**
 * @route   POST /api/meetings/:id/archive
 * @desc    Archive meeting
 * @access  Private
 */
router.post('/:id/archive',
  rateLimiter.archiveMeeting,
  meetingController.archiveMeeting
);

/**
 * @route   POST /api/meetings/:id/restore
 * @desc    Restore archived meeting
 * @access  Private
 */
router.post('/:id/restore',
  rateLimiter.restoreMeeting,
  meetingController.restoreMeeting
);

/**
 * @route   GET /api/meetings/:id/activity
 * @desc    Get meeting activity log
 * @access  Private
 */
router.get('/:id/activity',
  rateLimiter.getActivity,
  cacheMiddleware(300),
  meetingController.getMeetingActivity
);

/**
 * @route   POST /api/meetings/bulk
 * @desc    Bulk operations on meetings
 * @access  Private
 */
router.post('/bulk',
  rateLimiter.bulkOperation,
  meetingController.bulkOperations
);

/**
 * @route   GET /api/meetings/categories
 * @desc    Get available meeting categories
 * @access  Private
 */
router.get('/categories',
  rateLimiter.getCategories,
  cacheMiddleware(3600), // Cache for 1 hour
  meetingController.getCategories
);

/**
 * @route   POST /api/meetings/import
 * @desc    Import meetings from external calendar
 * @access  Private
 */
router.post('/import',
  rateLimiter.importMeetings,
  authorize(['premium', 'enterprise']), // Premium feature
  meetingController.importMeetings
);

module.exports = router;
