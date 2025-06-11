// backend/src/models/Transcript.js
/**
 * Transcript Model
 * Mongoose schema for meeting transcripts with speaker diarization and timestamps
 */

const mongoose = require('mongoose');

const transcriptSchema = new mongoose.Schema({
// Reference to Meeting
meetingId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Meeting',
  required: [true, 'Meeting ID is required'],
  unique: true
},

// Processing Information
service: {
  type: String,
  enum: ['fpt-ai', 'whisper', 'google-speech', 'vosk', 'azure', 'aws'],
  required: [true, 'Transcription service is required']
},

status: {
  type: String,
  enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
  default: 'pending'
},

// Language Information
language: {
  detected: {
    type: String,
    required: true,
    default: 'en'
  },
  
  specified: {
    type: String,
    default: 'auto'
  },
  
  confidence: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  }
},

// Transcript Content
content: {
  // Full transcript text
  fullText: {
    type: String,
    required: function() {
      return this.status === 'completed';
    }
  },
  
  // Segmented transcript with timestamps and speakers
  segments: [{
    id: {
      type: String,
      required: true
    },
    
    startTime: {
      type: Number, // in seconds
      required: true,
      min: 0
    },
    
    endTime: {
      type: Number, // in seconds
      required: true,
      min: 0
    },
    
    text: {
      type: String,
      required: true,
      trim: true
    },
    
    speaker: {
      id: {
        type: String,
        default: 'unknown'
      },
      
      name: {
        type: String,
        default: 'Speaker'
      },
      
      confidence: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
      }
    },
    
    confidence: {
      type: Number,
      min: 0,
      max: 100,
      required: true
    },
    
    // Word-level timestamps (if available)
    words: [{
      word: {
        type: String,
        required: true
      },
      
      startTime: {
        type: Number,
        required: true
      },
      
      endTime: {
        type: Number,
        required: true
      },
      
      confidence: {
        type: Number,
        min: 0,
        max: 100
      }
    }]
  }],
  
  // Speaker information
  speakers: [{
    id: {
      type: String,
      required: true,
      unique: true
    },
    
    name: {
      type: String,
      default: function() {
        return `Speaker ${this.id}`;
      }
    },
    
    totalSpeakingTime: {
      type: Number, // in seconds
      default: 0
    },
    
    segmentCount: {
      type: Number,
      default: 0
    },
    
    averageConfidence: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    
    // Identified participant (if matched)
    participantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    
    participantEmail: String
  }]
},

// Quality Metrics
quality: {
  overallConfidence: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  wordCount: {
    type: Number,
    default: 0
  },
  
  segmentCount: {
    type: Number,
    default: 0
  },
  
  speakerCount: {
    type: Number,
    default: 0
  },
  
  averageSegmentLength: {
    type: Number, // in seconds
    default: 0
  },
  
  silenceDuration: {
    type: Number, // in seconds
    default: 0
  },
  
  // Quality indicators
  hasLowConfidenceSegments: {
    type: Boolean,
    default: false
  },
  
  lowConfidenceThreshold: {
    type: Number,
    default: 60
  }
},

// Processing Details
processing: {
  startedAt: {
    type: Date,
    required: function() {
      return this.status !== 'pending';
    }
  },
  
  completedAt: {
    type: Date,
    required: function() {
      return this.status === 'completed';
    }
  },
  
  duration: {
    type: Number, // processing time in seconds
    default: 0
  },
  
  // Service-specific configuration
  config: {
    model: String, // whisper-1, etc.
    temperature: Number,
    language: String,
    prompt: String,
    responseFormat: String
  },
  
  // Raw response from service (for debugging)
  rawResponse: {
    type: mongoose.Schema.Types.Mixed,
    select: false
  },
  
  error: {
    message: String,
    code: String,
    details: mongoose.Schema.Types.Mixed
  }
},

// Corrections and Edits
edits: [{
  segmentId: {
    type: String,
    required: true
  },
  
  originalText: {
    type: String,
    required: true
  },
  
  correctedText: {
    type: String,
    required: true
  },
  
  editType: {
    type: String,
    enum: ['correction', 'speaker-change', 'timestamp-adjustment', 'deletion', 'addition'],
    required: true
  },
  
  editedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  editedAt: {
    type: Date,
    default: Date.now
  },
  
  reason: {
    type: String,
    maxlength: 500
  },
  
  confidence: {
    type: Number,
    min: 0,
    max: 100
  }
}],

