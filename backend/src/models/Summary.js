// backend/src/models/Summary.js
/**
 * Summary Model
 * Mongoose schema for AI-generated meeting summaries and insights
 */

const mongoose = require('mongoose');

const summarySchema = new mongoose.Schema({
// Reference to Meeting
meetingId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Meeting',
  required: [true, 'Meeting ID is required']
},

// Reference to Transcript
transcriptId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Transcript',
  required: [true, 'Transcript ID is required']
},

// Summary Type and Configuration
type: {
  type: String,
  enum: [
    'executive', 
    'detailed', 
    'brief', 
    'bullet-points', 
    'action-items', 
    'key-decisions',
    'custom'
  ],
  required: [true, 'Summary type is required']
},

style: {
  type: String,
  enum: ['formal', 'casual', 'technical', 'executive', 'narrative'],
  default: 'formal'
},

language: {
  type: String,
  default: 'en'
},

// AI Service Information
service: {
  provider: {
    type: String,
    enum: ['openai', 'claude', 'gemini', 'local-llm', 'custom'],
    required: [true, 'AI service provider is required']
  },
  
  model: {
    type: String,
    required: [true, 'AI model is required']
  },
  
  version: {
    type: String,
    default: '1.0'
  }
},

// Processing Status
status: {
  type: String,
  enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
  default: 'pending'
},

// Summary Content
content: {
  // Main summary text
  summary: {
    type: String,
    required: function() {
      return this.status === 'completed';
    }
  },
  
  // Executive summary (brief overview)
  executive: {
    type: String
  },
  
  // Key points and highlights
  keyPoints: [{
    title: {
      type: String,
      required: true
    },
    
    description: {
      type: String,
      required: true
    },
    
    importance: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium'
    },
    
    timestamp: {
      type: Number // reference to transcript segment
    },
    
    speakers: [String] // speaker IDs involved
  }],
  
  // Action items and tasks
  actionItems: [{
    task: {
      type: String,
      required: true
    },
    
    assignee: {
      name: String,
      email: String,
      speakerId: String
    },
    
    deadline: {
      type: Date
    },
    
    priority: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium'
    },
    
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'cancelled'],
      default: 'pending'
    },
    
    description: String,
    
    timestamp: Number, // reference to transcript segment
    
    confidence: {
      type: Number,
      min: 0,
      max: 100
    }
  }],
  
  // Decisions made during the meeting
  decisions: [{
    decision: {
      type: String,
      required: true
    },
    
    context: {
      type: String
    },
    
    impact: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium'
    },
    
    decisionMakers: [String], // speaker IDs
    
    timestamp: Number,
    
    followUpRequired: {
      type: Boolean,
      default: false
    },
    
    confidence: {
      type: Number,
      min: 0,
      max: 100
    }
  }],
  
  // Questions raised and answers
  questionsAndAnswers: [{
    question: {
      type: String,
      required: true
    },
    
    answer: {
      type: String
    },
    
    askedBy: String, // speaker ID
    answeredBy: String, // speaker ID
    
    timestamp: Number,
    
    resolved: {
      type: Boolean,
      default: false
    },
    
    followUpNeeded: {
      type: Boolean,
      default: false
    }
  }],
  
  // Topics discussed
  topics: [{
    name: {
      type: String,
      required: true
    },
    
    description: {
      type: String
    },
    
    duration: {
      type: Number // in seconds
    },
    
    startTime: Number,
    endTime: Number,
    
    participants: [String], // speaker IDs
    
    importance: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium'
    },
    
    outcome: String
  }],
  
  // Meeting insights and analytics
  insights: {
    // Participation analysis
    participation: [{
      speakerId: String,
      speakerName: String,
      talkTime: Number, // in seconds
      talkPercentage: Number,
      contributionLevel: {
        type: String,
        enum: ['high', 'medium', 'low']
      }
    }],
    
    // Meeting effectiveness
    effectiveness: {
      score: {
        type: Number,
        min: 0,
        max: 100
      },
      
      factors: {
        engagement: Number,
        productivity: Number,
        clarity: Number,
        actionability: Number
      },
      
      recommendations: [String]
    },
    
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
        max: 1
      },
      
      trends: [{
        timeRange: {
          start: Number,
          end: Number
        },
        sentiment: String,
        score: Number
      }]
    },
    
    // Communication patterns
    communication: {
      interruptionCount: Number,
      averageResponseTime: Number,
      questionCount: Number,
      agreementLevel: {
        type: String,
        enum: ['high', 'medium', 'low']
      }
    }
  }
},

