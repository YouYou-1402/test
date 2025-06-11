// backend/src/middleware/validation.js
/**
 * Validation Middleware
 * Request validation using Joi and custom validators
 */

const Joi = require('joi');
const { AppError, sendValidationError } = require('./errorHandler');
const mongoose = require('mongoose');

// Custom Joi extensions
const customJoi = Joi.extend((joi) => ({
type: 'objectId',
base: joi.string(),
messages: {
  'objectId.invalid': '{{#label}} must be a valid ObjectId'
},
validate(value, helpers) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return { value, errors: helpers.error('objectId.invalid') };
  }
}
}));

// Common validation schemas
const commonSchemas = {
objectId: customJoi.objectId().required(),
optionalObjectId: customJoi.objectId(),
email: Joi.string().email().lowercase().trim(),
password: Joi.string().min(6).max(128),
phone: Joi.string().pattern(/^[\+]?[1-9][\d]{0,15}$/),
url: Joi.string().uri(),
language: Joi.string().valid('en', 'vi', 'zh', 'ja', 'ko'),
timezone: Joi.string(),
pagination: {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sort: Joi.string().default('-createdAt'),
  fields: Joi.string()
}
};

// User validation schemas
const userSchemas = {
register: Joi.object({
  firstName: Joi.string().trim().min(1).max(50).required(),
  lastName: Joi.string().trim().min(1).max(50).required(),
  email: commonSchemas.email.required(),
  password: commonSchemas.password.required(),
  confirmPassword: Joi.string().valid(Joi.ref('password')).required()
    .messages({ 'any.only': 'Passwords must match' }),
  organization: Joi.string().trim().max(100),
  phone: commonSchemas.phone
}),

login: Joi.object({
  email: commonSchemas.email.required(),
  password: Joi.string().required()
}),

forgotPassword: Joi.object({
  email: commonSchemas.email.required()
}),

resetPassword: Joi.object({
  token: Joi.string().required(),
  password: commonSchemas.password.required(),
  confirmPassword: Joi.string().valid(Joi.ref('password')).required()
}),

changePassword: Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: commonSchemas.password.required(),
  confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required()
}),

updateProfile: Joi.object({
  firstName: Joi.string().trim().min(1).max(50),
  lastName: Joi.string().trim().min(1).max(50),
  phone: commonSchemas.phone,
  organization: Joi.string().trim().max(100),
  avatar: Joi.string().uri()
}),

updatePreferences: Joi.object({
  language: commonSchemas.language,
  timezone: commonSchemas.timezone,
  notifications: Joi.object({
    email: Joi.boolean(),
    transcriptionComplete: Joi.boolean(),
    summaryReady: Joi.boolean(),
    weeklyReport: Joi.boolean()
  }),
  aiServices: Joi.object({
    preferredSTT: Joi.string().valid('fpt', 'whisper', 'google', 'auto'),
    preferredLLM: Joi.string().valid('openai', 'claude', 'local', 'auto'),
    summaryStyle: Joi.string().valid('brief', 'detailed', 'bullet-points', 'executive')
  })
})
};

// Meeting validation schemas
const meetingSchemas = {
create: Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().trim().max(1000),
  meetingDate: Joi.date().iso().required(),
  duration: Joi.number().integer().min(0),
  participants: Joi.array().items(
    Joi.object({
      name: Joi.string().trim().required(),
      email: commonSchemas.email,
      role: Joi.string().valid('host', 'presenter', 'participant', 'observer').default('participant')
    })
  ),
  type: Joi.string().valid('recorded', 'live', 'uploaded').required(),
  source: Joi.string().valid('zoom', 'google-meet', 'teams', 'webrtc', 'upload', 'phone').required(),
  language: commonSchemas.language.default('auto'),
  category: Joi.string().valid(
    'business', 'education', 'healthcare', 'legal', 'technology', 
    'finance', 'marketing', 'hr', 'other'
  ).default('business'),
  tags: Joi.array().items(Joi.string().trim().lowercase()),
  privacy: Joi.object({
    level: Joi.string().valid('private', 'organization', 'public').default('private')
  })
}),

update: Joi.object({
  title: Joi.string().trim().min(1).max(200),
  description: Joi.string().trim().max(1000),
  meetingDate: Joi.date().iso(),
  duration: Joi.number().integer().min(0),
  participants: Joi.array().items(
    Joi.object({
      name: Joi.string().trim().required(),
      email: commonSchemas.email,
      role: Joi.string().valid('host', 'presenter', 'participant', 'observer')
    })
  ),
  category: Joi.string().valid(
    'business', 'education', 'healthcare', 'legal', 'technology', 
    'finance', 'marketing', 'hr', 'other'
  ),
  tags: Joi.array().items(Joi.string().trim().lowercase()),
  privacy: Joi.object({
    level: Joi.string().valid('private', 'organization', 'public')
  })
}),

