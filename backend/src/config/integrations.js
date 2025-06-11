// backend/src/config/integrations.js
/**
 * Integrations Configuration
 * Third-party service integrations (Zoom, Google Meet, Teams, etc.)
 */

const logger = require('../utils/logger');

// Zoom Integration Configuration
const zoomConfig = {
enabled: process.env.ZOOM_INTEGRATION_ENABLED === 'true',

// OAuth Configuration
oauth: {
  clientId: process.env.ZOOM_CLIENT_ID,
  clientSecret: process.env.ZOOM_CLIENT_SECRET,
  redirectUri: process.env.ZOOM_REDIRECT_URI || `${process.env.BASE_URL}/api/integrations/zoom/callback`,
  scopes: ['meeting:read', 'recording:read', 'user:read'],
  
  // OAuth URLs
  authUrl: 'https://zoom.us/oauth/authorize',
  tokenUrl: 'https://zoom.us/oauth/token',
  revokeUrl: 'https://zoom.us/oauth/revoke'
},

// API Configuration
api: {
  baseUrl: 'https://api.zoom.us/v2',
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000
},

// Webhook Configuration
webhook: {
  endpoint: '/api/integrations/zoom/webhook',
  secretToken: process.env.ZOOM_WEBHOOK_SECRET,
  verificationToken: process.env.ZOOM_VERIFICATION_TOKEN,
  
  // Subscribed events
  events: [
    'recording.completed',
    'meeting.ended',
    'meeting.started',
    'recording.transcript_completed'
  ]
},

// Rate Limiting
rateLimit: {
  requestsPerSecond: 10,
  requestsPerDay: 100000
},

// Features
features: {
  autoDownloadRecordings: true,
  autoTranscribe: true,
  syncMeetingDetails: true,
  syncParticipants: true
}
};

// Google Meet Integration Configuration
const googleMeetConfig = {
enabled: process.env.GOOGLE_MEET_INTEGRATION_ENABLED === 'true',

// OAuth Configuration
oauth: {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || `${process.env.BASE_URL}/api/integrations/google/callback`,
  scopes: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/meetings.space.readonly'
  ],
  
  // OAuth URLs
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke'
},

// API Configuration
api: {
  calendar: {
    baseUrl: 'https://www.googleapis.com/calendar/v3',
    timeout: 30000
  },
  drive: {
    baseUrl: 'https://www.googleapis.com/drive/v3',
    timeout: 30000
  },
  meet: {
    baseUrl: 'https://www.googleapis.com/meet/v2',
    timeout: 30000
  }
},

// Webhook Configuration (using Google Cloud Pub/Sub)
webhook: {
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  subscriptionName: 'meet-recordings-subscription',
  topicName: 'meet-recordings-topic'
},

// Rate Limiting
rateLimit: {
  requestsPerSecond: 100,
  requestsPerDay: 1000000
},

// Features
features: {
  syncCalendarEvents: true,
  autoDownloadRecordings: true,
  autoTranscribe: true,
  syncMeetingDetails: true
}
};

// Microsoft Teams Integration Configuration
const teamsConfig = {
enabled: process.env.TEAMS_INTEGRATION_ENABLED === 'true',

// OAuth Configuration (Azure AD)
oauth: {
  clientId: process.env.AZURE_CLIENT_ID,
  clientSecret: process.env.AZURE_CLIENT_SECRET,
  tenantId: process.env.AZURE_TENANT_ID || 'common',
  redirectUri: process.env.AZURE_REDIRECT_URI || `${process.env.BASE_URL}/api/integrations/teams/callback`,
  scopes: [
    'https://graph.microsoft.com/OnlineMeetings.Read',
    'https://graph.microsoft.com/Calendars.Read',
    'https://graph.microsoft.com/Files.Read.All'
  ],
  
  // OAuth URLs
  authUrl: `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize`,
  tokenUrl: `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`
},

// Microsoft Graph API Configuration
api: {
  baseUrl: 'https://graph.microsoft.com/v1.0',
  betaUrl: 'https://graph.microsoft.com/beta',
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000
},

// Webhook Configuration (Microsoft Graph Subscriptions)
webhook: {
  endpoint: '/api/integrations/teams/webhook',
  notificationUrl: `${process.env.BASE_URL}/api/integrations/teams/webhook`,
  clientState: process.env.TEAMS_WEBHOOK_CLIENT_STATE,
  
  // Subscription resources
  resources: [
    '/me/onlineMeetings',
    '/me/calendar/events',
    '/me/drive/root/children'
  ]
},

// Rate Limiting
rateLimit: {
  requestsPerSecond: 10,
  requestsPerMinute: 600
},

// Features
features: {
  syncCalendarEvents: true,
  autoDownloadRecordings: true,
  autoTranscribe: true,
  syncMeetingDetails: true,
  syncChatMessages: false // Disabled by default for privacy
}
};

