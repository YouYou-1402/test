// backend/src/routes/integrations.js
/**
 * Integrations Routes
 * Handles all third-party integration endpoints
 */

const express = require('express');
const router = express.Router();
const integrationController = require('../controllers/integrationController');
const { authenticate, authorize } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');
const { cacheMiddleware } = require('../middleware/cache');

// Apply authentication to all routes
router.use(authenticate);

/**
 * @route   GET /api/integrations
 * @desc    Get available integrations
 * @access  Private
 */
router.get('/',
  rateLimiter.getIntegrations,
  cacheMiddleware(600),
  integrationController.getAvailableIntegrations
);

/**
 * @route   GET /api/integrations/connected
 * @desc    Get user's connected integrations
 * @access  Private
 */
router.get('/connected',
  rateLimiter.getConnectedIntegrations,
  cacheMiddleware(300),
  integrationController.getConnectedIntegrations
);

// Calendar Integrations
/**
 * @route   POST /api/integrations/calendar/google/connect
 * @desc    Connect Google Calendar
 * @access  Private
 */
router.post('/calendar/google/connect',
  rateLimiter.connectIntegration,
  integrationController.connectGoogleCalendar
);

/**
 * @route   POST /api/integrations/calendar/outlook/connect
 * @desc    Connect Outlook Calendar
 * @access  Private
 */
router.post('/calendar/outlook/connect',
  rateLimiter.connectIntegration,
  authorize(['premium', 'enterprise']),
  integrationController.connectOutlookCalendar
);

/**
 * @route   GET /api/integrations/calendar/events
 * @desc    Get calendar events
 * @access  Private
 */
router.get('/calendar/events',
  rateLimiter.getCalendarEvents,
  cacheMiddleware(300),
  integrationController.getCalendarEvents
);

/**
 * @route   POST /api/integrations/calendar/sync
 * @desc    Sync meetings with calendar
 * @access  Private
 */
router.post('/calendar/sync',
  rateLimiter.syncCalendar,
  integrationController.syncCalendarEvents
);

// Cloud Storage Integrations
/**
 * @route   POST /api/integrations/storage/drive/connect
 * @desc    Connect Google Drive
 * @access  Private
 */
router.post('/storage/drive/connect',
  rateLimiter.connectIntegration,
  authorize(['premium', 'enterprise']),
  integrationController.connectGoogleDrive
);

/**
 * @route   POST /api/integrations/storage/dropbox/connect
 * @desc    Connect Dropbox
 * @access  Private
 */
router.post('/storage/dropbox/connect',
  rateLimiter.connectIntegration,
  authorize(['premium', 'enterprise']),
  integrationController.connectDropbox
);

/**
 * @route   POST /api/integrations/storage/onedrive/connect
 * @desc    Connect OneDrive
 * @access  Private
 */
router.post('/storage/onedrive/connect',
  rateLimiter.connectIntegration,
  authorize(['enterprise']),
  integrationController.connectOneDrive
);

// Communication Platform Integrations
/**
 * @route   POST /api/integrations/slack/connect
 * @desc    Connect Slack
 * @access  Private
 */
router.post('/slack/connect',
  rateLimiter.connectIntegration,
  authorize(['premium', 'enterprise']),
  integrationController.connectSlack
);

/**
 * @route   POST /api/integrations/teams/connect
 * @desc    Connect Microsoft Teams
 * @access  Private
 */
router.post('/teams/connect',
  rateLimiter.connectIntegration,
  authorize(['enterprise']),
  integrationController.connectTeams
);

/**
 * @route   POST /api/integrations/zoom/connect
 * @desc    Connect Zoom
 * @access  Private
 */
router.post('/zoom/connect',
  rateLimiter.connectIntegration,
  authorize(['premium', 'enterprise']),
  integrationController.connectZoom
);

// CRM Integrations
/**
 * @route   POST /api/integrations/crm/salesforce/connect
 * @desc    Connect Salesforce
 * @access  Private
 */
router.post('/crm/salesforce/connect',
  rateLimiter.connectIntegration,
  authorize(['enterprise']),
  integrationController.connectSalesforce
);

/**
 * @route   POST /api/integrations/crm/hubspot/connect
 * @desc    Connect HubSpot
 * @access  Private
 */
router.post('/crm/hubspot/connect',
  rateLimiter.connectIntegration,
  authorize(['enterprise']),
  integrationController.connectHubSpot
);

// Project Management Integrations
/**
 * @route   POST /api/integrations/project/notion/connect
 * @desc    Connect Notion
 * @access  Private
 */
router.post('/project/notion/connect',
  rateLimiter.connectIntegration,
  authorize(['premium', 'enterprise']),
  integrationController.connectNotion
);