query: Joi.object({
  ...commonSchemas.pagination,
  status: Joi.string().valid(
    'created', 'uploading', 'uploaded', 'processing', 
    'transcribing', 'summarizing', 'completed', 'failed', 'cancelled'
  ),
  category: Joi.string().valid(
    'business', 'education', 'healthcare', 'legal', 'technology', 
    'finance', 'marketing', 'hr', 'other'
  ),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
  search: Joi.string().trim().min(1).max(100)
}),

share: Joi.object({
  userId: commonSchemas.objectId,
  email: commonSchemas.email,
  permission: Joi.string().valid('view', 'edit', 'admin').default('view')
}).xor('userId', 'email')
};

// Transcript validation schemas
const transcriptSchemas = {
update: Joi.object({
  segments: Joi.array().items(
    Joi.object({
      id: Joi.string().required(),
      startTime: Joi.number().min(0).required(),
      endTime: Joi.number().min(Joi.ref('startTime')).required(),
      text: Joi.string().trim().required(),
      speaker: Joi.object({
        id: Joi.string(),
        name: Joi.string().trim(),
        confidence: Joi.number().min(0).max(100)
      }),
      confidence: Joi.number().min(0).max(100).required()
    })
  ),
  speakers: Joi.array().items(
    Joi.object({
      id: Joi.string().required(),
      name: Joi.string().trim(),
      participantEmail: commonSchemas.email
    })
  )
}),

addEdit: Joi.object({
  segmentId: Joi.string().required(),
  originalText: Joi.string().required(),
  correctedText: Joi.string().required(),
  editType: Joi.string().valid('correction', 'speaker-change', 'timestamp-adjustment', 'deletion', 'addition').required(),
  reason: Joi.string().max(500)
}),

export: Joi.object({
  format: Joi.string().valid('txt', 'srt', 'vtt', 'json', 'csv').required(),
  includeTimestamps: Joi.boolean().default(true),
  includeSpeakers: Joi.boolean().default(true),
  includeConfidence: Joi.boolean().default(false),
  timeFormat: Joi.string().valid('seconds', 'hms', 'milliseconds').default('hms')
})
};

// Summary validation schemas
const summarySchemas = {
create: Joi.object({
  meetingId: commonSchemas.objectId.required(),
  type: Joi.string().valid(
    'executive', 'detailed', 'brief', 'bullet-points', 
    'action-items', 'key-decisions', 'custom'
  ).required(),
  style: Joi.string().valid('formal', 'casual', 'technical', 'executive', 'narrative').default('formal'),
  language: commonSchemas.language.default('en'),
  config: Joi.object({
    temperature: Joi.number().min(0).max(2).default(0.7),
    maxTokens: Joi.number().integer().min(100).max(4000).default(2000),
    includeTimestamps: Joi.boolean().default(true),
    includeSpeakers: Joi.boolean().default(true),
    focusAreas: Joi.array().items(Joi.string().trim()),
    excludeAreas: Joi.array().items(Joi.string().trim()),
    customInstructions: Joi.string().max(1000)
  })
}),

update: Joi.object({
  content: Joi.object({
    summary: Joi.string().trim(),
    executive: Joi.string().trim(),
    keyPoints: Joi.array().items(
      Joi.object({
        title: Joi.string().trim().required(),
        description: Joi.string().trim().required(),
        importance: Joi.string().valid('high', 'medium', 'low').default('medium')
      })
    ),
    actionItems: Joi.array().items(
      Joi.object({
        task: Joi.string().trim().required(),
        assignee: Joi.object({
          name: Joi.string().trim(),
          email: commonSchemas.email
        }),
        deadline: Joi.date().iso(),
        priority: Joi.string().valid('high', 'medium', 'low').default('medium'),
        description: Joi.string().trim()
      })
    ),
    decisions: Joi.array().items(
      Joi.object({
        decision: Joi.string().trim().required(),
        context: Joi.string().trim(),
        impact: Joi.string().valid('high', 'medium', 'low').default('medium')
      })
    )
  })
}),

feedback: Joi.object({
  rating: Joi.number().integer().min(1).max(5).required(),
  comments: Joi.string().trim().max(1000),
  helpful: Joi.boolean(),
  accuracy: Joi.number().integer().min(1).max(5),
  completeness: Joi.number().integer().min(1).max(5)
}),

share: Joi.object({
  userId: commonSchemas.objectId,
  email: commonSchemas.email,
  permission: Joi.string().valid('view', 'comment', 'edit').default('view')
}).xor('userId', 'email'),

export: Joi.object({
  format: Joi.string().valid('docx', 'pdf', 'html', 'markdown').required(),
  template: Joi.string().default('default'),
  includeSummary: Joi.boolean().default(true),
  includeKeyPoints: Joi.boolean().default(true),
  includeActionItems: Joi.boolean().default(true),
  includeDecisions: Joi.boolean().default(true),
  includeInsights: Joi.boolean().default(false),
  includeTimestamps: Joi.boolean().default(false)
})
};