// Slack Integration Configuration
const slackConfig = {
enabled: process.env.SLACK_INTEGRATION_ENABLED === 'true',

// OAuth Configuration
oauth: {
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  redirectUri: process.env.SLACK_REDIRECT_URI || `${process.env.BASE_URL}/api/integrations/slack/callback`,
  scopes: [
    'channels:read',
    'chat:write',
    'files:read',
    'users:read'
  ],
  
  // OAuth URLs
  authUrl: 'https://slack.com/oauth/v2/authorize',
  tokenUrl: 'https://slack.com/api/oauth.v2.access'
},

// API Configuration
api: {
  baseUrl: 'https://slack.com/api',
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000
},

// Webhook Configuration
webhook: {
  endpoint: '/api/integrations/slack/webhook',
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  
  // Subscribed events
  events: [
    'message.channels',
    'file_shared',
    'app_mention'
  ]
},

// Bot Configuration
bot: {
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  
  // Bot features
  features: {
    sendSummaries: true,
    sendTranscripts: true,
    respondToMentions: true
  }
},

// Rate Limiting
rateLimit: {
  tier1: { requestsPerMinute: 1 },
  tier2: { requestsPerMinute: 20 },
  tier3: { requestsPerMinute: 50 },
  tier4: { requestsPerMinute: 100 }
}
};

// Email Integration Configuration
const emailConfig = {
enabled: process.env.EMAIL_INTEGRATION_ENABLED === 'true',

// SMTP Configuration
smtp: {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  
  // Connection options
  connectionTimeout: 60000,
  greetingTimeout: 30000,
  socketTimeout: 60000
},

// Email Templates
templates: {
  transcriptionComplete: {
    subject: 'Meeting Transcription Complete - {{meetingTitle}}',
    template: 'transcription-complete'
  },
  summaryReady: {
    subject: 'Meeting Summary Ready - {{meetingTitle}}',
    template: 'summary-ready'
  },
  weeklyReport: {
    subject: 'Weekly Meeting Report - {{dateRange}}',
    template: 'weekly-report'
  },
  shareInvitation: {
    subject: 'Meeting Shared With You - {{meetingTitle}}',
    template: 'share-invitation'
  }
},

// Rate Limiting
rateLimit: {
  emailsPerMinute: 10,
  emailsPerHour: 100,
  emailsPerDay: 1000
}
};

// Calendar Integration Configuration
const calendarConfig = {
enabled: process.env.CALENDAR_INTEGRATION_ENABLED === 'true',

// Supported providers
providers: {
  google: {
    enabled: process.env.GOOGLE_CALENDAR_ENABLED === 'true',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly']
  },
  outlook: {
    enabled: process.env.OUTLOOK_CALENDAR_ENABLED === 'true',
    scopes: ['https://graph.microsoft.com/Calendars.Read']
  },
  apple: {
    enabled: process.env.APPLE_CALENDAR_ENABLED === 'true',
    // Apple Calendar integration would require different approach
  }
},

// Sync Configuration
sync: {
  intervalMinutes: 15,
  lookAheadDays: 7,
  lookBackDays: 1,
  autoCreateMeetings: true,
  syncRecurringEvents: true,
  ignoreAllDayEvents: true,
  
  // Meeting detection keywords
  meetingKeywords: [
    'meeting', 'call', 'conference', 'discussion', 'standup',
    'review', 'sync', 'catchup', 'demo', 'presentation'
  ]
}
};

// Cloud Storage Integration Configuration
const cloudStorageConfig = {
enabled: process.env.CLOUD_STORAGE_INTEGRATION_ENABLED === 'true',

// Google Drive
googleDrive: {
  enabled: process.env.GOOGLE_DRIVE_ENABLED === 'true',
  scopes: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.readonly'
  ],
  
  // Folder structure
  folders: {
    root: 'Meeting Transcriptions',
    recordings: 'Recordings',
    transcripts: 'Transcripts',
    summaries: 'Summaries'
  },
  
  // File sharing settings
  sharing: {
    defaultPermission: 'reader',
    allowPublicSharing: false,
    domainRestriction: process.env.GOOGLE_DRIVE_DOMAIN_RESTRICTION
  }
},