// Generation Configuration
config: {
  prompt: {
    type: String
  },
  
  temperature: {
    type: Number,
    min: 0,
    max: 2,
    default: 0.7
  },
  
  maxTokens: {
    type: Number,
    default: 2000
  },
  
  includeTimestamps: {
    type: Boolean,
    default: true
  },
  
  includeSpeakers: {
    type: Boolean,
    default: true
  },
  
  focusAreas: [String], // specific areas to focus on
  
  excludeAreas: [String], // areas to exclude
  
  customInstructions: String
},

// Quality and Metrics
quality: {
  relevance: {
    type: Number,
    min: 0,
    max: 100
  },
  
  completeness: {
    type: Number,
    min: 0,
    max: 100
  },
  
  accuracy: {
    type: Number,
    min: 0,
    max: 100
  },
  
  coherence: {
    type: Number,
    min: 0,
    max: 100
  },
  
  actionability: {
    type: Number,
    min: 0,
    max: 100
  }
},

// Processing Details
processing: {
  startedAt: Date,
  completedAt: Date,
  duration: Number, // in seconds
  
  tokensUsed: {
    input: Number,
    output: Number,
    total: Number
  },
  
  cost: {
    amount: Number,
    currency: {
      type: String,
      default: 'USD'
    }
  },
  
  error: {
    message: String,
    code: String,
    details: mongoose.Schema.Types.Mixed
  },
  
  retryCount: {
    type: Number,
    default: 0
  }
},

// User Feedback and Ratings
feedback: {
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  
  comments: String,
  
  helpful: {
    type: Boolean
  },
  
  accuracy: {
    type: Number,
    min: 1,
    max: 5
  },
  
  completeness: {
    type: Number,
    min: 1,
    max: 5
  },
  
  ratedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  ratedAt: Date
},

// Edits and Revisions
edits: [{
  section: {
    type: String,
    enum: ['summary', 'keyPoints', 'actionItems', 'decisions', 'insights'],
    required: true
  },
  
  originalContent: String,
  editedContent: String,
  
  editType: {
    type: String,
    enum: ['correction', 'addition', 'deletion', 'modification'],
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
  
  reason: String
}],

// Sharing and Collaboration
sharing: {
  isShared: {
    type: Boolean,
    default: false
  },
  
  sharedWith: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    
    email: String,
    
    permission: {
      type: String,
      enum: ['view', 'comment', 'edit'],
      default: 'view'
    },
    
    sharedAt: {
      type: Date,
      default: Date.now
    },
    
    sharedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  
  publicLink: {
    enabled: {
      type: Boolean,
      default: false
    },
    
    token: String,
    expiresAt: Date,
    
    accessCount: {
      type: Number,
      default: 0
    }
  }
},

// Export and Templates
templates: [{
  name: {
    type: String,
    required: true
  },
  
  format: {
    type: String,
    enum: ['docx', 'pdf', 'html', 'markdown'],
    required: true
  },
  
  structure: {
    includeSummary: {
      type: Boolean,
      default: true
    },
    
    includeKeyPoints: {
      type: Boolean,
      default: true
    },
    
    includeActionItems: {
      type: Boolean,
      default: true
    },
    
    includeDecisions: {
      type: Boolean,
      default: true
    },
    
    includeInsights: {
      type: Boolean,
      default: false
    },
    
    includeTimestamps: {
      type: Boolean,
      default: false
    }
  },
  
  styling: {
    theme: String,
    colors: mongoose.Schema.Types.Mixed,
    fonts: mongoose.Schema.Types.Mixed
  },
  
  customSections: [{
    title: String,
    content: String,
    order: Number
  }]
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
}],

// Analytics and Usage
analytics: {
  views: {
    type: Number,
    default: 0
  },
  
  downloads: {
    type: Number,
    default: 0
  },
  
  shares: {
    type: Number,
    default: 0
  },
  
  lastViewedAt: Date,
  
  viewHistory: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    viewedAt: {
      type: Date,
      default: Date.now
    },
    duration: Number, // seconds spent viewing
    sections: [String] // which sections were viewed
  }]
}
}, {
timestamps: true,
toJSON: { virtuals: true },
toObject: { virtuals: true }
});