// Integration validation schemas
const integrationSchemas = {
zoom: Joi.object({
  meetingId: Joi.string().required(),
  passcode: Joi.string(),
  recordingUrl: Joi.string().uri()
}),

googleMeet: Joi.object({
  meetingId: Joi.string().required(),
  recordingUrl: Joi.string().uri()
}),

teams: Joi.object({
  meetingId: Joi.string().required(),
  recordingUrl: Joi.string().uri()
})
};

// Validation middleware factory
const validate = (schema, source = 'body') => {
return (req, res, next) => {
  const data = req[source];
  
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });
  
  if (error) {
    const errors = {};
    error.details.forEach(detail => {
      const key = detail.path.join('.');
      errors[key] = detail.message;
    });
    
    return sendValidationError(res, errors);
  }
  
  // Replace the original data with validated and sanitized data
  req[source] = value;
  next();
};
};

// Validate query parameters
const validateQuery = (schema) => validate(schema, 'query');

// Validate request parameters
const validateParams = (schema) => validate(schema, 'params');

// Custom validation functions
const customValidators = {
// Validate ObjectId parameter
validateObjectId: (paramName = 'id') => {
  return (req, res, next) => {
    const id = req.params[paramName];
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError(`Invalid ${paramName}`, 400));
    }
    
    next();
  };
},

// Validate file upload
validateFileUpload: (allowedTypes = [], maxSize = 100 * 1024 * 1024) => {
  return (req, res, next) => {
    if (!req.file && !req.files) {
      return next(new AppError('No file uploaded', 400));
    }
    
    const files = req.files || [req.file];
    
    for (const file of files) {
      // Check file type
      if (allowedTypes.length > 0) {
        const isAllowed = allowedTypes.some(type => 
          file.mimetype.startsWith(type) || file.mimetype === type
        );
        
        if (!isAllowed) {
          return next(new AppError(`File type not allowed. Allowed types: ${allowedTypes.join(', ')}`, 400));
        }
      }
      
      // Check file size
      if (file.size > maxSize) {
        const maxSizeMB = Math.round(maxSize / (1024 * 1024));
        return next(new AppError(`File too large. Maximum size: ${maxSizeMB}MB`, 400));
      }
    }
    
    next();
  };
},

  // Validate date range
  validateDateRange: (startField = 'dateFrom', endField = 'dateTo') => {
    return (req, res, next) => {
      const startDate = req.query[startField] || req.body[startField];
      const endDate = req.query[endField] || req.body[endField];
      
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (start >= end) {
          return next(new AppError(`${endField} must be after ${startField}`, 400));
        }
      }
      
      next();
    };
  },
  
  // Validate pagination
  validatePagination: (req, res, next) => {
    const { page = 1, limit = 10 } = req.query;
    
    req.query.page = Math.max(1, parseInt(page));
    req.query.limit = Math.min(100, Math.max(1, parseInt(limit)));
    
    next();
  },
  
  // Validate search query
  validateSearch: (minLength = 1, maxLength = 100) => {
    return (req, res, next) => {
      const { search } = req.query;
      
      if (search) {
        if (search.length < minLength || search.length > maxLength) {
          return next(new AppError(`Search query must be between ${minLength} and ${maxLength} characters`, 400));
        }
        
        // Sanitize search query
        req.query.search = search.trim().replace(/[<>]/g, '');
      }
      
      next();
    };
  }
};

// Sanitization helpers
const sanitizers = {
  // Sanitize HTML input
  sanitizeHtml: (input) => {
    if (typeof input !== 'string') return input;
    
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  },
  
  // Sanitize SQL injection attempts
  sanitizeSql: (input) => {
    if (typeof input !== 'string') return input;
    
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi,
      /(;|--|\/\*|\*\/|xp_|sp_)/gi
    ];
    
    return sqlPatterns.reduce((str, pattern) => str.replace(pattern, ''), input);
  },
  
  // Sanitize NoSQL injection attempts
  sanitizeNoSql: (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    
    const sanitized = {};
    
    for (const [key, value] of Object.entries(obj)) {
      // Remove MongoDB operators
      if (key.startsWith('$')) continue;
      
      if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizers.sanitizeNoSql(value);
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }
};

// Rate limiting validation
const rateLimitSchemas = {
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: 'Too many authentication attempts, please try again later'
  },
  
  upload: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 uploads per hour
    message: 'Upload limit exceeded, please try again later'
  },
  
  api: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: 'API rate limit exceeded'
  }
};

module.exports = {
  // Schemas
  commonSchemas,
  userSchemas,
  meetingSchemas,
  transcriptSchemas,
  summarySchemas,
  integrationSchemas,
  rateLimitSchemas,
  
  // Middleware
  validate,
  validateQuery,
  validateParams,
  
  // Custom validators
  ...customValidators,
  
  // Sanitizers
  sanitizers,
  
  // Joi instance
  Joi: customJoi
};
