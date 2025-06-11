// backend/src/controllers/transcriptionController.js
/**
 * Transcription Controller
 * Handles transcription operations and management
 */

const Transcript = require('../models/Transcript');
const Meeting = require('../models/Meeting');
const File = require('../models/File');
const User = require('../models/User');
const { redisConfig } = require('../config/redis');
const { aiServiceManager } = require('../config/ai-services');
const logger = require('../utils/logger');
const { validateRequest } = require('../utils/validation');
const { paginate } = require('../utils/pagination');
const { processAudioFile } = require('../utils/audioProcessor');
const { sendEmail } = require('../utils/email');
const { 
startTranscriptionSchema, 
updateTranscriptSchema,
searchTranscriptSchema 
} = require('../validations/transcriptionValidation');

class TranscriptionController {
/**
 * Start transcription process
 * POST /api/transcriptions/start
 */
async startTranscription(req, res) {
  try {
    // Validate request
    const { error, value } = validateRequest(startTranscriptionSchema, req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { meetingId, fileId, language = 'auto', service } = value;
    const userId = req.user.id;

    // Verify meeting ownership
    const meeting = await Meeting.findOne({ _id: meetingId, userId })
      .populate('files');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Verify file exists and belongs to meeting
    const file = meeting.files.find(f => f._id.toString() === fileId);
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found in meeting'
      });
    }

    // Check if transcription already exists
    const existingTranscript = await Transcript.findOne({ meetingId });
    if (existingTranscript && existingTranscript.status !== 'failed') {
      return res.status(409).json({
        success: false,
        message: 'Transcription already exists or in progress',
        data: { transcript: existingTranscript }
      });
    }

    // Check user's transcription quota
    const user = await User.findById(userId);
    const currentMonthTranscriptions = await Transcript.countDocuments({
      userId,
      createdAt: {
        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      }
    });

    if (currentMonthTranscriptions >= user.subscription.limits.transcriptionsPerMonth) {
      return res.status(403).json({
        success: false,
        message: 'Monthly transcription limit exceeded',
        limit: user.subscription.limits.transcriptionsPerMonth,
        current: currentMonthTranscriptions
      });
    }

    // Determine best STT service
    const selectedService = service || aiServiceManager.getBestSTTService(
      language,
      file.size,
      meeting.duration
    );