// Virtual for word count
summarySchema.virtual('wordCount').get(function() {
if (this.content.summary) {
  return this.content.summary.split(' ').length;
}
return 0;
});

// Virtual for action items count
summarySchema.virtual('actionItemsCount').get(function() {
return this.content.actionItems ? this.content.actionItems.length : 0;
});

// Virtual for decisions count
summarySchema.virtual('decisionsCount').get(function() {
return this.content.decisions ? this.content.decisions.length : 0;
});

// Virtual for processing time
summarySchema.virtual('processingTime').get(function() {
if (this.processing.startedAt && this.processing.completedAt) {
  return Math.round((this.processing.completedAt - this.processing.startedAt) / 1000);
}
return this.processing.duration || 0;
});

// Virtual for overall quality score
summarySchema.virtual('overallQuality').get(function() {
const quality = this.quality;
if (!quality) return 0;

const scores = [
  quality.relevance,
  quality.completeness,
  quality.accuracy,
  quality.coherence,
  quality.actionability
].filter(score => score !== undefined && score !== null);

if (scores.length === 0) return 0;

return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
});

// Pre-save middleware to update analytics
summarySchema.pre('save', function(next) {
if (this.isModified('analytics.views')) {
  this.analytics.lastViewedAt = new Date();
}
next();
});

// Instance method to add edit
summarySchema.methods.addEdit = function(edit) {
// Create backup of current version if this is the first edit
if (this.edits.length === 0) {
  this.createVersionBackup('Initial version before edits');
}

this.edits.push(edit);
this.version += 1;

return this.save();
};

// Instance method to create version backup
summarySchema.methods.createVersionBackup = function(changeLog) {
const backup = {
  version: this.version,
  content: this.content,
  updatedAt: new Date(),
  changeLog: changeLog
};

this.previousVersions.push(backup);
};

// Instance method to update action item status
summarySchema.methods.updateActionItemStatus = function(actionItemIndex, status) {
if (this.content.actionItems && this.content.actionItems[actionItemIndex]) {
  this.content.actionItems[actionItemIndex].status = status;
  return this.save();
}
return Promise.reject(new Error('Action item not found'));
};

// Instance method to add feedback
summarySchema.methods.addFeedback = function(feedback, userId) {
this.feedback = {
  ...feedback,
  ratedBy: userId,
  ratedAt: new Date()
};

return this.save();
};

// Instance method to share summary
summarySchema.methods.shareWith = function(userInfo, permission = 'view', sharedBy) {
const shareData = {
  ...userInfo,
  permission,
  sharedBy,
  sharedAt: new Date()
};

// Check if already shared with this user
const existingShare = this.sharing.sharedWith.find(share => 
  share.userId?.toString() === userInfo.userId?.toString() || 
  share.email === userInfo.email
);

if (existingShare) {
  existingShare.permission = permission;
  existingShare.sharedAt = new Date();
} else {
  this.sharing.sharedWith.push(shareData);
}

this.sharing.isShared = true;
this.analytics.shares += 1;

return this.save();
};

// Instance method to create public link
summarySchema.methods.createPublicLink = function(expiresInDays = 30) {
const token = require('crypto').randomBytes(32).toString('hex');
const expiresAt = new Date();
expiresAt.setDate(expiresAt.getDate() + expiresInDays);

this.sharing.publicLink = {
  enabled: true,
  token,
  expiresAt,
  accessCount: 0
};

return this.save().then(() => token);
};

