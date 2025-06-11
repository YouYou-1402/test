// backend/src/models/Meeting.js
/**
 * Meeting Model
 * Mongoose schema for meeting records and metadata
 */

const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
// Basic Information
title: {
  type: String,
  required: [true, 'Meeting title is required'],
  trim: true,
  maxlength: [200, 'Meeting title cannot exceed 200 characters']
},

description: {
  type: String,
  trim: true,
  maxlength: [1000, 'Meeting description cannot exceed 1000 characters']
},

// User and Organization
userId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  required: [true, 'User ID is required']
},

organizationId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Organization',
  default: null
},

// Meeting Details
meetingDate: {
  type: Date,
  required: [true, 'Meeting date is required']
},

duration: {
  type: Number, // in minutes
  min: [0, 'Duration cannot be negative']
},

participants: [{
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  role: {
    type: String,
    enum: ['host', 'presenter', 'participant', 'observer'],
    default: 'participant'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}],

// Meeting Type and Source
type: {
  type: String,
  enum: ['recorded', 'live', 'uploaded'],
  required: true
},

source: {
  type: String,
  enum: ['zoom', 'google-meet', 'teams', 'webrtc', 'upload', 'phone'],
  required: true
},

// Integration Details
integrationData: {
  meetingId: String, // External meeting ID (Zoom, Meet, etc.)
  joinUrl: String,
  recordingUrl: String,
  platform: String,
  hostId: String
},

// File Information
files: {
  audio: {
    originalFile: {
      filename: String,
      path: String,
      size: Number, // in bytes
      mimeType: String,
      uploadedAt: Date
    },
    
    processedFile: {
      filename: String,
      path: String,
      size: Number,
      format: String, // wav, mp3, etc.
      duration: Number, // in seconds
      sampleRate: Number,
      channels: Number,
      processedAt: Date
    }
  },
  
  video: {
    originalFile: {
      filename: String,
      path: String,
      size: Number,
      mimeType: String,
      uploadedAt: Date
    },
    
    processedFile: {
      filename: String,
      path: String,
      size: Number,
      format: String,
      duration: Number,
      resolution: String,
      processedAt: Date
    }
  }
},

// Processing Status
status: {
  type: String,
  enum: [
    'created',
    'uploading',
    'uploaded', 
    'processing',
    'transcribing',
    'summarizing',
    'completed',
    'failed',
    'cancelled'
  ],
  default: 'created'
},

processingSteps: {
  upload: {
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'failed'],
      default: 'pending'
    },
    startedAt: Date,
    completedAt: Date,
    error: String
  },
  
  audioProcessing: {
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'failed'],
      default: 'pending'
    },
    startedAt: Date,
    completedAt: Date,
    error: String
  },
  
  transcription: {
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'failed'],
      default: 'pending'
    },
    service: String, // fpt, whisper, google, etc.
    startedAt: Date,
    completedAt: Date,
    error: String,
    confidence: Number
  },
  
  summarization: {
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'failed'],
      default: 'pending'
    },
    service: String, // openai, claude, etc.
    startedAt: Date,
    completedAt: Date,
    error: String
  }
},

// Quality and Metrics
quality: {
  audioQuality: {
    type: String,
    enum: ['excellent', 'good', 'fair', 'poor'],
    default: 'good'
  },
  
  transcriptionAccuracy: {
    type: Number,
    min: 0,
    max: 100 // percentage
  },
  
  noiseLevel: {
    type: String,
    enum: ['low', 'medium', 'high']
  },
  
  speakerClarity: {
    type: Number,
    min: 0,
    max: 10
  }
},

// Language and Localization
language: {
  detected: {
    type: String,
    default: 'en'
  },
  
  specified: {
    type: String,
    default: 'auto'
  },
  
  confidence: {
    type: Number,
    min: 0,
    max: 100
  }
},

// Tags and Categories
tags: [{
  type: String,
  trim: true,
  lowercase: true
}],

category: {
  type: String,
  enum: [
    'business',
    'education',
    'healthcare',
    'legal',
    'technology',
    'finance',
    'marketing',
    'hr',
    'other'
  ],
  default: 'business'
},

// Privacy and Sharing
privacy: {
  level: {
    type: String,
    enum: ['private', 'organization', 'public'],
    default: 'private'
  },
  
  sharedWith: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    permission: {
      type: String,
      enum: ['view', 'edit', 'admin'],
      default: 'view'
    },
    sharedAt: {
      type: Date,
      default: Date.now
    }
  }]
},

// Export History
exports: [{
  format: {
    type: String,
    enum: ['docx', 'pdf', 'txt', 'json'],
    required: true
  },
  
  template: {
    type: String,
    default: 'standard'
  },
  
  filename: String,
  path: String,
  size: Number,
  
  exportedAt: {
    type: Date,
    default: Date.now
  },
  
  exportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}],