// Search and Analysis
analysis: {
  // Keywords and phrases
  keywords: [{
    word: {
      type: String,
      required: true
    },
    
    frequency: {
      type: Number,
      required: true,
      min: 1
    },
    
    importance: {
      type: Number,
      min: 0,
      max: 100
    },
    
    segments: [String] // segment IDs where this keyword appears
  }],
  
  // Topics discussed
  topics: [{
    name: {
      type: String,
      required: true
    },
    
    confidence: {
      type: Number,
      min: 0,
      max: 100
    },
    
    segments: [String], // segment IDs related to this topic
    
    startTime: Number,
    endTime: Number
  }],
  
  // Sentiment analysis
  sentiment: {
    overall: {
      type: String,
      enum: ['positive', 'negative', 'neutral'],
      default: 'neutral'
    },
    
    score: {
      type: Number,
      min: -1,
      max: 1,
      default: 0
    },
    
    segments: [{
      segmentId: String,
      sentiment: {
        type: String,
        enum: ['positive', 'negative', 'neutral']
      },
      score: {
        type: Number,
        min: -1,
        max: 1
      }
    }]
  },
  
  // Meeting insights
  insights: {
    talkTimeDistribution: [{
      speakerId: String,
      percentage: Number,
      duration: Number
    }],
    
    interruptionCount: {
      type: Number,
      default: 0
    },
    
    silencePercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    
    averageWordsPerMinute: {
      type: Number,
      default: 0
    }
  }
},

// Export and Sharing
exports: [{
  format: {
    type: String,
    enum: ['txt', 'srt', 'vtt', 'json', 'csv'],
    required: true
  },
  
  filename: String,
  path: String,
  size: Number,
  
  options: {
    includeTimestamps: {
      type: Boolean,
      default: true
    },
    
    includeSpeakers: {
      type: Boolean,
      default: true
    },
    
    includeConfidence: {
      type: Boolean,
      default: false
    },
    
    timeFormat: {
      type: String,
      enum: ['seconds', 'hms', 'milliseconds'],
      default: 'hms'
    }
  },
  
  exportedAt: {
    type: Date,
    default: Date.now
  },
  
  exportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}],

// Version Control
version: {
  type: Number,
  default: 1
},

previousVersions: [{
  version: Number,
  content: mongoose.Schema.Types.Mixed,
  updatedAt: Date,
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  changeLog: String
}]
}, {
timestamps: true,
toJSON: { virtuals: true },
toObject: { virtuals: true }
});

// Virtual for total duration
transcriptSchema.virtual('totalDuration').get(function() {
if (this.content.segments && this.content.segments.length > 0) {
  const lastSegment = this.content.segments[this.content.segments.length - 1];
  return lastSegment.endTime;
}
return 0;
});

// Virtual for processing time
transcriptSchema.virtual('processingTime').get(function() {
if (this.processing.startedAt && this.processing.completedAt) {
  return Math.round((this.processing.completedAt - this.processing.startedAt) / 1000);
}
return this.processing.duration || 0;
});

// Virtual for edit count
transcriptSchema.virtual('editCount').get(function() {
return this.edits ? this.edits.length : 0;
});

// Pre-save middleware to calculate quality metrics
transcriptSchema.pre('save', function(next) {
if (this.isModified('content.segments') && this.content.segments) {
  this.calculateQualityMetrics();
}
next();
});

// Instance method to calculate quality metrics
transcriptSchema.methods.calculateQualityMetrics = function() {
const segments = this.content.segments;

if (!segments || segments.length === 0) {
  return;
}

// Calculate basic metrics
this.quality.segmentCount = segments.length;
this.quality.wordCount = segments.reduce((total, segment) => {
  return total + (segment.text ? segment.text.split(' ').length : 0);
}, 0);

// Calculate overall confidence
const totalConfidence = segments.reduce((sum, segment) => sum + segment.confidence, 0);
this.quality.overallConfidence = Math.round(totalConfidence / segments.length);

// Calculate average segment length
const totalDuration = segments.reduce((sum, segment) => {
  return sum + (segment.endTime - segment.startTime);
}, 0);
this.quality.averageSegmentLength = totalDuration / segments.length;

// Check for low confidence segments
const lowConfidenceSegments = segments.filter(segment => 
  segment.confidence < this.quality.lowConfidenceThreshold
);
this.quality.hasLowConfidenceSegments = lowConfidenceSegments.length > 0;

// Calculate speaker metrics
const speakers = this.content.speakers || [];
this.quality.speakerCount = speakers.length;

// Update speaker statistics
this.updateSpeakerStatistics();
};