// OneDrive/SharePoint
oneDrive: {
  enabled: process.env.ONEDRIVE_ENABLED === 'true',
  scopes: [
    'https://graph.microsoft.com/Files.ReadWrite',
    'https://graph.microsoft.com/Sites.ReadWrite.All'
  ],
  
  // Folder structure
  folders: {
    root: 'Meeting Transcriptions',
    recordings: 'Recordings',
    transcripts: 'Transcripts',
    summaries: 'Summaries'
  }
},

// Dropbox
dropbox: {
  enabled: process.env.DROPBOX_ENABLED === 'true',
  appKey: process.env.DROPBOX_APP_KEY,
  appSecret: process.env.DROPBOX_APP_SECRET,
  
  // Folder structure
  folders: {
    root: '/Meeting Transcriptions',
    recordings: '/Recordings',
    transcripts: '/Transcripts',
    summaries: '/Summaries'
  }
}
};

// CRM Integration Configuration
const crmConfig = {
enabled: process.env.CRM_INTEGRATION_ENABLED === 'true',

// Salesforce
salesforce: {
  enabled: process.env.SALESFORCE_ENABLED === 'true',
  
  // OAuth Configuration
  oauth: {
    clientId: process.env.SALESFORCE_CLIENT_ID,
    clientSecret: process.env.SALESFORCE_CLIENT_SECRET,
    redirectUri: process.env.SALESFORCE_REDIRECT_URI,
    loginUrl: process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com',
    
    scopes: ['api', 'refresh_token', 'offline_access']
  },
  
  // API Configuration
  api: {
    version: 'v58.0',
    timeout: 30000
  },
  
  // Sync Configuration
  sync: {
    createActivities: true,
    linkToContacts: true,
    linkToOpportunities: true,
    updateLastActivityDate: true
  }
},

// HubSpot
hubspot: {
  enabled: process.env.HUBSPOT_ENABLED === 'true',
  
  // OAuth Configuration
  oauth: {
    clientId: process.env.HUBSPOT_CLIENT_ID,
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET,
    redirectUri: process.env.HUBSPOT_REDIRECT_URI,
    scopes: ['contacts', 'timeline']
  },
  
  // API Configuration
  api: {
    baseUrl: 'https://api.hubapi.com',
    timeout: 30000
  },
  
  // Sync Configuration
  sync: {
    createEngagements: true,
    linkToContacts: true,
    linkToDeals: true,
    createNotes: true
  }
}
};

// Notification Services Configuration
const notificationConfig = {
enabled: process.env.NOTIFICATIONS_ENABLED === 'true',

// Push Notifications (Firebase)
push: {
  enabled: process.env.PUSH_NOTIFICATIONS_ENABLED === 'true',
  
  // Firebase Configuration
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    databaseURL: process.env.FIREBASE_DATABASE_URL
  },
  
  // Notification types
  types: {
    transcriptionComplete: {
      title: 'Transcription Complete',
      body: 'Your meeting transcription is ready',
      icon: '/icons/transcription-complete.png'
    },
    summaryReady: {
      title: 'Summary Ready',
      body: 'Your meeting summary has been generated',
      icon: '/icons/summary-ready.png'
    },
    meetingReminder: {
      title: 'Meeting Reminder',
      body: 'You have a meeting starting in 15 minutes',
      icon: '/icons/meeting-reminder.png'
    }
  }
},

// SMS Notifications (Twilio)
sms: {
  enabled: process.env.SMS_NOTIFICATIONS_ENABLED === 'true',
  
  // Twilio Configuration
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_FROM_NUMBER
  },
  
  // Rate Limiting
  rateLimit: {
    messagesPerMinute: 5,
    messagesPerHour: 50,
    messagesPerDay: 200
  }
},

// Webhook Notifications
webhook: {
  enabled: process.env.WEBHOOK_NOTIFICATIONS_ENABLED === 'true',
  
  // Default webhook settings
  timeout: 10000,
  retryAttempts: 3,
  retryDelay: 1000,
  
  // Security
  requireSignature: true,
  signatureHeader: 'X-Webhook-Signature',
  secretKey: process.env.WEBHOOK_SECRET_KEY
}
};