// Instance method to export summary
summarySchema.methods.exportSummary = function(format, template = null, options = {}) {
const exportData = {
  format,
  template: template || 'default',
  options,
  exportedAt: new Date()
};

// Generate export content based on format and template
let content = '';

switch (format) {
  case 'markdown':
    content = this.generateMarkdownExport(template, options);
    break;
  case 'html':
    content = this.generateHTMLExport(template, options);
    break;
  case 'json':
    content = this.generateJSONExport(options);
    break;
  default:
    throw new Error(`Unsupported export format: ${format}`);
}

this.analytics.downloads += 1;
this.save();

return {
  content,
  filename: `summary_${this.meetingId}_${Date.now()}.${format}`,
  exportData
};
};

// Instance method to generate markdown export
summarySchema.methods.generateMarkdownExport = function(template, options) {
let markdown = '';

// Title
markdown += `# Meeting Summary\n\n`;

// Executive summary
if (this.content.executive && options.includeExecutive !== false) {
  markdown += `## Executive Summary\n\n${this.content.executive}\n\n`;
}

// Main summary
if (this.content.summary) {
  markdown += `## Summary\n\n${this.content.summary}\n\n`;
}

// Key points
if (this.content.keyPoints && this.content.keyPoints.length > 0) {
  markdown += `## Key Points\n\n`;
  this.content.keyPoints.forEach((point, index) => {
    markdown += `### ${index + 1}. ${point.title}\n\n`;
    markdown += `${point.description}\n\n`;
    if (point.importance !== 'medium') {
      markdown += `**Priority:** ${point.importance}\n\n`;
    }
  });
}

// Action items
if (this.content.actionItems && this.content.actionItems.length > 0) {
  markdown += `## Action Items\n\n`;
  this.content.actionItems.forEach((item, index) => {
    markdown += `### ${index + 1}. ${item.task}\n\n`;
    if (item.assignee?.name) {
      markdown += `**Assigned to:** ${item.assignee.name}\n\n`;
    }
    if (item.deadline) {
      markdown += `**Deadline:** ${item.deadline.toDateString()}\n\n`;
    }
    if (item.priority !== 'medium') {
      markdown += `**Priority:** ${item.priority}\n\n`;
    }
    if (item.description) {
      markdown += `${item.description}\n\n`;
    }
  });
}

// Decisions
if (this.content.decisions && this.content.decisions.length > 0) {
  markdown += `## Decisions\n\n`;
  this.content.decisions.forEach((decision, index) => {
    markdown += `### ${index + 1}. ${decision.decision}\n\n`;
    if (decision.context) {
      markdown += `**Context:** ${decision.context}\n\n`;
    }
    if (decision.impact !== 'medium') {
      markdown += `**Impact:** ${decision.impact}\n\n`;
    }
  });
}

return markdown;
};

// Static method to find by meeting
summarySchema.statics.findByMeeting = function(meetingId, type = null) {
const query = { meetingId };
if (type) {
  query.type = type;
}
return this.find(query).sort({ createdAt: -1 });
};

// Static method to find by status
summarySchema.statics.findByStatus = function(status) {
return this.find({ status });
};

// Static method to find pending summaries
summarySchema.statics.findPending = function() {
return this.find({ status: 'pending' }).sort({ createdAt: 1 });
};

// Static method to search summaries
summarySchema.statics.searchSummaries = function(query, userId) {
const searchQuery = {
  $and: [
    {
      $or: [
        { 'content.summary': { $regex: query, $options: 'i' } },
        { 'content.keyPoints.title': { $regex: query, $options: 'i' } },
        { 'content.keyPoints.description': { $regex: query, $options: 'i' } },
        { 'content.actionItems.task': { $regex: query, $options: 'i' } },
        { 'content.decisions.decision': { $regex: query, $options: 'i' } }
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
summarySchema.index({ meetingId: 1, type: 1 });
summarySchema.index({ status: 1 });
summarySchema.index({ 'content.summary': 'text' });
summarySchema.index({ 'content.keyPoints.title': 'text' });
summarySchema.index({ 'content.actionItems.task': 'text' });
summarySchema.index({ createdAt: -1 });
summarySchema.index({ 'sharing.publicLink.token': 1 });

const Summary = mongoose.model('Summary', summarySchema);

module.exports = Summary;