// Analytics
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
    duration: Number // seconds spent viewing
  }]
},

// Metadata
metadata: {
  createdBy: {
    type: String,
    default: 'user'
  },
  
  version: {
    type: Number,
    default: 1
  },
  
  isDeleted: {
    type: Boolean,
    default: false
  },
  
  deletedAt: Date,
  
  archivedAt: Date
}
}, {
timestamps: true,
toJSON: { virtuals: true },
toObject: { virtuals: true }
});

// Virtual for transcript
meetingSchema.virtual('transcript', {
ref: 'Transcript',
localField: '_id',
foreignField: 'meetingId',
justOne: true
});

// Virtual for summaries
meetingSchema.virtual('summaries', {
ref: 'Summary',
localField: '_id',
foreignField: 'meetingId'
});

// Virtual for total file size
meetingSchema.virtual('totalFileSize').get(function() {
let total = 0;

if (this.files.audio.originalFile?.size) {
  total += this.files.audio.originalFile.size;
}

if (this.files.audio.processedFile?.size) {
  total += this.files.audio.processedFile.size;
}

if (this.files.video.originalFile?.size) {
  total += this.files.video.originalFile.size;
}

if (this.files.video.processedFile?.size) {
  total += this.files.video.processedFile.size;
}

return total;
});

// Virtual for processing progress
meetingSchema.virtual('processingProgress').get(function() {
const steps = ['upload', 'audioProcessing', 'transcription', 'summarization'];
const completed = steps.filter(step => 
  this.processingSteps[step]?.status === 'completed'
).length;

return Math.round((completed / steps.length) * 100);
});

// Pre-save middleware to update analytics
meetingSchema.pre('save', function(next) {
if (this.isModified('analytics.views')) {
  this.analytics.lastViewedAt = new Date();
}
next();
});

// Instance method to add participant
meetingSchema.methods.addParticipant = function(participant) {
// Check if participant already exists
const existingParticipant = this.participants.find(p => 
  p.email === participant.email || 
  (p.userId && p.userId.toString() === participant.userId?.toString())
);

if (!existingParticipant) {
  this.participants.push(participant);
  return this.save();
}

return Promise.resolve(this);
};

// Instance method to update processing step
meetingSchema.methods.updateProcessingStep = function(step, status, error = null) {
if (!this.processingSteps[step]) {
  return Promise.reject(new Error(`Invalid processing step: ${step}`));
}

this.processingSteps[step].status = status;

if (status === 'in-progress' && !this.processingSteps[step].startedAt) {
  this.processingSteps[step].startedAt = new Date();
}

if (status === 'completed' || status === 'failed') {
  this.processingSteps[step].completedAt = new Date();
}

if (error) {
  this.processingSteps[step].error = error;
}

// Update overall status
this.updateOverallStatus();

return this.save();
};

// Instance method to update overall status
meetingSchema.methods.updateOverallStatus = function() {
const steps = this.processingSteps;

// Check if any step failed
const failedSteps = Object.values(steps).filter(step => step.status === 'failed');
if (failedSteps.length > 0) {
  this.status = 'failed';
  return;
}

// Check if all steps completed
const completedSteps = Object.values(steps).filter(step => step.status === 'completed');
if (completedSteps.length === 4) {
  this.status = 'completed';
  return;
}

// Check current processing step
if (steps.summarization.status === 'in-progress') {
  this.status = 'summarizing';
} else if (steps.transcription.status === 'in-progress') {
  this.status = 'transcribing';
} else if (steps.audioProcessing.status === 'in-progress') {
  this.status = 'processing';
} else if (steps.upload.status === 'in-progress') {
  this.status = 'uploading';
}
};

// Static method to find by user
meetingSchema.statics.findByUser = function(userId, options = {}) {
const query = { 
  userId,
  'metadata.isDeleted': { $ne: true }
};

let mongoQuery = this.find(query);

if (options.populate) {
  mongoQuery = mongoQuery.populate('transcript summaries');
}

if (options.sort) {
  mongoQuery = mongoQuery.sort(options.sort);
} else {
  mongoQuery = mongoQuery.sort({ createdAt: -1 });
}

if (options.limit) {
  mongoQuery = mongoQuery.limit(options.limit);
}

return mongoQuery;
};

// Static method to find by status
meetingSchema.statics.findByStatus = function(status) {
return this.find({ 
  status,
  'metadata.isDeleted': { $ne: true }
});
};

// Indexes for better performance
meetingSchema.index({ userId: 1, createdAt: -1 });
meetingSchema.index({ status: 1 });
meetingSchema.index({ meetingDate: -1 });
meetingSchema.index({ 'integrationData.meetingId': 1 });
meetingSchema.index({ tags: 1 });
meetingSchema.index({ category: 1 });
meetingSchema.index({ 'metadata.isDeleted': 1 });

const Meeting = mongoose.model('Meeting', meetingSchema);

module.exports = Meeting;