// Instance method to update speaker statistics
transcriptSchema.methods.updateSpeakerStatistics = function() {
const segments = this.content.segments;
const speakers = this.content.speakers;

if (!segments || !speakers) return;

// Reset speaker stats
speakers.forEach(speaker => {
  speaker.totalSpeakingTime = 0;
  speaker.segmentCount = 0;
  speaker.averageConfidence = 0;
});

// Calculate stats from segments
const speakerStats = {};

segments.forEach(segment => {
  const speakerId = segment.speaker.id;
  
  if (!speakerStats[speakerId]) {
    speakerStats[speakerId] = {
      totalTime: 0,
      segmentCount: 0,
      totalConfidence: 0
    };
  }
  
  speakerStats[speakerId].totalTime += (segment.endTime - segment.startTime);
  speakerStats[speakerId].segmentCount += 1;
  speakerStats[speakerId].totalConfidence += segment.confidence;
});

// Update speaker objects
speakers.forEach(speaker => {
  const stats = speakerStats[speaker.id];
  if (stats) {
    speaker.totalSpeakingTime = Math.round(stats.totalTime);
    speaker.segmentCount = stats.segmentCount;
    speaker.averageConfidence = Math.round(stats.totalConfidence / stats.segmentCount);
  }
});
};

// Instance method to add edit
transcriptSchema.methods.addEdit = function(edit) {
// Create backup of current version if this is the first edit
if (this.edits.length === 0) {
  this.createVersionBackup('Initial version before edits');
}

this.edits.push(edit);
this.version += 1;

return this.save();
};

// Instance method to create version backup
transcriptSchema.methods.createVersionBackup = function(changeLog) {
const backup = {
  version: this.version,
  content: {
    fullText: this.content.fullText,
    segments: this.content.segments,
    speakers: this.content.speakers
  },
  updatedAt: new Date(),
  changeLog: changeLog
};

this.previousVersions.push(backup);
};

// Instance method to export transcript
transcriptSchema.methods.exportTranscript = function(format, options = {}, userId) {
const exportData = {
  format,
  options: {
    includeTimestamps: options.includeTimestamps !== false,
    includeSpeakers: options.includeSpeakers !== false,
    includeConfidence: options.includeConfidence || false,
    timeFormat: options.timeFormat || 'hms'
  },
  exportedBy: userId
};

// Generate export content based on format
let content = '';

switch (format) {
  case 'txt':
    content = this.generateTextExport(exportData.options);
    break;
  case 'srt':
    content = this.generateSRTExport(exportData.options);
    break;
  case 'vtt':
    content = this.generateVTTExport(exportData.options);
    break;
  case 'json':
    content = this.generateJSONExport(exportData.options);
    break;
  case 'csv':
    content = this.generateCSVExport(exportData.options);
    break;
}

// Add to exports array
this.exports.push(exportData);

return {
  content,
  filename: `transcript_${this.meetingId}_${Date.now()}.${format}`,
  exportData
};
};

// Instance method to generate text export
transcriptSchema.methods.generateTextExport = function(options) {
let content = '';

this.content.segments.forEach(segment => {
  let line = '';
  
  if (options.includeTimestamps) {
    const startTime = this.formatTime(segment.startTime, options.timeFormat);
    const endTime = this.formatTime(segment.endTime, options.timeFormat);
    line += `[${startTime} - ${endTime}] `;
  }
  
  if (options.includeSpeakers) {
    line += `${segment.speaker.name}: `;
  }
  
  line += segment.text;
  
  if (options.includeConfidence) {
    line += ` (${segment.confidence}%)`;
  }
  
  content += line + '\n';
});

return content;
};

// Instance method to format time
transcriptSchema.methods.formatTime = function(seconds, format) {
switch (format) {
  case 'seconds':
    return seconds.toFixed(2);
  case 'milliseconds':
    return Math.round(seconds * 1000);
  case 'hms':
  default:
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    } else {
      return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }
}
};

// Static method to find by meeting
transcriptSchema.statics.findByMeeting = function(meetingId) {
return this.findOne({ meetingId });
};

// Static method to find by status
transcriptSchema.statics.findByStatus = function(status) {
return this.find({ status });
};

// Static method to search transcripts
transcriptSchema.statics.searchTranscripts = function(query, userId) {
const searchQuery = {
  $and: [
    {
      $or: [
        { 'content.fullText': { $regex: query, $options: 'i' } },
        { 'content.segments.text': { $regex: query, $options: 'i' } },
        { 'analysis.keywords.word': { $regex: query, $options: 'i' } }
      ]
    }
  ]
};

if (userId) {
  // Add user filter through meeting reference
  searchQuery.$and.push({
    meetingId: {
      $in: mongoose.model('Meeting').find({ userId }).distinct('_id')
    }
  });
}

return this.find(searchQuery).populate('meetingId', 'title meetingDate');
};

// Indexes for better performance
transcriptSchema.index({ meetingId: 1 });
transcriptSchema.index({ status: 1 });
transcriptSchema.index({ 'content.fullText': 'text' });
transcriptSchema.index({ 'content.segments.text': 'text' });
transcriptSchema.index({ 'analysis.keywords.word': 1 });
transcriptSchema.index({ createdAt: -1 });

const Transcript = mongoose.model('Transcript', transcriptSchema);

module.exports = Transcript;