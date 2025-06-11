// backend/src/models/User.js
/**
 * User Model
 * Mongoose schema for user authentication and profile management
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema({
// Basic Information
email: {
  type: String,
  required: [true, 'Email is required'],
  unique: true,
  lowercase: true,
  trim: true,
  match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
},

password: {
  type: String,
  required: [true, 'Password is required'],
  minlength: [6, 'Password must be at least 6 characters'],
  select: false // Don't include password in queries by default
},

firstName: {
  type: String,
  required: [true, 'First name is required'],
  trim: true,
  maxlength: [50, 'First name cannot exceed 50 characters']
},

lastName: {
  type: String,
  required: [true, 'Last name is required'],
  trim: true,
  maxlength: [50, 'Last name cannot exceed 50 characters']
},

// Profile Information
avatar: {
  type: String,
  default: null
},

phone: {
  type: String,
  trim: true,
  match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please enter a valid phone number']
},

organization: {
  type: String,
  trim: true,
  maxlength: [100, 'Organization name cannot exceed 100 characters']
},

role: {
  type: String,
  enum: ['admin', 'user', 'premium'],
  default: 'user'
},

// Account Status
isActive: {
  type: Boolean,
  default: true
},

isEmailVerified: {
  type: Boolean,
  default: false
},

emailVerificationToken: {
  type: String,
  select: false
},

emailVerificationExpires: {
  type: Date,
  select: false
},

// Password Reset
passwordResetToken: {
  type: String,
  select: false
},

passwordResetExpires: {
  type: Date,
  select: false
},

passwordChangedAt: {
  type: Date,
  select: false
},

// Preferences
preferences: {
  language: {
    type: String,
    enum: ['en', 'vi', 'zh', 'ja', 'ko'],
    default: 'en'
  },
  
  timezone: {
    type: String,
    default: 'UTC'
  },
  
  notifications: {
    email: {
      type: Boolean,
      default: true
    },
    transcriptionComplete: {
      type: Boolean,
      default: true
    },
    summaryReady: {
      type: Boolean,
      default: true
    },
    weeklyReport: {
      type: Boolean,
      default: false
    }
  },
  
  aiServices: {
    preferredSTT: {
      type: String,
      enum: ['fpt', 'whisper', 'google', 'auto'],
      default: 'auto'
    },
    
    preferredLLM: {
      type: String,
      enum: ['openai', 'claude', 'local', 'auto'],
      default: 'auto'
    },
    
    summaryStyle: {
      type: String,
      enum: ['brief', 'detailed', 'bullet-points', 'executive'],
      default: 'detailed'
    }
  }
},

// API Keys (encrypted)
apiKeys: {
  openai: {
    type: String,
    select: false
  },
  
  fptAI: {
    type: String,
    select: false
  },
  
  googleCloud: {
    type: String,
    select: false
  }
},

// Usage Statistics
usage: {
  totalMeetings: {
    type: Number,
    default: 0
  },
  
  totalTranscriptionMinutes: {
    type: Number,
    default: 0
  },
  
  totalSummaries: {
    type: Number,
    default: 0
  },
  
  storageUsed: {
    type: Number,
    default: 0 // in bytes
  },
  
  lastActivity: {
    type: Date,
    default: Date.now
  }
},

// Subscription Information
subscription: {
  plan: {
    type: String,
    enum: ['free', 'basic', 'premium', 'enterprise'],
    default: 'free'
  },
  
  status: {
    type: String,
    enum: ['active', 'cancelled', 'expired', 'trial'],
    default: 'active'
  },
  
  startDate: {
    type: Date,
    default: Date.now
  },
  
  endDate: {
    type: Date
  },
  
  limits: {
    monthlyMinutes: {
      type: Number,
      default: 60 // Free plan: 60 minutes per month
    },
    
    storageGB: {
      type: Number,
      default: 1 // Free plan: 1GB storage
    },
    
    aiRequests: {
      type: Number,
      default: 100 // Free plan: 100 AI requests per month
    }
  }
}
}, {
timestamps: true,
toJSON: { virtuals: true },
toObject: { virtuals: true }
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
return `${this.firstName} ${this.lastName}`;
});

// Virtual for meetings
userSchema.virtual('meetings', {
ref: 'Meeting',
localField: '_id',
foreignField: 'userId'
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
// Only hash password if it's modified
if (!this.isModified('password')) return next();

try {
  // Hash password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);
  next();
} catch (error) {
  next(error);
}
});

// Pre-save middleware to set passwordChangedAt
userSchema.pre('save', function(next) {
if (!this.isModified('password') || this.isNew) return next();

this.passwordChangedAt = Date.now() - 1000; // Subtract 1 second to ensure token is created after password change
next();
});

// Instance method to check password
userSchema.methods.comparePassword = async function(candidatePassword) {
return await bcrypt.compare(candidatePassword, this.password);
};

// Instance method to generate JWT token
userSchema.methods.generateAuthToken = function() {
const payload = {
  id: this._id,
  email: this.email,
  role: this.role
};

return jwt.sign(payload, process.env.JWT_SECRET, {
  expiresIn: process.env.JWT_EXPIRES_IN || '7d'
});
};

// Instance method to generate refresh token
userSchema.methods.generateRefreshToken = function() {
const payload = {
  id: this._id,
  type: 'refresh'
};

return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
  expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
});
};

// Instance method to check if password was changed after JWT was issued
userSchema.methods.changedPasswordAfter = function(JWTTimestamp) {
if (this.passwordChangedAt) {
  const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
  return JWTTimestamp < changedTimestamp;
}

return false;
};

// Instance method to create password reset token
userSchema.methods.createPasswordResetToken = function() {
const resetToken = require('crypto').randomBytes(32).toString('hex');

this.passwordResetToken = require('crypto')
  .createHash('sha256')
  .update(resetToken)
  .digest('hex');

this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

return resetToken;
};

// Instance method to create email verification token
userSchema.methods.createEmailVerificationToken = function() {
const verificationToken = require('crypto').randomBytes(32).toString('hex');

this.emailVerificationToken = require('crypto')
  .createHash('sha256')
  .update(verificationToken)
  .digest('hex');

this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

return verificationToken;
};

// Static method to find by email
userSchema.statics.findByEmail = function(email) {
return this.findOne({ email: email.toLowerCase() });
};

// Static method to find active users
userSchema.statics.findActive = function() {
return this.find({ isActive: true });
};

// Index for better performance
userSchema.index({ email: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ 'usage.lastActivity': -1 });
userSchema.index({ 'subscription.plan': 1, 'subscription.status': 1 });

const User = mongoose.model('User', userSchema);

module.exports = User;