// Analytics Integration Configuration
const analyticsConfig = {
enabled: process.env.ANALYTICS_INTEGRATION_ENABLED === 'true',

// Google Analytics
googleAnalytics: {
  enabled: process.env.GA_ENABLED === 'true',
  trackingId: process.env.GA_TRACKING_ID,
  measurementId: process.env.GA_MEASUREMENT_ID,
  
  // Events to track
  events: {
    meetingCreated: 'meeting_created',
    transcriptionStarted: 'transcription_started',
    transcriptionCompleted: 'transcription_completed',
    summaryGenerated: 'summary_generated',
    fileUploaded: 'file_uploaded',
    userRegistered: 'user_registered'
  }
},

// Mixpanel
mixpanel: {
  enabled: process.env.MIXPANEL_ENABLED === 'true',
  token: process.env.MIXPANEL_TOKEN,
  
  // Events to track
  events: {
    meetingCreated: 'Meeting Created',
    transcriptionCompleted: 'Transcription Completed',
    summaryGenerated: 'Summary Generated',
    userUpgraded: 'User Upgraded',
    integrationConnected: 'Integration Connected'
  }
},

// Custom Analytics
custom: {
  enabled: process.env.CUSTOM_ANALYTICS_ENABLED === 'true',
  endpoint: process.env.CUSTOM_ANALYTICS_ENDPOINT,
  apiKey: process.env.CUSTOM_ANALYTICS_API_KEY
}
};

// Integration Manager Class
class IntegrationManager {
constructor() {
  this.integrations = {
    zoom: zoomConfig,
    googleMeet: googleMeetConfig,
    teams: teamsConfig,
    slack: slackConfig,
    email: emailConfig,
    calendar: calendarConfig,
    cloudStorage: cloudStorageConfig,
    crm: crmConfig,
    notifications: notificationConfig,
    analytics: analyticsConfig
  };
  
  this.connectionStatus = new Map();
  this.syncStatus = new Map();
  this.lastSync = new Map();
}

// Get enabled integrations
getEnabledIntegrations() {
  const enabled = {};
  
  Object.entries(this.integrations).forEach(([name, config]) => {
    if (config.enabled) {
      enabled[name] = {
        name,
        enabled: true,
        features: config.features || {},
        status: this.connectionStatus.get(name) || 'unknown'
      };
    }
  });
  
  return enabled;
}

// Get integration configuration
getIntegrationConfig(integrationName) {
  const config = this.integrations[integrationName];
  if (!config) {
    throw new Error(`Integration ${integrationName} not found`);
  }
  
  // Remove sensitive information
  const sanitizedConfig = JSON.parse(JSON.stringify(config));
  
  // Recursively remove sensitive keys
  const removeSensitiveData = (obj) => {
    const sensitiveKeys = ['apiKey', 'clientSecret', 'secretToken', 'privateKey', 'password', 'authToken'];
    
    Object.keys(obj).forEach(key => {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive.toLowerCase()))) {
        obj[key] = obj[key] ? '***' : undefined;
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        removeSensitiveData(obj[key]);
      }
    });
  };
  
  removeSensitiveData(sanitizedConfig);
  return sanitizedConfig;
}

// Update connection status
updateConnectionStatus(integrationName, status, error = null) {
  this.connectionStatus.set(integrationName, {
    status,
    error,
    lastUpdated: new Date(),
    lastSuccessful: status === 'connected' ? new Date() : this.connectionStatus.get(integrationName)?.lastSuccessful
  });
  
  logger.info(`Integration ${integrationName} status updated:`, { status, error });
}

// Get connection status
getConnectionStatus(integrationName = null) {
  if (integrationName) {
    return this.connectionStatus.get(integrationName) || { status: 'unknown' };
  }
  
  const allStatus = {};
  for (const [name, status] of this.connectionStatus.entries()) {
    allStatus[name] = status;
  }
  return allStatus;
}

// Update sync status
updateSyncStatus(integrationName, status, details = {}) {
  this.syncStatus.set(integrationName, {
    status,
    details,
    lastSync: new Date(),
    nextSync: details.nextSync || null
  });
  
  if (status === 'completed') {
    this.lastSync.set(integrationName, new Date());
  }
}