/**
 * @route   POST /api/integrations/project/trello/connect
 * @desc    Connect Trello
 * @access  Private
 */
router.post('/project/trello/connect',
  rateLimiter.connectIntegration,
  authorize(['premium', 'enterprise']),
  integrationController.connectTrello
);

/**
 * @route   POST /api/integrations/project/asana/connect
 * @desc    Connect Asana
 * @access  Private
 */
router.post('/project/asana/connect',
  rateLimiter.connectIntegration,
  authorize(['enterprise']),
  integrationController.connectAsana
);

// Generic Integration Management
/**
 * @route   POST /api/integrations/:service/disconnect
 * @desc    Disconnect integration
 * @access  Private
 */
router.post('/:service/disconnect',
  rateLimiter.disconnectIntegration,
  integrationController.disconnectIntegration
);

/**
 * @route   GET /api/integrations/:service/status
 * @desc    Get integration status
 * @access  Private
 */
router.get('/:service/status',
  rateLimiter.getIntegrationStatus,
  cacheMiddleware(300),
  integrationController.getIntegrationStatus
);

/**
 * @route   POST /api/integrations/:service/test
 * @desc    Test integration connection
 * @access  Private
 */
router.post('/:service/test',
  rateLimiter.testIntegration,
  integrationController.testIntegration
);

/**
 * @route   PUT /api/integrations/:service/settings
 * @desc    Update integration settings
 * @access  Private
 */
router.put('/:service/settings',
  rateLimiter.updateIntegrationSettings,
  integrationController.updateIntegrationSettings
);

/**
 * @route   GET /api/integrations/:service/data
 * @desc    Get data from integration
 * @access  Private
 */
router.get('/:service/data',
  rateLimiter.getIntegrationData,
  cacheMiddleware(300),
  integrationController.getIntegrationData
);

/**
 * @route   POST /api/integrations/:service/sync
 * @desc    Sync data with integration
 * @access  Private
 */
router.post('/:service/sync',
  rateLimiter.syncIntegration,
  integrationController.syncIntegrationData
);

// Webhook Management
/**
 * @route   GET /api/integrations/webhooks
 * @desc    Get user's webhooks
 * @access  Private
 */
router.get('/webhooks',
  rateLimiter.getWebhooks,
  cacheMiddleware(300),
  integrationController.getWebhooks
);

/**
 * @route   POST /api/integrations/webhooks
 * @desc    Create webhook
 * @access  Private
 */
router.post('/webhooks',
  rateLimiter.createWebhook,
  authorize(['premium', 'enterprise']),
  integrationController.createWebhook
);

/**
 * @route   PUT /api/integrations/webhooks/:id
 * @desc    Update webhook
 * @access  Private
 */
router.put('/webhooks/:id',
  rateLimiter.updateWebhook,
  integrationController.updateWebhook
);

/**
 * @route   DELETE /api/integrations/webhooks/:id
 * @desc    Delete webhook
 * @access  Private
 */
router.delete('/webhooks/:id',
  rateLimiter.deleteWebhook,
  integrationController.deleteWebhook
);

/**
 * @route   POST /api/integrations/webhooks/:id/test
 * @desc    Test webhook
 * @access  Private
 */
router.post('/webhooks/:id/test',
  rateLimiter.testWebhook,
  integrationController.testWebhook
);

// OAuth Callbacks
/**
 * @route   GET /api/integrations/oauth/callback/:service
 * @desc    Handle OAuth callbacks
 * @access  Public (but with state verification)
 */
router.get('/oauth/callback/:service',
  rateLimiter.oauthCallback,
  integrationController.handleOAuthCallback
);

/**
 * @route   POST /api/integrations/oauth/refresh/:service
 * @desc    Refresh OAuth token
 * @access  Private
 */
router.post('/oauth/refresh/:service',
  rateLimiter.refreshToken,
  integrationController.refreshOAuthToken
);

// API Key Management
/**
 * @route   GET /api/integrations/api-keys
 * @desc    Get user's API keys for integrations
 * @access  Private
 */
router.get('/api-keys',
  rateLimiter.getApiKeys,
  authorize(['enterprise']),
  integrationController.getApiKeys
);

/**
 * @route   POST /api/integrations/api-keys
 * @desc    Generate new API key
 * @access  Private
 */
router.post('/api-keys',
  rateLimiter.generateApiKey,
  authorize(['enterprise']),
  integrationController.generateApiKey
);

/**
 * @route   DELETE /api/integrations/api-keys/:keyId
 * @desc    Revoke API key
 * @access  Private
 */
router.delete('/api-keys/:keyId',
  rateLimiter.revokeApiKey,
  integrationController.revokeApiKey
);

module.exports = router;
