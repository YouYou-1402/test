// backend/src/controllers/meetingController.js
/**
 * Meeting Controller
 * Handles meeting CRUD operations and related functionality
 */

const Meeting = require('../models/Meeting');
const File = require('../models/File');
const User = require('../models/User');
const { redisConfig } = require('../config/redis');
const { aiServiceManager } = require('../config/ai-services');
const { integrationManager } = require('../config/integrations');
const logger = require('../utils/logger');
const { validateRequest } = require('../utils/validation');
const { paginate } = require('../utils/pagination');
const { uploadFile, deleteFile } = require('../utils/fileHandler');
const { sendEmail } = require('../utils/email');
const { createMeetingSchema, updateMeetingSchema } = require('../validations/meetingValidation');

class MeetingController {
/**
 * Create a new meeting
 * POST /api/meetings
 */
async createMeeting(req, res) {
  try {
    // Validate request
    const { error, value } = validateRequest(createMeetingSchema, req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const userId = req.user.id;
    const meetingData = {
      ...value,
      userId,
      status: 'created',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Check user's meeting quota
    const user = await User.findById(userId);
    const currentMonthMeetings = await Meeting.countDocuments({
      userId,
      createdAt: {
        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      }
    });

    if (currentMonthMeetings >= user.subscription.limits.meetingsPerMonth) {
      return res.status(403).json({
        success: false,
        message: 'Monthly meeting limit exceeded',
        limit: user.subscription.limits.meetingsPerMonth,
        current: currentMonthMeetings
      });
    }

    // Create meeting
    const meeting = new Meeting(meetingData);
    await meeting.save();

    // Cache meeting data
    await redisConfig.set(`meeting:${meeting._id}`, meeting, 3600);

    // Log activity
    logger.info('Meeting created', {
      meetingId: meeting._id,
      userId,
      title: meeting.title,
      type: meeting.type
    });

    // Send response
    res.status(201).json({
      success: true,
      message: 'Meeting created successfully',
      data: {
        meeting: meeting.toObject()
      }
    });

    // Async operations
    this.handlePostCreationTasks(meeting, user);

  } catch (error) {
    logger.error('Error creating meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create meeting',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Get meetings list with filtering and pagination
 * GET /api/meetings
 */
async getMeetings(req, res) {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      status,
      type,
      category,
      search,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = { userId };

    // Apply filters
    if (status) query.status = status;
    if (type) query.type = type;
    if (category) query.category = category;

    // Date range filter
    if (startDate || endDate) {
      query.meetingDate = {};
      if (startDate) query.meetingDate.$gte = new Date(startDate);
      if (endDate) query.meetingDate.$lte = new Date(endDate);
    }

    // Search filter
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Get cached results if available
    const cacheKey = `meetings:${userId}:${JSON.stringify(query)}:${page}:${limit}:${sortBy}:${sortOrder}`;
    const cached = await redisConfig.get(cacheKey);
    
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        cached: true
      });
    }

    // Execute query with pagination
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 },
      populate: [
        { path: 'files', select: 'name type size status uploadDate' },
        { path: 'transcript', select: 'status language duration wordCount' },
        { path: 'summaries', select: 'type status createdAt' }
      ]
    };

    const result = await paginate(Meeting, query, options);

    // Cache results
    await redisConfig.set(cacheKey, result, 300); // 5 minutes

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Error getting meetings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get meetings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Get meeting by ID
 * GET /api/meetings/:id
 */
async getMeetingById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check cache first
    const cached = await redisConfig.get(`meeting:${id}`);
    if (cached && cached.userId.toString() === userId) {
      return res.json({
        success: true,
        data: { meeting: cached },
        cached: true
      });
    }

    // Get from database
    const meeting = await Meeting.findOne({ _id: id, userId })
      .populate('files')
      .populate('transcript')
      .populate('summaries')
      .populate('sharedWith.user', 'name email');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Update cache
    await redisConfig.set(`meeting:${id}`, meeting, 3600);

    // Update last accessed
    meeting.lastAccessed = new Date();
    await meeting.save();

    res.json({
      success: true,
      data: { meeting }
    });

  } catch (error) {
    logger.error('Error getting meeting by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get meeting',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Update meeting
 * PUT /api/meetings/:id
 */
async updateMeeting(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Validate request
    const { error, value } = validateRequest(updateMeetingSchema, req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    // Find and update meeting
    const meeting = await Meeting.findOneAndUpdate(
      { _id: id, userId },
      {
        ...value,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    ).populate('files transcript summaries');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Update cache
    await redisConfig.set(`meeting:${id}`, meeting, 3600);
    
    // Clear related caches
    await this.clearMeetingCaches(userId);

    logger.info('Meeting updated', {
      meetingId: id,
      userId,
      changes: Object.keys(value)
    });

    res.json({
      success: true,
      message: 'Meeting updated successfully',
      data: { meeting }
    });

  } catch (error) {
    logger.error('Error updating meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update meeting',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Delete meeting
 * DELETE /api/meetings/:id
 */
async deleteMeeting(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { permanent = false } = req.query;

    const meeting = await Meeting.findOne({ _id: id, userId });
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    if (permanent) {
      // Permanent deletion
      await this.permanentlyDeleteMeeting(meeting);
      
      res.json({
        success: true,
        message: 'Meeting permanently deleted'
      });
    } else {
      // Soft deletion
      meeting.deletedAt = new Date();
      meeting.status = 'deleted';
      await meeting.save();

      res.json({
        success: true,
        message: 'Meeting moved to trash'
      });
    }

    // Clear caches
    await redisConfig.del(`meeting:${id}`);
    await this.clearMeetingCaches(userId);

    logger.info('Meeting deleted', {
      meetingId: id,
      userId,
      permanent
    });

  } catch (error) {
    logger.error('Error deleting meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete meeting',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Upload meeting file
 * POST /api/meetings/:id/upload
 */
async uploadMeetingFile(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const meeting = await Meeting.findOne({ _id: id, userId });
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check file upload limits
    const user = await User.findById(userId);
    const currentStorageUsed = await File.aggregate([
      { $match: { userId: userId } },
      { $group: { _id: null, totalSize: { $sum: '$size' } } }
    ]);

    const totalSize = currentStorageUsed[0]?.totalSize || 0;
    if (totalSize >= user.subscription.limits.storageLimit) {
      return res.status(403).json({
        success: false,
        message: 'Storage limit exceeded'
      });
    }

    // Upload file
    const uploadResult = await uploadFile(req, {
      allowedTypes: ['audio', 'video'],
      maxSize: user.subscription.limits.maxFileSize,
      destination: `meetings/${id}`
    });

    if (!uploadResult.success) {
      return res.status(400).json(uploadResult);
    }

    // Create file record
    const file = new File({
      name: uploadResult.data.originalName,
      filename: uploadResult.data.filename,
      path: uploadResult.data.path,
      size: uploadResult.data.size,
      type: uploadResult.data.type,
      mimeType: uploadResult.data.mimeType,
      userId,
      meetingId: id,
      status: 'uploaded'
    });

    await file.save();

    // Update meeting
    meeting.files.push(file._id);
    meeting.status = 'uploaded';
    meeting.updatedAt = new Date();
    await meeting.save();

    // Update cache
    await redisConfig.del(`meeting:${id}`);

    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: { file }
    });

    // Start transcription process
    this.initiateTranscription(meeting, file);

  } catch (error) {
    logger.error('Error uploading meeting file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Share meeting
 * POST /api/meetings/:id/share
 */
async shareMeeting(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { emails, permission = 'view', message } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Email addresses are required'
      });
    }

    const meeting = await Meeting.findOne({ _id: id, userId });
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Find or create users for shared emails
    const sharedUsers = [];
    for (const email of emails) {
      let user = await User.findOne({ email });
      if (!user) {
        // Create guest user
        user = new User({
          email,
          name: email.split('@')[0],
          role: 'guest',
          isGuest: true
        });
        await user.save();
      }
      sharedUsers.push(user);
    }

    // Update meeting sharing
    const newShares = sharedUsers.map(user => ({
      user: user._id,
      permission,
      sharedAt: new Date(),
      sharedBy: userId
    }));

    meeting.sharedWith.push(...newShares);
    meeting.privacy.level = 'shared';
    await meeting.save();

    // Send notification emails
    for (const user of sharedUsers) {
      await sendEmail({
        to: user.email,
        template: 'shareInvitation',
        data: {
          meetingTitle: meeting.title,
          sharedBy: req.user.name,
          message,
          meetingUrl: `${process.env.FRONTEND_URL}/meetings/${id}`,
          permission
        }
      });
    }

    res.json({
      success: true,
      message: 'Meeting shared successfully',
      data: {
        sharedWith: newShares.length,
        emails: emails
      }
    });

  } catch (error) {
    logger.error('Error sharing meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share meeting',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Get meeting statistics
 * GET /api/meetings/stats
 */
async getMeetingStats(req, res) {
  try {
    const userId = req.user.id;
    const { period = '30d' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Check cache
    const cacheKey = `meeting-stats:${userId}:${period}`;
    const cached = await redisConfig.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        cached: true
      });
    }

    // Aggregate statistics
    const stats = await Meeting.aggregate([
      {
        $match: {
          userId: userId,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalMeetings: { $sum: 1 },
          completedMeetings: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          totalDuration: { $sum: '$duration' },
          avgDuration: { $avg: '$duration' },
          byType: {
            $push: {
              type: '$type',
              status: '$status'
            }
          },
          byCategory: {
            $push: {
              category: '$category'
            }
          }
        }
      }
    ]);

    const result = stats[0] || {
      totalMeetings: 0,
      completedMeetings: 0,
      totalDuration: 0,
      avgDuration: 0,
      byType: [],
      byCategory: []
    };

    // Process type and category statistics
    const typeStats = {};
    const categoryStats = {};

    result.byType.forEach(item => {
      if (!typeStats[item.type]) {
        typeStats[item.type] = { total: 0, completed: 0 };
      }
      typeStats[item.type].total++;
      if (item.status === 'completed') {
        typeStats[item.type].completed++;
      }
    });

    result.byCategory.forEach(item => {
      if (item.category) {
        categoryStats[item.category] = (categoryStats[item.category] || 0) + 1;
      }
    });

    const finalStats = {
      period,
      totalMeetings: result.totalMeetings,
      completedMeetings: result.completedMeetings,
      completionRate: result.totalMeetings > 0 ? 
        (result.completedMeetings / result.totalMeetings * 100).toFixed(1) : 0,
      totalDuration: result.totalDuration,
      avgDuration: Math.round(result.avgDuration || 0),
      byType: typeStats,
      byCategory: categoryStats
    };

    // Cache for 1 hour
    await redisConfig.set(cacheKey, finalStats, 3600);

    res.json({
      success: true,
      data: finalStats
    });

  } catch (error) {
    logger.error('Error getting meeting stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get meeting statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Search meetings
 * GET /api/meetings/search
 */
async searchMeetings(req, res) {
  try {
    const userId = req.user.id;
    const { q, type, category, limit = 10 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    // Build search query
    const searchQuery = {
      userId,
      deletedAt: { $exists: false },
      $or: [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { tags: { $in: [new RegExp(q, 'i')] } }
      ]
    };

    if (type) searchQuery.type = type;
    if (category) searchQuery.category = category;

    // Execute search
    const meetings = await Meeting.find(searchQuery)
      .select('title description type category status createdAt duration')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: {
        meetings,
        total: meetings.length,
        query: q
      }
    });

  } catch (error) {
    logger.error('Error searching meetings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search meetings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Private helper methods

/**
 * Handle post-creation tasks
 */
async handlePostCreationTasks(meeting, user) {
  try {
    // Send welcome email for first meeting
    const meetingCount = await Meeting.countDocuments({ userId: user._id });
    if (meetingCount === 1) {
      await sendEmail({
        to: user.email,
        template: 'firstMeeting',
        data: {
          userName: user.name,
          meetingTitle: meeting.title
        }
      });
    }

    // Sync with calendar if enabled
    if (integrationManager.getConnectionStatus('calendar')?.status === 'connected') {
      // Implementation for calendar sync
    }

  } catch (error) {
    logger.error('Error in post-creation tasks:', error);
  }
}

/**
 * Permanently delete meeting and associated data
 */
async permanentlyDeleteMeeting(meeting) {
  try {
    // Delete associated files
    const files = await File.find({ meetingId: meeting._id });
    for (const file of files) {
      await deleteFile(file.path);
      await file.deleteOne();
    }

    // Delete transcript and summaries
    if (meeting.transcript) {
      await meeting.transcript.deleteOne();
    }

    for (const summaryId of meeting.summaries) {
      const Summary = require('../models/Summary');
      await Summary.findByIdAndDelete(summaryId);
    }

    // Delete meeting
    await meeting.deleteOne();

  } catch (error) {
    logger.error('Error permanently deleting meeting:', error);
    throw error;
  }
}

/**
 * Clear meeting-related caches
 */
async clearMeetingCaches(userId) {
  try {
    // Get all cache keys for this user's meetings
    const pattern = `meetings:${userId}:*`;
    // Note: In production, you might want to use a more efficient cache invalidation strategy
    
    // For now, we'll clear the stats cache
    await redisConfig.del(`meeting-stats:${userId}:7d`);
    await redisConfig.del(`meeting-stats:${userId}:30d`);
    await redisConfig.del(`meeting-stats:${userId}:90d`);

  } catch (error) {
    logger.error('Error clearing meeting caches:', error);
  }
}

/**
 * Initiate transcription process
 */
async initiateTranscription(meeting, file) {
  try {
    // Get best STT service
    const sttService = aiServiceManager.getBestSTTService(
      meeting.language || 'auto',
      file.size,
      meeting.duration
    );

    // Queue transcription job
    await redisConfig.lpush('transcription-queue', {
      meetingId: meeting._id,
      fileId: file._id,
      service: sttService,
      priority: meeting.priority || 'normal',
      createdAt: new Date()
    });

    // Update meeting status
    meeting.status = 'processing';
    await meeting.save();

    logger.info('Transcription queued', {
      meetingId: meeting._id,
      fileId: file._id,
      service: sttService
    });

  } catch (error) {
    logger.error('Error initiating transcription:', error);
  }
}
}

module.exports = new MeetingController();