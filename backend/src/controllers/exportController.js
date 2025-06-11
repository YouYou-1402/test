// backend/src/controllers/exportController.js
/**
 * Export Controller
 * Handles exporting meetings, transcripts, and summaries in various formats
 */

const Meeting = require('../models/Meeting');
const Transcript = require('../models/Transcript');
const Summary = require('../models/Summary');
const User = require('../models/User');
const { redisConfig } = require('../config/redis');
const { integrationManager } = require('../config/integrations');
const logger = require('../utils/logger');
const { validateRequest } = require('../utils/validation');
const { sendEmail } = require('../utils/email');
const { uploadFile } = require('../utils/fileHandler');
const { 
exportMeetingSchema, 
bulkExportSchema,
scheduleExportSchema 
} = require('../validations/exportValidation');

// Import export utilities
const PDFGenerator = require('../utils/pdfGenerator');
const ExcelGenerator = require('../utils/excelGenerator');
const WordGenerator = require('../utils/wordGenerator');
const ZipGenerator = require('../utils/zipGenerator');

class ExportController {
/**
 * Export single meeting with all data
 * POST /api/exports/meeting
 */
async exportMeeting(req, res) {
  try {
    // Validate request
    const { error, value } = validateRequest(exportMeetingSchema, req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const {
      meetingId,
      format = 'pdf',
      includeTranscript = true,
      includeSummary = true,
      includeFiles = false,
      template = 'standard'
    } = value;
    const userId = req.user.id;

    // Get meeting with all related data
    const meeting = await Meeting.findOne({ _id: meetingId, userId })
      .populate('files')
      .populate('transcript')
      .populate('summaries');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check user's export quota
    const user = await User.findById(userId);
    const currentMonthExports = await this.getMonthlyExportCount(userId);

    if (currentMonthExports >= user.subscription.limits.exportsPerMonth) {
      return res.status(403).json({
        success: false,
        message: 'Monthly export limit exceeded',
        limit: user.subscription.limits.exportsPerMonth,
        current: currentMonthExports
      });
    }

    // Prepare export data
    const exportData = {
      meeting,
      transcript: includeTranscript ? meeting.transcript : null,
      summaries: includeSummary ? meeting.summaries : [],
      files: includeFiles ? meeting.files : [],
      user,
      template,
      exportedAt: new Date()
    };

    let exportResult;
    let mimeType;
    let filename;

    // Generate export based on format
    switch (format.toLowerCase()) {
      case 'pdf':
        exportResult = await this.generatePDFExport(exportData);
        mimeType = 'application/pdf';
        filename = `${meeting.title || 'meeting'}_export.pdf`;
        break;

      case 'word':
        exportResult = await this.generateWordExport(exportData);
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        filename = `${meeting.title || 'meeting'}_export.docx`;
        break;

      case 'excel':
        exportResult = await this.generateExcelExport(exportData);
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        filename = `${meeting.title || 'meeting'}_export.xlsx`;
        break;

      case 'zip':
        exportResult = await this.generateZipExport(exportData);
        mimeType = 'application/zip';
        filename = `${meeting.title || 'meeting'}_export.zip`;
        break;

      case 'json':
        exportResult = await this.generateJSONExport(exportData);
        mimeType = 'application/json';
        filename = `${meeting.title || 'meeting'}_export.json`;
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Unsupported export format'
        });
    }

    // Track export usage
    await this.trackExportUsage(userId, format, exportResult.size);

    // Set response headers
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', exportResult.size);

    // Send file
    res.send(exportResult.buffer);

    // Log export activity
    logger.info('Meeting exported', {
      meetingId,
      userId,
      format,
      filename,
      size: exportResult.size
    });

  } catch (error) {
    logger.error('Error exporting meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export meeting',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Bulk export multiple meetings
 * POST /api/exports/bulk
 */
async bulkExport(req, res) {
  try {
    // Validate request
    const { error, value } = validateRequest(bulkExportSchema, req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const {
      meetingIds,
      format = 'zip',
      includeTranscripts = true,
      includeSummaries = true,
      dateRange,
      filters = {}
    } = value;
    const userId = req.user.id;

    // Build query for meetings
    let query = { userId };

    if (meetingIds && meetingIds.length > 0) {
      query._id = { $in: meetingIds };
    }

    // Apply date range filter
    if (dateRange) {
      query.createdAt = {};
      if (dateRange.startDate) query.createdAt.$gte = new Date(dateRange.startDate);
      if (dateRange.endDate) query.createdAt.$lte = new Date(dateRange.endDate);
    }

    // Apply additional filters
    if (filters.status) query.status = filters.status;
    if (filters.type) query.type = filters.type;
    if (filters.category) query.category = filters.category;

    // Get meetings
    const meetings = await Meeting.find(query)
      .populate('files')
      .populate('transcript')
      .populate('summaries')
      .sort({ createdAt: -1 })
      .limit(100); // Limit to prevent abuse

    if (meetings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No meetings found for export'
      });
    }

    // Check user's export quota
    const user = await User.findById(userId);
    const currentMonthExports = await this.getMonthlyExportCount(userId);

    if (currentMonthExports >= user.subscription.limits.exportsPerMonth) {
      return res.status(403).json({
        success: false,
        message: 'Monthly export limit exceeded'
      });
    }

    // For large exports, process asynchronously
    if (meetings.length > 10) {
      const jobId = await this.scheduleAsyncExport({
        userId,
        meetings,
        format,
        includeTranscripts,
        includeSummaries,
        type: 'bulk'
      });

      return res.json({
        success: true,
        message: 'Bulk export started. You will receive an email when it\'s ready.',
        data: { jobId, estimatedTime: meetings.length * 30 } // 30 seconds per meeting
      });
    }

    // Process synchronously for small exports
    const exportData = {
      meetings,
      includeTranscripts,
      includeSummaries,
      user,
      exportedAt: new Date()
    };

    const exportResult = await this.generateBulkExport(exportData, format);

    // Track export usage
    await this.trackExportUsage(userId, format, exportResult.size);

    // Set response headers
    const filename = `meetings_bulk_export_${new Date().toISOString().split('T')[0]}.${format}`;
    res.setHeader('Content-Type', exportResult.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', exportResult.size);

    // Send file
    res.send(exportResult.buffer);

    logger.info('Bulk export completed', {
      userId,
      meetingCount: meetings.length,
      format,
      size: exportResult.size
    });

  } catch (error) {
    logger.error('Error in bulk export:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export meetings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Schedule export for later processing
 * POST /api/exports/schedule
 */
async scheduleExport(req, res) {
  try {
    // Validate request
    const { error, value } = validateRequest(scheduleExportSchema, req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const {
      type,
      meetingIds,
      format,
      schedule,
      includeTranscripts = true,
      includeSummaries = true,
      emailNotification = true
    } = value;
    const userId = req.user.id;

    // Create export job
    const jobId = `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const jobData = {
      jobId,
      userId,
      type,
      meetingIds,
      format,
      includeTranscripts,
      includeSummaries,
      emailNotification,
      status: 'scheduled',
      createdAt: new Date(),
      scheduledFor: schedule ? new Date(schedule) : new Date()
    };

    // Store job in Redis
    await redisConfig.set(`export-job:${jobId}`, jobData, 86400); // 24 hours

    // Queue job for processing
    if (schedule && new Date(schedule) > new Date()) {
      // Schedule for later
      await redisConfig.zadd('scheduled-exports', new Date(schedule).getTime(), jobId);
    } else {
      // Process immediately
      await redisConfig.lpush('export-queue', jobId);
    }

    res.json({
      success: true,
      message: 'Export scheduled successfully',
      data: {
        jobId,
        scheduledFor: jobData.scheduledFor,
        estimatedCompletion: new Date(Date.now() + (meetingIds?.length || 1) * 30000)
      }
    });

    logger.info('Export scheduled', {
      jobId,
      userId,
      type,
      meetingCount: meetingIds?.length || 0
    });

  } catch (error) {
    logger.error('Error scheduling export:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to schedule export',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Get export job status
 * GET /api/exports/jobs/:jobId/status
 */
async getExportJobStatus(req, res) {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    // Get job data from Redis
    const jobData = await redisConfig.get(`export-job:${jobId}`);

    if (!jobData) {
      return res.status(404).json({
        success: false,
        message: 'Export job not found'
      });
    }

    // Verify job belongs to user
    if (jobData.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: jobData
    });

  } catch (error) {
    logger.error('Error getting export job status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Download completed export
 * GET /api/exports/jobs/:jobId/download
 */
async downloadExport(req, res) {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    // Get job data
    const jobData = await redisConfig.get(`export-job:${jobId}`);

    if (!jobData || jobData.userId !== userId) {
      return res.status(404).json({
        success: false,
        message: 'Export not found'
      });
    }

    if (jobData.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Export is not ready for download',
        status: jobData.status
      });
    }

    // Get file from storage
    const filePath = jobData.outputPath;
    const fileStats = require('fs').statSync(filePath);

    // Set response headers
    res.setHeader('Content-Type', jobData.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${jobData.filename}"`);
    res.setHeader('Content-Length', fileStats.size);

    // Stream file
    const fileStream = require('fs').createReadStream(filePath);
    fileStream.pipe(res);

    // Update download count
    jobData.downloadCount = (jobData.downloadCount || 0) + 1;
    jobData.lastDownloaded = new Date();
    await redisConfig.set(`export-job:${jobId}`, jobData, 86400);

    logger.info('Export downloaded', {
      jobId,
      userId,
      filename: jobData.filename
    });

  } catch (error) {
    logger.error('Error downloading export:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download export',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Get export history
 * GET /api/exports/history
 */
async getExportHistory(req, res) {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, status, format } = req.query;

    // Get export jobs from Redis (in production, store in database)
    const pattern = `export-job:*`;
    // This is a simplified implementation
    // In production, you'd store export history in database

    const mockHistory = [
      {
        jobId: 'export_123',
        type: 'single',
        format: 'pdf',
        status: 'completed',
        createdAt: new Date(),
        filename: 'meeting_export.pdf',
        size: 1024000
      }
    ];

    res.json({
      success: true,
      data: {
        exports: mockHistory,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: mockHistory.length,
          pages: 1
        }
      }
    });

  } catch (error) {
    logger.error('Error getting export history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get export history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Export to cloud storage
 * POST /api/exports/cloud
 */
async exportToCloud(req, res) {
  try {
    const {
      meetingId,
      format = 'pdf',
      destination = 'drive', // drive, dropbox, onedrive
      folder = 'Meeting Exports'
    } = req.body;
    const userId = req.user.id;

    // Check if cloud integration is enabled
    const cloudConfig = integrationManager.getIntegrationConfig('cloudStorage');
    if (!cloudConfig.enabled || !cloudConfig[destination]?.enabled) {
      return res.status(400).json({
        success: false,
        message: `${destination} integration is not enabled`
      });
    }

    // Generate export
    const meeting = await Meeting.findOne({ _id: meetingId, userId })
      .populate('files transcript summaries');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    const exportData = {
      meeting,
      transcript: meeting.transcript,
      summaries: meeting.summaries,
      user: await User.findById(userId),
      exportedAt: new Date()
    };

    const exportResult = await this.generatePDFExport(exportData);

    // Upload to cloud storage
    const uploadResult = await this.uploadToCloudStorage(
      destination,
      exportResult.buffer,
      `${meeting.title || 'meeting'}_export.${format}`,
      folder,
      userId
    );

    res.json({
      success: true,
      message: `Export uploaded to ${destination} successfully`,
      data: {
        cloudUrl: uploadResult.url,
        filename: uploadResult.filename,
        size: exportResult.size
      }
    });

  } catch (error) {
    logger.error('Error exporting to cloud:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export to cloud storage',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Private helper methods

/**
 * Generate PDF export
 */
async generatePDFExport(exportData) {
  const pdfGenerator = new PDFGenerator();
  return await pdfGenerator.generateMeetingReport(exportData);
}

/**
 * Generate Word export
 */
async generateWordExport(exportData) {
  const wordGenerator = new WordGenerator();
  return await wordGenerator.generateMeetingReport(exportData);
}

/**
 * Generate Excel export
 */
async generateExcelExport(exportData) {
  const excelGenerator = new ExcelGenerator();
  return await excelGenerator.generateMeetingReport(exportData);
}

/**
 * Generate ZIP export
 */
async generateZipExport(exportData) {
  const zipGenerator = new ZipGenerator();
  return await zipGenerator.generateMeetingArchive(exportData);
}

/**
 * Generate JSON export
 */
async generateJSONExport(exportData) {
  const jsonData = {
    meeting: exportData.meeting.toObject(),
    transcript: exportData.transcript?.toObject(),
    summaries: exportData.summaries.map(s => s.toObject()),
    exportedAt: exportData.exportedAt,
    exportedBy: {
      id: exportData.user._id,
      name: exportData.user.name,
      email: exportData.user.email
    }
  };

  const buffer = Buffer.from(JSON.stringify(jsonData, null, 2));
  return {
    buffer,
    size: buffer.length,
    mimeType: 'application/json'
  };
}

/**
 * Generate bulk export
 */
async generateBulkExport(exportData, format) {
  switch (format) {
    case 'zip':
      const zipGenerator = new ZipGenerator();
      return await zipGenerator.generateBulkArchive(exportData);
    
    case 'excel':
      const excelGenerator = new ExcelGenerator();
      return await excelGenerator.generateBulkReport(exportData);
    
    default:
      throw new Error(`Bulk export format ${format} not supported`);
  }
}

/**
 * Schedule async export
 */
async scheduleAsyncExport(exportData) {
  const jobId = `async_export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const jobData = {
    ...exportData,
    jobId,
    status: 'queued',
    createdAt: new Date()
  };

  // Store job data
  await redisConfig.set(`export-job:${jobId}`, jobData, 86400);
  
  // Queue for processing
  await redisConfig.lpush('async-export-queue', jobId);

  return jobId;
}

/**
 * Get monthly export count
 */
async getMonthlyExportCount(userId) {
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  
  // In production, this would query a database
  // For now, return from Redis counter
  const key = `export-count:${userId}:${startOfMonth.getTime()}`;
  const count = await redisConfig.get(key);
  return parseInt(count) || 0;
}

/**
 * Track export usage
 */
async trackExportUsage(userId, format, size) {
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const key = `export-count:${userId}:${startOfMonth.getTime()}`;
  
  // Increment counter
  await redisConfig.incr(key);
  await redisConfig.expire(key, 86400 * 32); // Expire after month + buffer

  // Track usage stats
  const statsKey = `export-stats:${userId}`;
  const stats = await redisConfig.get(statsKey) || {
    totalExports: 0,
    totalSize: 0,
    byFormat: {}
  };

  stats.totalExports++;
  stats.totalSize += size;
  stats.byFormat[format] = (stats.byFormat[format] || 0) + 1;

  await redisConfig.set(statsKey, stats, 86400 * 30);
}

/**
 * Upload to cloud storage
 */
async uploadToCloudStorage(destination, buffer, filename, folder, userId) {
  // Implementation would depend on the cloud storage service
  // This is a placeholder
  
  switch (destination) {
    case 'drive':
      // Google Drive upload implementation
      break;
    case 'dropbox':
      // Dropbox upload implementation
      break;
    case 'onedrive':
      // OneDrive upload implementation
      break;
    default:
      throw new Error(`Unsupported cloud storage: ${destination}`);
  }

  // Mock response
  return {
    url: `https://${destination}.com/file/${filename}`,
    filename,
    folder
  };
}
}

module.exports = new ExportController();