// Get sync status
getSyncStatus(integrationName = null) {
  if (integrationName) {
    return this.syncStatus.get(integrationName) || { status: 'never' };
  }
  
  const allStatus = {};
  for (const [name, status] of this.syncStatus.entries()) {
    allStatus[name] = status;
  }
  return allStatus;
}

// Check integration health
async checkIntegrationHealth(integrationName) {
  try {
    const config = this.integrations[integrationName];
    if (!config || !config.enabled) {
      return { status: 'disabled' };
    }

    // Implement health check logic for each integration
    // This is a placeholder - actual implementation would make API calls
    const healthStatus = {
      status: 'healthy',
      lastChecked: new Date(),
      responseTime: Math.random() * 100 + 50, // Mock response time
      features: config.features || {},
      rateLimit: config.rateLimit || null
    };

    this.updateConnectionStatus(integrationName, 'connected');
    return healthStatus;
  } catch (error) {
    const errorStatus = {
      status: 'error',
      error: error.message,
      lastChecked: new Date()
    };
    
    this.updateConnectionStatus(integrationName, 'error', error.message);
    return errorStatus;
  }
}

// Validate integration configuration
validateIntegrationConfig(integrationName) {
  const config = this.integrations[integrationName];
  if (!config) {
    return { valid: false, errors: ['Integration not found'] };
  }

  const errors = [];

  // Check if enabled but missing required configuration
  if (config.enabled) {
    // Check OAuth configuration
    if (config.oauth) {
      if (!config.oauth.clientId) errors.push('Missing OAuth client ID');
      if (!config.oauth.clientSecret) errors.push('Missing OAuth client secret');
      if (!config.oauth.redirectUri) errors.push('Missing OAuth redirect URI');
    }

    // Check API configuration
    if (config.api && !config.api.baseUrl && !config.api.host) {
      errors.push('Missing API base URL or host');
    }

    // Check webhook configuration
    if (config.webhook && config.webhook.secretToken === undefined) {
      errors.push('Missing webhook secret token');
    }

    // Integration-specific validation
    switch (integrationName) {
      case 'email':
        if (!config.smtp.auth.user || !config.smtp.auth.pass) {
          errors.push('Missing SMTP credentials');
        }
        break;
      case 'notifications':
        if (config.push.enabled && !config.push.firebase.projectId) {
          errors.push('Missing Firebase project ID for push notifications');
        }
        if (config.sms.enabled && !config.sms.twilio.accountSid) {
          errors.push('Missing Twilio credentials for SMS notifications');
        }
        break;
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Validate all integrations
validateAllIntegrations() {
  const results = {};
  const allErrors = [];

  Object.keys(this.integrations).forEach(integrationName => {
    const validation = this.validateIntegrationConfig(integrationName);
    results[integrationName] = validation;
    
    if (!validation.valid) {
      allErrors.push(...validation.errors.map(error => `${integrationName}: ${error}`));
    }
  });

  return {
    valid: allErrors.length === 0,
    results,
    errors: allErrors
  };
}

// Get integration statistics
getIntegrationStats() {
  const stats = {
    total: Object.keys(this.integrations).length,
    enabled: 0,
    connected: 0,
    errors: 0,
    lastSync: null
  };

  Object.entries(this.integrations).forEach(([name, config]) => {
    if (config.enabled) {
      stats.enabled++;
      
      const status = this.connectionStatus.get(name);
      if (status) {
        if (status.status === 'connected') stats.connected++;
        if (status.status === 'error') stats.errors++;
      }
    }
  });

  // Get most recent sync time
  const syncTimes = Array.from(this.lastSync.values());
  if (syncTimes.length > 0) {
    stats.lastSync = new Date(Math.max(...syncTimes.map(d => d.getTime())));
  }

  return stats;
}
}

// Create and export singleton instance
const integrationManager = new IntegrationManager();

// Validate configuration on startup
const configValidation = integrationManager.validateAllIntegrations();
if (!configValidation.valid) {
logger.warn('Integration configuration issues:', configValidation.errors);
}

module.exports = {
// Individual configurations
zoomConfig,
googleMeetConfig,
teamsConfig,
slackConfig,
emailConfig,
calendarConfig,
cloudStorageConfig,
crmConfig,
notificationConfig,
analyticsConfig,

// Manager class and instance
IntegrationManager,
integrationManager
};
