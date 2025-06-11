// backend/src/controllers/summaryController.js
/**
 * Summary Controller
 * Handles meeting summary generation and management
 */

const Summary = require('../models/Summary');
const Meeting = require('../models/Meeting');
const Transcript = require('../models/Transcript');
const User = require('../models/User');
const { redisConfig } = require('../config/redis');
const { aiServiceManager } = require('../config/ai-services');
const logger = require('../utils/logger');
const { validateRequest } = require('../utils/validation');
const { paginate } = require('../utils/pagination');
const { sendEmail } = require('../utils/email');
const { 
generateSummarySchema, 
updateSummarySchema,
customSummarySchema 
} = require('../validations/summaryValidation');

class SummaryController {
/**
 * Generate meeting summary
 * POST /api/summaries/generate
 */
async generateSummary(req, res) {
  try {
    // Validate request
    const { error, value } = validateRequest(generateSummarySchema, req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { 
      meetingId, 
      type = 'standard', 
      language = 'auto', 
      customPrompt,
      includeActionItems = true,
      includeKeyTopics = true,
      includeParticipants = true
    } = value;
    const userId = req.user.id;

    // Verify meeting ownership
    const meeting = await Meeting.findOne({ _id: meetingId, userId })
      .populate('transcript');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check if transcript exists and is completed
    if (!meeting.transcript || meeting.transcript.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Meeting transcript is not available or not completed'
      });
    }

    // Check user's summary quota
    const user = await User.findById(userId);
    const currentMonthSummaries = await Summary.countDocuments({
        userId,
        createdAt: {
          $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        }
      });

      if (currentMonthSummaries >= user.subscription.limits.summariesPerMonth) {
        return res.status(403).json({
          success: false,
          message: 'Monthly summary limit exceeded',
          limit: user.subscription.limits.summariesPerMonth,
          current: currentMonthSummaries
        });
      }

      // Check if summary already exists for this type
      const existingSummary = await Summary.findOne({ 
        meetingId, 
        type,
        status: { $in: ['processing', 'completed'] }
      });

      if (existingSummary) {
        return res.status(409).json({
          success: false,
          message: 'Summary already exists or is being generated',
          data: { summary: existingSummary }
        });
      }

      // Determine best LLM service
      const transcriptLength = meeting.transcript.text.length;
      const selectedService = aiServiceManager.getBestLLMService('summary', transcriptLength);

      // Create summary record
      const summary = new Summary({
        meetingId,
        userId,
        transcriptId: meeting.transcript._id,
        type,
        language,
        status: 'processing',
        settings: {
          includeActionItems,
          includeKeyTopics,
          includeParticipants,
          customPrompt
        },
        service: selectedService,
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await summary.save();

      // Update meeting
      meeting.summaries.push(summary._id);
      meeting.updatedAt = new Date();
      await meeting.save();

      // Queue summary generation job
      const jobData = {
        summaryId: summary._id,
        meetingId,
        transcriptId: meeting.transcript._id,
        type,
        language,
        service: selectedService,
        settings: summary.settings,
        userId,
        priority: meeting.priority || 'normal',
        createdAt: new Date()
      };

      await redisConfig.lpush('summary-queue', jobData);

      // Cache summary data
      await redisConfig.set(`summary:${summary._id}`, summary, 3600);

      logger.info('Summary generation started', {
        summaryId: summary._id,
        meetingId,
        type,
        service: selectedService
      });

      res.json({
        success: true,
        message: 'Summary generation started successfully',
        data: { summary }
      });

      // Start processing
      this.processSummaryJob(jobData);

    } catch (error) {
      logger.error('Error generating summary:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate summary',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get summary by ID
   * GET /api/summaries/:id
   */
  async getSummary(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Check cache first
      const cached = await redisConfig.get(`summary:${id}`);
      if (cached && cached.userId.toString() === userId) {
        return res.json({
          success: true,
          data: { summary: cached },
          cached: true
        });
      }

      // Get from database
      const summary = await Summary.findOne({ _id: id, userId })
        .populate('meetingId', 'title type category duration')
        .populate('transcriptId', 'language wordCount duration');

      if (!summary) {
        return res.status(404).json({
          success: false,
          message: 'Summary not found'
        });
      }

      // Update cache
      await redisConfig.set(`summary:${id}`, summary, 3600);

      res.json({
        success: true,
        data: { summary }
      });

    } catch (error) {
      logger.error('Error getting summary:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get summary',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get summaries list
   * GET /api/summaries
   */
  async getSummaries(req, res) {
    try {
      const userId = req.user.id;
      const {
        page = 1,
        limit = 20,
        status,
        type,
        meetingId,
        search,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      // Build query
      const query = { userId };

      if (status) query.status = status;
      if (type) query.type = type;
      if (meetingId) query.meetingId = meetingId;

      // Search in summary content
      if (search) {
        query.$or = [
          { 'content.overview': { $regex: search, $options: 'i' } },
          { 'content.keyPoints': { $regex: search, $options: 'i' } },
          { 'content.actionItems.description': { $regex: search, $options: 'i' } }
        ];
      }

      // Check cache
      const cacheKey = `summaries:${userId}:${JSON.stringify(query)}:${page}:${limit}`;
      const cached = await redisConfig.get(cacheKey);
      
      if (cached) {
        return res.json({
          success: true,
          data: cached,
          cached: true
        });
      }

      // Execute query
      const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 },
        populate: [
          { path: 'meetingId', select: 'title type category duration' },
          { path: 'transcriptId', select: 'language wordCount duration' }
        ]
      };

      const result = await paginate(Summary, query, options);

      // Cache results
      await redisConfig.set(cacheKey, result, 300);

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Error getting summaries:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get summaries',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Update summary
   * PUT /api/summaries/:id
   */
  async updateSummary(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Validate request
      const { error, value } = validateRequest(updateSummarySchema, req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
      }

      // Find summary
      const summary = await Summary.findOne({ _id: id, userId });
      if (!summary) {
        return res.status(404).json({
          success: false,
          message: 'Summary not found'
        });
      }

      // Update summary
      Object.assign(summary, value);
      summary.updatedAt = new Date();
      summary.editedAt = new Date();
      summary.editedBy = userId;

      await summary.save();

      // Update cache
      await redisConfig.set(`summary:${id}`, summary, 3600);

      // Clear related caches
      await this.clearSummaryCaches(userId);

      logger.info('Summary updated', {
        summaryId: id,
        userId,
        changes: Object.keys(value)
      });

      res.json({
        success: true,
        message: 'Summary updated successfully',
        data: { summary }
      });

    } catch (error) {
      logger.error('Error updating summary:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update summary',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Delete summary
   * DELETE /api/summaries/:id
   */
  async deleteSummary(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const summary = await Summary.findOne({ _id: id, userId });
      if (!summary) {
        return res.status(404).json({
          success: false,
          message: 'Summary not found'
        });
      }

      // Remove from meeting's summaries array
      await Meeting.findByIdAndUpdate(summary.meetingId, {
        $pull: { summaries: summary._id },
        updatedAt: new Date()
      });

      // Delete summary
      await summary.deleteOne();

      // Clear caches
      await redisConfig.del(`summary:${id}`);
      await this.clearSummaryCaches(userId);

      logger.info('Summary deleted', {
        summaryId: id,
        userId
      });

      res.json({
        success: true,
        message: 'Summary deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting summary:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete summary',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Generate custom summary with specific prompt
   * POST /api/summaries/custom
   */
  async generateCustomSummary(req, res) {
    try {
      // Validate request
      const { error, value } = validateRequest(customSummarySchema, req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
      }

      const { meetingId, prompt, language = 'auto', maxLength = 500 } = value;
      const userId = req.user.id;

      // Verify meeting and transcript
      const meeting = await Meeting.findOne({ _id: meetingId, userId })
        .populate('transcript');

      if (!meeting || !meeting.transcript || meeting.transcript.status !== 'completed') {
        return res.status(400).json({
          success: false,
          message: 'Meeting transcript is not available'
        });
      }

      // Check user quota
      const user = await User.findById(userId);
      const currentMonthSummaries = await Summary.countDocuments({
        userId,
        createdAt: {
          $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        }
      });

      if (currentMonthSummaries >= user.subscription.limits.summariesPerMonth) {
        return res.status(403).json({
          success: false,
          message: 'Monthly summary limit exceeded'
        });
      }

      // Generate custom summary
      const selectedService = aiServiceManager.getBestLLMService('summary', meeting.transcript.text.length);
      
      const summary = new Summary({
        meetingId,
        userId,
        transcriptId: meeting.transcript._id,
        type: 'custom',
        language,
        status: 'processing',
        settings: {
          customPrompt: prompt,
          maxLength
        },
        service: selectedService,
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await summary.save();

      // Process immediately for custom summaries
      const result = await this.generateCustomSummaryContent(
        meeting.transcript.text,
        prompt,
        selectedService,
        { language, maxLength }
      );

      // Update summary with result
      summary.content = result.content;
      summary.metadata = result.metadata;
      summary.status = 'completed';
      summary.completedAt = new Date();
      summary.updatedAt = new Date();

      await summary.save();

      res.json({
        success: true,
        message: 'Custom summary generated successfully',
        data: { summary }
      });

    } catch (error) {
      logger.error('Error generating custom summary:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate custom summary',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get summary templates
   * GET /api/summaries/templates
   */
  async getSummaryTemplates(req, res) {
    try {
      const templates = [
        {
          id: 'standard',
          name: 'Standard Summary',
          description: 'Comprehensive overview with key points and action items',
          prompt: 'Provide a comprehensive summary of this meeting including key points discussed, decisions made, and action items.',
          settings: {
            includeActionItems: true,
            includeKeyTopics: true,
            includeParticipants: true
          }
        },
        {
          id: 'executive',
          name: 'Executive Summary',
          description: 'High-level overview for executives',
          prompt: 'Create an executive summary focusing on strategic decisions, key outcomes, and business impact.',
          settings: {
            includeActionItems: true,
            includeKeyTopics: true,
            includeParticipants: false
          }
        },
        {
          id: 'action_focused',
          name: 'Action-Focused',
          description: 'Emphasis on action items and next steps',
          prompt: 'Focus on action items, responsibilities, deadlines, and next steps from this meeting.',
          settings: {
            includeActionItems: true,
            includeKeyTopics: false,
            includeParticipants: true
          }
        },
        {
          id: 'technical',
          name: 'Technical Summary',
          description: 'Detailed technical discussion summary',
          prompt: 'Summarize the technical aspects discussed, including solutions, technical decisions, and implementation details.',
          settings: {
            includeActionItems: true,
            includeKeyTopics: true,
            includeParticipants: true
          }
        },
        {
          id: 'brief',
          name: 'Brief Summary',
          description: 'Concise overview in bullet points',
          prompt: 'Provide a brief, bullet-point summary of the main topics and outcomes.',
          settings: {
            includeActionItems: false,
            includeKeyTopics: true,
            includeParticipants: false
          }
        }
      ];

      res.json({
        success: true,
        data: { templates }
      });

    } catch (error) {
      logger.error('Error getting summary templates:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get summary templates',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get summary statistics
   * GET /api/summaries/stats
   */
  async getSummaryStats(req, res) {
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
      const cacheKey = `summary-stats:${userId}:${period}`;
      const cached = await redisConfig.get(cacheKey);
      if (cached) {
        return res.json({
          success: true,
          data: cached,
          cached: true
        });
      }

      // Aggregate statistics
      const stats = await Summary.aggregate([
        {
          $match: {
            userId: userId,
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            totalSummaries: { $sum: 1 },
            completedSummaries: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
            },
            byType: {
              $push: {
                type: '$type',
                status: '$status'
              }
            },
            byService: {
              $push: {
                service: '$service'
              }
            }
          }
        }
      ]);

      const result = stats[0] || {
        totalSummaries: 0,
        completedSummaries: 0,
        byType: [],
        byService: []
      };

      // Process type and service statistics
      const typeStats = {};
      const serviceStats = {};

      result.byType.forEach(item => {
        if (!typeStats[item.type]) {
          typeStats[item.type] = { total: 0, completed: 0 };
        }
        typeStats[item.type].total++;
        if (item.status === 'completed') {
          typeStats[item.type].completed++;
        }
      });

      result.byService.forEach(item => {
        if (item.service) {
          serviceStats[item.service] = (serviceStats[item.service] || 0) + 1;
        }
      });

      const finalStats = {
        period,
        totalSummaries: result.totalSummaries,
        completedSummaries: result.completedSummaries,
        completionRate: result.totalSummaries > 0 ? 
          (result.completedSummaries / result.totalSummaries * 100).toFixed(1) : 0,
        byType: typeStats,
        byService: serviceStats
      };

      // Cache for 1 hour
      await redisConfig.set(cacheKey, finalStats, 3600);

      res.json({
        success: true,
        data: finalStats
      });

    } catch (error) {
      logger.error('Error getting summary stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get summary statistics',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Export summary in various formats
   * GET /api/summaries/:id/export
   */
  async exportSummary(req, res) {
    try {
      const { id } = req.params;
      const { format = 'txt' } = req.query;
      const userId = req.user.id;

      const summary = await Summary.findOne({ _id: id, userId })
        .populate('meetingId', 'title createdAt');

      if (!summary) {
        return res.status(404).json({
          success: false,
          message: 'Summary not found'
        });
      }

      if (summary.status !== 'completed') {
        return res.status(400).json({
          success: false,
          message: 'Summary is not completed yet'
        });
      }

      let content;
      let mimeType;
      let filename;

      switch (format.toLowerCase()) {
        case 'txt':
          content = this.exportToText(summary);
          mimeType = 'text/plain';
          filename = `${summary.meetingId.title || 'summary'}_summary.txt`;
          break;

        case 'md':
          content = this.exportToMarkdown(summary);
          mimeType = 'text/markdown';
          filename = `${summary.meetingId.title || 'summary'}_summary.md`;
          break;

        case 'json':
          content = JSON.stringify(summary.content, null, 2);
          mimeType = 'application/json';
          filename = `${summary.meetingId.title || 'summary'}_summary.json`;
          break;

        case 'pdf':
          content = await this.exportToPDF(summary);
          mimeType = 'application/pdf';
          filename = `${summary.meetingId.title || 'summary'}_summary.pdf`;
          break;

        default:
          return res.status(400).json({
            success: false,
            message: 'Unsupported export format'
          });
      }

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);

      // Log export activity
      logger.info('Summary exported', {
        summaryId: id,
        userId,
        format,
        filename
      });

    } catch (error) {
      logger.error('Error exporting summary:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export summary',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Private helper methods

  /**
   * Process summary generation job
   */
  async processSummaryJob(jobData) {
    const { summaryId, transcriptId, type, service, settings } = jobData;

    try {
      // Update job status
      await redisConfig.set(`summary-job:${summaryId}`, {
        ...jobData,
        status: 'processing',
        startedAt: new Date()
      }, 7200);

      // Get transcript content
      const transcript = await Transcript.findById(transcriptId);
      if (!transcript) {
        throw new Error('Transcript not found');
      }

      // Generate summary based on type
      let summaryContent;
      switch (type) {
        case 'standard':
          summaryContent = await this.generateStandardSummary(transcript, service, settings);
          break;
        case 'executive':
          summaryContent = await this.generateExecutiveSummary(transcript, service, settings);
          break;
        case 'action_focused':
          summaryContent = await this.generateActionFocusedSummary(transcript, service, settings);
          break;
        case 'technical':
          summaryContent = await this.generateTechnicalSummary(transcript, service, settings);
          break;
        case 'brief':
          summaryContent = await this.generateBriefSummary(transcript, service, settings);
          break;
        default:
          summaryContent = await this.generateStandardSummary(transcript, service, settings);
      }

      // Update summary with results
      const summary = await Summary.findById(summaryId);
      summary.content = summaryContent.content;
      summary.metadata = summaryContent.metadata;
      summary.status = 'completed';
      summary.completedAt = new Date();
      summary.updatedAt = new Date();

      await summary.save();

      // Update cache
      await redisConfig.set(`summary:${summaryId}`, summary, 3600);

      // Update job status
      await redisConfig.set(`summary-job:${summaryId}`, {
        ...jobData,
        status: 'completed',
        completedAt: new Date()
      }, 7200);

      // Update service usage stats
      aiServiceManager.updateUsageStats(service, 'llm', {
        requests: 1,
        tokens: summaryContent.metadata.tokensUsed || 0,
        cost: this.calculateSummaryCost(service, summaryContent.metadata.tokensUsed || 0)
      });

      logger.info('Summary generation completed', {
        summaryId,
        type,
        service,
        tokensUsed: summaryContent.metadata.tokensUsed
      });

      // Send notification
      await this.sendSummaryCompleteNotification(summary);

    } catch (error) {
      logger.error('Summary generation failed:', error);

      // Update summary status
      await Summary.findByIdAndUpdate(summaryId, {
        status: 'failed',
        error: error.message,
        updatedAt: new Date()
      });

      // Update job status
      await redisConfig.set(`summary-job:${summaryId}`, {
        ...jobData,
        status: 'failed',
        error: error.message,
        failedAt: new Date()
      }, 7200);
    }
  }

  /**
   * Generate standard summary
   */
  async generateStandardSummary(transcript, service, settings) {
    // Implementation would call the appropriate LLM service
    // This is a placeholder structure
    return {
      content: {
        overview: "Meeting overview...",
        keyPoints: ["Key point 1", "Key point 2"],
        actionItems: [
          {
            description: "Action item 1",
            assignee: "John Doe",
            dueDate: "2024-01-15"
          }
        ],
        participants: ["John Doe", "Jane Smith"],
        decisions: ["Decision 1", "Decision 2"]
      },
      metadata: {
        tokensUsed: 1500,
        processingTime: 5000,
        confidence: 0.95
      }
    };
  }

  /**
   * Generate custom summary content
   */
  async generateCustomSummaryContent(transcriptText, prompt, service, options) {
    // Implementation would call the appropriate LLM service
    // This is a placeholder
    return {
      content: {
        summary: "Custom summary based on prompt..."
      },
      metadata: {
        tokensUsed: 800,
        processingTime: 3000,
        confidence: 0.92
      }
    };
  }

  /**
   * Export summary to text format
   */
  exportToText(summary) {
    let content = '';

    if (summary.meetingId?.title) {
      content += `Meeting: ${summary.meetingId.title}\n`;
      content += `Summary Type: ${summary.type}\n`;
      content += `Generated: ${new Date(summary.createdAt).toLocaleString()}\n\n`;
      content += '---\n\n';
    }

    if (summary.content.overview) {
      content += `OVERVIEW:\n${summary.content.overview}\n\n`;
    }

    if (summary.content.keyPoints && summary.content.keyPoints.length > 0) {
      content += 'KEY POINTS:\n';
      summary.content.keyPoints.forEach((point, index) => {
        content += `${index + 1}. ${point}\n`;
      });
      content += '\n';
    }

    if (summary.content.actionItems && summary.content.actionItems.length > 0) {
      content += 'ACTION ITEMS:\n';
      summary.content.actionItems.forEach((item, index) => {
        content += `${index + 1}. ${item.description}`;
        if (item.assignee) content += ` (Assigned to: ${item.assignee})`;
        if (item.dueDate) content += ` (Due: ${item.dueDate})`;
        content += '\n';
      });
      content += '\n';
    }

    if (summary.content.decisions && summary.content.decisions.length > 0) {
      content += 'DECISIONS:\n';
      summary.content.decisions.forEach((decision, index) => {
        content += `${index + 1}. ${decision}\n`;
      });
    }

    return content;
  }

  /**
   * Export summary to markdown format
   */
  exportToMarkdown(summary) {
    let content = '';

    if (summary.meetingId?.title) {
      content += `# ${summary.meetingId.title} - Summary\n\n`;
      content += `**Type:** ${summary.type}\n`;
      content += `**Generated:** ${new Date(summary.createdAt).toLocaleString()}\n\n`;
      content += '---\n\n';
    }

    if (summary.content.overview) {
      content += `## Overview\n\n${summary.content.overview}\n\n`;
    }

    if (summary.content.keyPoints && summary.content.keyPoints.length > 0) {
      content += '## Key Points\n\n';
      summary.content.keyPoints.forEach(point => {
        content += `- ${point}\n`;
      });
      content += '\n';
    }

    if (summary.content.actionItems && summary.content.actionItems.length > 0) {
      content += '## Action Items\n\n';
      summary.content.actionItems.forEach((item, index) => {
        content += `${index + 1}. **${item.description}**`;
        if (item.assignee) content += ` - *Assigned to: ${item.assignee}*`;
        if (item.dueDate) content += ` - *Due: ${item.dueDate}*`;
        content += '\n';
      });
      content += '\n';
    }

    if (summary.content.decisions && summary.content.decisions.length > 0) {
      content += '## Decisions\n\n';
      summary.content.decisions.forEach(decision => {
        content += `- ${decision}\n`;
      });
    }

    return content;
  }

  /**
   * Calculate summary generation cost
   */
  calculateSummaryCost(service, tokens) {
    const rates = {
      openai: { input: 0.03, output: 0.06 }, // per 1K tokens
      claude: { input: 0.003, output: 0.015 }, // per 1K tokens
      local: { input: 0, output: 0 }
    };
    
    const rate = rates[service] || rates.openai;
    return (tokens / 1000) * (rate.input + rate.output) / 2; // Rough estimate
  }

  /**
   * Send summary complete notification
   */
  async sendSummaryCompleteNotification(summary) {
    try {
      const user = await User.findById(summary.userId);
      const meeting = await Meeting.findById(summary.meetingId);
      
      if (user && meeting) {
        await sendEmail({
          to: user.email,
          template: 'summaryReady',
          data: {
            userName: user.name,
            meetingTitle: meeting.title,
            summaryType: summary.type,
            summaryUrl: `${process.env.FRONTEND_URL}/meetings/${meeting._id}/summary/${summary._id}`
          }
        });
      
    }
} catch (error) {
  logger.error('Error sending summary notification:', error);
}
}

/**
* Clear summary-related caches
*/
async clearSummaryCaches(userId) {
try {
  // Clear summary list caches
  const patterns = [
    `summaries:${userId}:*`,
    `summary-stats:${userId}:*`
  ];
  
  // In production, implement proper cache invalidation
  
} catch (error) {
  logger.error('Error clearing summary caches:', error);
}
}

// Additional summary generation methods (placeholders)

async generateExecutiveSummary(transcript, service, settings) {
// Implementation for executive summary
return this.generateStandardSummary(transcript, service, settings);
}

async generateActionFocusedSummary(transcript, service, settings) {
// Implementation for action-focused summary
return this.generateStandardSummary(transcript, service, settings);
}

async generateTechnicalSummary(transcript, service, settings) {
// Implementation for technical summary
return this.generateStandardSummary(transcript, service, settings);
}

async generateBriefSummary(transcript, service, settings) {
// Implementation for brief summary
return this.generateStandardSummary(transcript, service, settings);
}

async exportToPDF(summary) {
// Implementation for PDF export
// Would use a library like puppeteer or jsPDF
throw new Error('PDF export not implemented');
}
}

module.exports = new SummaryController();