    // Create or update transcript record
    let transcript;
    if (existingTranscript) {
      transcript = existingTranscript;
      transcript.status = 'processing';
      transcript.service = selectedService;
      transcript.language = language;
      transcript.startedAt = new Date();
      transcript.updatedAt = new Date();
    } else {
      transcript = new Transcript({
        meetingId,
        userId,
        fileId,
        language,
        service: selectedService,
        status: 'processing',
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    await transcript.save();

    // Update meeting status
    meeting.status = 'transcribing';
    meeting.transcript = transcript._id;
    meeting.updatedAt = new Date();
    await meeting.save();

    // Queue transcription job
    const jobData = {
      transcriptId: transcript._id,
      meetingId,
      fileId,
      filePath: file.path,
      service: selectedService,
      language,
      userId,
      priority: meeting.priority || 'normal',
      createdAt: new Date()
    };

    await redisConfig.lpush('transcription-queue', jobData);

    // Cache transcript data
    await redisConfig.set(`transcript:${transcript._id}`, transcript, 3600);

    logger.info('Transcription started', {
      transcriptId: transcript._id,
      meetingId,
      fileId,
      service: selectedService,
      language
    });

    res.json({
      success: true,
      message: 'Transcription started successfully',
      data: { transcript }
    });

    // Start processing
    this.processTranscriptionJob(jobData);

  } catch (error) {
    logger.error('Error starting transcription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start transcription',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Get transcription by ID
 * GET /api/transcriptions/:id
 */
async getTranscription(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check cache first
    const cached = await redisConfig.get(`transcript:${id}`);
    if (cached && cached.userId.toString() === userId) {
      return res.json({
        success: true,
        data: { transcript: cached },
        cached: true
      });
    }

    // Get from database
    const transcript = await Transcript.findOne({ _id: id, userId })
      .populate('meetingId', 'title type category duration')
      .populate('fileId', 'name size type');

    if (!transcript) {
      return res.status(404).json({
        success: false,
        message: 'Transcription not found'
      });
    }

    // Update cache
    await redisConfig.set(`transcript:${id}`, transcript, 3600);

    res.json({
      success: true,
      data: { transcript }
    });

  } catch (error) {
    logger.error('Error getting transcription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transcription',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Get transcriptions list
 * GET /api/transcriptions
 */
async getTranscriptions(req, res) {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      status,
      language,
      service,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = { userId };

    if (status) query.status = status;
    if (language) query.language = language;
    if (service) query.service = service;

    // Search in transcript content
    if (search) {
      query.$or = [
        { 'segments.text': { $regex: search, $options: 'i' } },
        { 'metadata.keywords': { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Check cache
    const cacheKey = `transcripts:${userId}:${JSON.stringify(query)}:${page}:${limit}`;
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
        { path: 'fileId', select: 'name size type' }
      ],
      select: '-segments' // Exclude large segments data from list
    };

    const result = await paginate(Transcript, query, options);

    // Cache results
    await redisConfig.set(cacheKey, result, 300);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Error getting transcriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transcriptions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Update transcript
 * PUT /api/transcriptions/:id
 */
async updateTranscript(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Validate request
    const { error, value } = validateRequest(updateTranscriptSchema, req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    // Find transcript
    const transcript = await Transcript.findOne({ _id: id, userId });
    if (!transcript) {
      return res.status(404).json({
        success: false,
        message: 'Transcription not found'
      });
    }

    // Update transcript
    Object.assign(transcript, value);
    transcript.updatedAt = new Date();
    transcript.editedAt = new Date();
    transcript.editedBy = userId;

    await transcript.save();

    // Update cache
    await redisConfig.set(`transcript:${id}`, transcript, 3600);

    // Clear related caches
    await this.clearTranscriptCaches(userId);

    logger.info('Transcript updated', {
      transcriptId: id,
      userId,
      changes: Object.keys(value)
    });

    res.json({
      success: true,
      message: 'Transcript updated successfully',
      data: { transcript }
    });

  } catch (error) {
    logger.error('Error updating transcript:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update transcript',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Delete transcript
 * DELETE /api/transcriptions/:id
 */
async deleteTranscript(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const transcript = await Transcript.findOne({ _id: id, userId });
    if (!transcript) {
      return res.status(404).json({
        success: false,
        message: 'Transcription not found'
      });
    }

    // Update meeting to remove transcript reference
    await Meeting.findByIdAndUpdate(transcript.meetingId, {
      $unset: { transcript: 1 },
      status: 'uploaded',
      updatedAt: new Date()
    });

    // Delete transcript
    await transcript.deleteOne();

    // Clear caches
    await redisConfig.del(`transcript:${id}`);
    await this.clearTranscriptCaches(userId);

    logger.info('Transcript deleted', {
      transcriptId: id,
      userId
    });

    res.json({
      success: true,
      message: 'Transcript deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting transcript:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete transcript',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Search within transcript content
 * POST /api/transcriptions/:id/search
 */
async searchTranscript(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Validate request
    const { error, value } = validateRequest(searchTranscriptSchema, req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { query, caseSensitive = false, wholeWord = false } = value;

    // Get transcript
    const transcript = await Transcript.findOne({ _id: id, userId });
    if (!transcript) {
      return res.status(404).json({
        success: false,
        message: 'Transcription not found'
      });
    }

    if (!transcript.segments || transcript.segments.length === 0) {
      return res.json({
        success: true,
        data: {
          results: [],
          totalMatches: 0,
          query
        }
      });
    }

    // Build search regex
    let regexFlags = caseSensitive ? 'g' : 'gi';
    let searchPattern = wholeWord ? `\\b${query}\\b` : query;
    const regex = new RegExp(searchPattern, regexFlags);

    // Search in segments
    const results = [];
    let totalMatches = 0;

    transcript.segments.forEach((segment, segmentIndex) => {
      const matches = segment.text.match(regex);
      if (matches) {
        totalMatches += matches.length;
        
        // Find positions of matches
        let searchIndex = 0;
        let match;
        const segmentMatches = [];

        while ((match = regex.exec(segment.text)) !== null) {
          segmentMatches.push({
            text: match[0],
            start: match.index,
            end: match.index + match[0].length,
            context: this.getContext(segment.text, match.index, match[0].length)
          });
          
          // Prevent infinite loop
          if (!regex.global) break;
        }

        results.push({
          segmentIndex,
          timestamp: segment.start,
          speaker: segment.speaker,
          text: segment.text,
          matches: segmentMatches
        });
      }
    });

    res.json({
      success: true,
      data: {
        results,
        totalMatches,
        totalSegments: results.length,
        query,
        options: { caseSensitive, wholeWord }
      }
    });

  } catch (error) {
    logger.error('Error searching transcript:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search transcript',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Get transcript statistics
 * GET /api/transcriptions/:id/stats
 */
async getTranscriptStats(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check cache
    const cacheKey = `transcript-stats:${id}`;
    const cached = await redisConfig.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        cached: true
      });
    }

    const transcript = await Transcript.findOne({ _id: id, userId });
    if (!transcript) {
      return res.status(404).json({
        success: false,
        message: 'Transcription not found'
      });
    }

    if (!transcript.segments || transcript.segments.length === 0) {
      return res.json({
        success: true,
        data: {
          wordCount: 0,
          speakerCount: 0,
          duration: 0,
          segments: 0,
          avgWordsPerSegment: 0,
          speakerStats: [],
          confidence: null
        }
      });
    }

    // Calculate statistics
    const stats = {
      wordCount: 0,
      speakerCount: 0,
      duration: transcript.duration || 0,
      segments: transcript.segments.length,
      avgWordsPerSegment: 0,
      speakerStats: [],
      confidence: null
    };

    const speakerMap = new Map();
    let totalConfidence = 0;
    let confidenceCount = 0;

    transcript.segments.forEach(segment => {
      // Word count
      const words = segment.text.trim().split(/\s+/).filter(word => word.length > 0);
      stats.wordCount += words.length;

      // Speaker statistics
      const speaker = segment.speaker || 'Unknown';
      if (!speakerMap.has(speaker)) {
        speakerMap.set(speaker, {
          name: speaker,
          segments: 0,
          words: 0,
          duration: 0
        });
      }

      const speakerStats = speakerMap.get(speaker);
      speakerStats.segments++;
      speakerStats.words += words.length;
      speakerStats.duration += (segment.end - segment.start) || 0;

      // Confidence
      if (segment.confidence !== undefined) {
        totalConfidence += segment.confidence;
        confidenceCount++;
      }
    });

    stats.speakerCount = speakerMap.size;
    stats.avgWordsPerSegment = stats.segments > 0 ? Math.round(stats.wordCount / stats.segments) : 0;
    stats.speakerStats = Array.from(speakerMap.values());
    stats.confidence = confidenceCount > 0 ? (totalConfidence / confidenceCount) : null;

    // Cache for 1 hour
    await redisConfig.set(cacheKey, stats, 3600);

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Error getting transcript stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transcript statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Export transcript in various formats
 * GET /api/transcriptions/:id/export
 */
async exportTranscript(req, res) {
  try {
    const { id } = req.params;
    const { format = 'txt', includeSpeakers = true, includeTimestamps = false } = req.query;
    const userId = req.user.id;

    const transcript = await Transcript.findOne({ _id: id, userId })
      .populate('meetingId', 'title');

    if (!transcript) {
      return res.status(404).json({
        success: false,
        message: 'Transcription not found'
      });
    }

    if (!transcript.segments || transcript.segments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No transcript content available'
      });
    }

    let content;
    let mimeType;
    let filename;

    switch (format.toLowerCase()) {
      case 'txt':
        content = this.exportToText(transcript, { includeSpeakers, includeTimestamps });
        mimeType = 'text/plain';
        filename = `${transcript.meetingId.title || 'transcript'}.txt`;
        break;

      case 'srt':
        content = this.exportToSRT(transcript);
        mimeType = 'text/plain';
        filename = `${transcript.meetingId.title || 'transcript'}.srt`;
        break;

      case 'vtt':
        content = this.exportToVTT(transcript);
        mimeType = 'text/vtt';
        filename = `${transcript.meetingId.title || 'transcript'}.vtt`;
        break;

      case 'json':
        content = JSON.stringify(transcript.segments, null, 2);
        mimeType = 'application/json';
        filename = `${transcript.meetingId.title || 'transcript'}.json`;
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
    logger.info('Transcript exported', {
      transcriptId: id,
      userId,
      format,
      filename
    });

  } catch (error) {
    logger.error('Error exporting transcript:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export transcript',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Get transcription job status
 * GET /api/transcriptions/jobs/:jobId/status
 */
async getJobStatus(req, res) {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    // Get job status from Redis
    const jobStatus = await redisConfig.get(`transcription-job:${jobId}`);
    
    if (!jobStatus) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Verify job belongs to user
    if (jobStatus.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: jobStatus
    });

  } catch (error) {
    logger.error('Error getting job status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Private helper methods

/**
 * Process transcription job
 */
async processTranscriptionJob(jobData) {
  const { transcriptId, fileId, filePath, service, language } = jobData;

  try {
    // Update job status
    await redisConfig.set(`transcription-job:${transcriptId}`, {
      ...jobData,
      status: 'processing',
      startedAt: new Date()
    }, 7200); // 2 hours

    // Get transcript record
    const transcript = await Transcript.findById(transcriptId);
    if (!transcript) {
      throw new Error('Transcript record not found');
    }

    // Process audio file
    const audioData = await processAudioFile(filePath, {
      format: 'wav',
      sampleRate: 16000,
      channels: 1
    });

    // Get STT service configuration
    const sttConfig = aiServiceManager.getServiceConfig(service, 'stt');

    // Perform transcription based on service
    let transcriptionResult;
    switch (service) {
      case 'fpt':
        transcriptionResult = await this.transcribeWithFPT(audioData, language, sttConfig);
        break;
      case 'whisper':
        transcriptionResult = await this.transcribeWithWhisper(audioData, language, sttConfig);
        break;
      case 'google':
        transcriptionResult = await this.transcribeWithGoogle(audioData, language, sttConfig);
        break;
      case 'azure':
        transcriptionResult = await this.transcribeWithAzure(audioData, language, sttConfig);
        break;
      default:
        throw new Error(`Unsupported STT service: ${service}`);
    }

    // Update transcript with results
    transcript.segments = transcriptionResult.segments;
    transcript.text = transcriptionResult.text;
    transcript.language = transcriptionResult.language || language;
    transcript.confidence = transcriptionResult.confidence;
    transcript.duration = transcriptionResult.duration;
    transcript.wordCount = transcriptionResult.wordCount;
    transcript.status = 'completed';
    transcript.completedAt = new Date();
    transcript.updatedAt = new Date();

    // Extract metadata
    transcript.metadata = {
      service,
      model: transcriptionResult.model,
      processingTime: Date.now() - new Date(jobData.createdAt).getTime(),
      confidence: transcriptionResult.confidence,
      language: transcriptionResult.language,
      speakers: transcriptionResult.speakers || [],
      keywords: this.extractKeywords(transcriptionResult.text)
    };

    await transcript.save();

    // Update meeting status
    await Meeting.findByIdAndUpdate(jobData.meetingId, {
      status: 'transcribed',
      updatedAt: new Date()
    });

    // Update cache
    await redisConfig.set(`transcript:${transcriptId}`, transcript, 3600);

    // Update job status
    await redisConfig.set(`transcription-job:${transcriptId}`, {
      ...jobData,
      status: 'completed',
      completedAt: new Date(),
      result: {
        wordCount: transcript.wordCount,
        duration: transcript.duration,
        confidence: transcript.confidence
      }
    }, 7200);

    // Update service usage stats
    aiServiceManager.updateUsageStats(service, 'stt', {
      requests: 1,
      duration: transcript.duration,
      cost: this.calculateTranscriptionCost(service, transcript.duration)
    });

    logger.info('Transcription completed', {
      transcriptId,
      service,
      wordCount: transcript.wordCount,
      duration: transcript.duration,
      confidence: transcript.confidence
    });

    // Send notification
    await this.sendTranscriptionCompleteNotification(transcript);

  } catch (error) {
    logger.error('Transcription job failed:', error);

    // Update transcript status
    await Transcript.findByIdAndUpdate(transcriptId, {
      status: 'failed',
      error: error.message,
      updatedAt: new Date()
    });

    // Update job status
    await redisConfig.set(`transcription-job:${transcriptId}`, {
      ...jobData,
      status: 'failed',
      error: error.message,
      failedAt: new Date()
    }, 7200);

    // Update meeting status
    await Meeting.findByIdAndUpdate(jobData.meetingId, {
      status: 'failed',
      updatedAt: new Date()
    });
  }
}

/**
 * Get context around a match
 */
getContext(text, start, length, contextLength = 50) {
  const contextStart = Math.max(0, start - contextLength);
  const contextEnd = Math.min(text.length, start + length + contextLength);
  
  return {
    before: text.substring(contextStart, start),
    match: text.substring(start, start + length),
    after: text.substring(start + length, contextEnd)
  };
}

/**
 * Export transcript to text format
 */
exportToText(transcript, options) {
  const { includeSpeakers, includeTimestamps } = options;
  let content = '';

  if (transcript.meetingId?.title) {
    content += `Meeting: ${transcript.meetingId.title}\n`;
    content += `Date: ${new Date(transcript.createdAt).toLocaleString()}\n`;
    content += `Duration: ${Math.round(transcript.duration / 60)} minutes\n`;
    content += `Language: ${transcript.language}\n\n`;
    content += '---\n\n';
  }

  transcript.segments.forEach(segment => {
    let line = '';

    if (includeTimestamps) {
      const timestamp = this.formatTimestamp(segment.start);
      line += `[${timestamp}] `;
    }

    if (includeSpeakers && segment.speaker) {
      line += `${segment.speaker}: `;
    }

    line += segment.text;
    content += line + '\n';
  });

  return content;
}

/**
 * Export transcript to SRT format
 */
exportToSRT(transcript) {
  let content = '';
  
  transcript.segments.forEach((segment, index) => {
    const startTime = this.formatSRTTimestamp(segment.start);
    const endTime = this.formatSRTTimestamp(segment.end);
    
    content += `${index + 1}\n`;
    content += `${startTime} --> ${endTime}\n`;
    content += `${segment.text}\n\n`;
  });

  return content;
}

/**
 * Export transcript to VTT format
 */
exportToVTT(transcript) {
  let content = 'WEBVTT\n\n';
  
  transcript.segments.forEach(segment => {
    const startTime = this.formatVTTTimestamp(segment.start);
    const endTime = this.formatVTTTimestamp(segment.end);
    
    content += `${startTime} --> ${endTime}\n`;
    content += `${segment.text}\n\n`;
  });

  return content;
}

/**
 * Format timestamp for display
 */
formatTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format timestamp for SRT
 */
formatSRTTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * Format timestamp for VTT
 */
formatVTTTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/**
 * Extract keywords from text
 */
extractKeywords(text) {
  // Simple keyword extraction - in production, use more sophisticated NLP
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3);
  
  const wordCount = {};
  words.forEach(word => {
    wordCount[word] = (wordCount[word] || 0) + 1;
  });
  
  return Object.entries(wordCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * Calculate transcription cost
 */
calculateTranscriptionCost(service, duration) {
  const rates = {
    fpt: 0.01, // per minute
    whisper: 0.006, // per minute
    google: 0.016, // per minute
    azure: 0.01 // per minute
  };
  
  const minutes = Math.ceil(duration / 60);
  return (rates[service] || 0) * minutes;
}

/**
 * Send transcription complete notification
 */
async sendTranscriptionCompleteNotification(transcript) {
  try {
    const user = await User.findById(transcript.userId);
    const meeting = await Meeting.findById(transcript.meetingId);
    
    if (user && meeting) {
      await sendEmail({
        to: user.email,
        template: 'transcriptionComplete',
        data: {
          userName: user.name,
          meetingTitle: meeting.title,
          wordCount: transcript.wordCount,
          duration: Math.round(transcript.duration / 60),
          transcriptUrl: `${process.env.FRONTEND_URL}/meetings/${meeting._id}/transcript`
        }
      });
    }
  } catch (error) {
    logger.error('Error sending transcription notification:', error);
  }
}

/**
 * Clear transcript-related caches
 */
async clearTranscriptCaches(userId) {
  try {
    // Clear transcript list caches
    const patterns = [
      `transcripts:${userId}:*`,
      `transcript-stats:*`
    ];
    
    // In production, implement proper cache invalidation
    // For now, just clear specific keys
    
  } catch (error) {
    logger.error('Error clearing transcript caches:', error);
  }
}

// STT Service Methods (placeholders - actual implementation would call respective APIs)

async transcribeWithFPT(audioData, language, config) {
  // Implementation for FPT AI transcription
  throw new Error('FPT transcription not implemented');
}

async transcribeWithWhisper(audioData, language, config) {
  // Implementation for OpenAI Whisper transcription
  throw new Error('Whisper transcription not implemented');
}

async transcribeWithGoogle(audioData, language, config) {
  // Implementation for Google Cloud Speech-to-Text
  throw new Error('Google transcription not implemented');
}

async transcribeWithAzure(audioData, language, config) {
  // Implementation for Azure Speech Services
  throw new Error('Azure transcription not implemented');
}
}

module.exports = new TranscriptionController();
