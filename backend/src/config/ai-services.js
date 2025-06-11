// backend/src/config/ai-services.js
/**
 * AI Services Configuration
 * Configuration for STT, LLM, and other AI services
 */

const logger = require('../utils/logger');

// Speech-to-Text (STT) Services Configuration
const sttServices = {
// FPT AI Speech-to-Text
fpt: {
  enabled: process.env.FPT_STT_ENABLED === 'true',
  apiUrl: process.env.FPT_STT_API_URL || 'https://api.fpt.ai/hmi/asr/general',
  apiKey: process.env.FPT_STT_API_KEY,
  config: {
    // Supported languages
    languages: ['vi-VN', 'en-US'],
    
    // Audio format requirements
    audioFormat: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'vi-VN',
      maxAlternatives: 3,
      enableWordTimeOffsets: true,
      enableWordConfidence: true,
      enableSpeakerDiarization: true,
      diarizationSpeakerCount: 6,
      enableAutomaticPunctuation: true,
      model: 'latest_long'
    },
    
    // Rate limiting
    rateLimit: {
      requestsPerMinute: 60,
      requestsPerHour: 1000
    },
    
    // Retry configuration
    retry: {
      maxAttempts: 3,
      backoffMultiplier: 2,
      initialDelay: 1000
    },
    
    // File size limits
    limits: {
      maxFileSize: 100 * 1024 * 1024, // 100MB
      maxDuration: 3600, // 1 hour
      supportedFormats: ['wav', 'mp3', 'flac', 'm4a']
    }
  }
},

// OpenAI Whisper
whisper: {
  enabled: process.env.WHISPER_ENABLED === 'true',
  apiUrl: process.env.WHISPER_API_URL || 'https://api.openai.com/v1/audio/transcriptions',
  apiKey: process.env.OPENAI_API_KEY,
  config: {
    // Supported languages (auto-detect or specific)
    languages: ['auto', 'en', 'vi', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru'],
    
    // Model selection
    model: 'whisper-1',
    
    // Response format
    responseFormat: 'verbose_json', // json, text, srt, verbose_json, vtt
    
    // Temperature for randomness
    temperature: 0.2,
    
    // Timestamp granularities
    timestampGranularities: ['word', 'segment'],
    
    // Rate limiting
    rateLimit: {
      requestsPerMinute: 50,
      tokensPerMinute: 150000
    },
    
    // File size limits
    limits: {
      maxFileSize: 25 * 1024 * 1024, // 25MB
      supportedFormats: ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm']
    }
  }
},

// Google Cloud Speech-to-Text
google: {
  enabled: process.env.GOOGLE_STT_ENABLED === 'true',
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
  config: {
    // Supported languages
    languages: ['vi-VN', 'en-US', 'zh-CN', 'ja-JP', 'ko-KR'],
    
    // Recognition config
    recognition: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'vi-VN',
      maxAlternatives: 3,
      enableWordTimeOffsets: true,
      enableWordConfidence: true,
      enableSpeakerDiarization: true,
      diarizationSpeakerCount: 6,
      enableAutomaticPunctuation: true,
      model: 'latest_long',
      useEnhanced: true
    },
    
    // Rate limiting
    rateLimit: {
      requestsPerMinute: 1000,
      requestsPerDay: 1000000
    },
    
    // File size limits
    limits: {
      maxFileSize: 1024 * 1024 * 1024, // 1GB
      maxDuration: 480 * 60, // 8 hours
      supportedFormats: ['wav', 'flac', 'mp3', 'ogg', 'amr', 'awb']
    }
  }
},

// Azure Speech Services
azure: {
  enabled: process.env.AZURE_STT_ENABLED === 'true',
  subscriptionKey: process.env.AZURE_SPEECH_KEY,
  region: process.env.AZURE_SPEECH_REGION || 'southeastasia',
  config: {
    // Supported languages
    languages: ['vi-VN', 'en-US', 'zh-CN', 'ja-JP', 'ko-KR'],
    
    // Recognition settings
    recognition: {
      language: 'vi-VN',
      format: 'detailed',
      profanityOption: 'masked',
      enableDictation: true,
      enableWordLevelTimestamps: true,
      enableSpeakerDiarization: true,
      maxSpeakers: 6
    },
    
    // Rate limiting
    rateLimit: {
      requestsPerSecond: 20,
      concurrentRequests: 5
    },
    
    // File size limits
    limits: {
      maxFileSize: 1024 * 1024 * 1024, // 1GB
      maxDuration: 240 * 60, // 4 hours
      supportedFormats: ['wav', 'ogg', 'amr', 'flac']
    }
  }
}
};

// Large Language Model (LLM) Services Configuration
const llmServices = {
// OpenAI GPT
openai: {
  enabled: process.env.OPENAI_ENABLED === 'true',
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  config: {
    // Available models
    models: {
      'gpt-4': {
        maxTokens: 8192,
        costPer1kTokens: { input: 0.03, output: 0.06 },
        contextWindow: 8192
      },
      'gpt-4-32k': {
        maxTokens: 32768,
        costPer1kTokens: { input: 0.06, output: 0.12 },
        contextWindow: 32768
      },
      'gpt-3.5-turbo': {
        maxTokens: 4096,
        costPer1kTokens: { input: 0.001, output: 0.002 },
        contextWindow: 4096
      },
      'gpt-3.5-turbo-16k': {
        maxTokens: 16384,
        costPer1kTokens: { input: 0.003, output: 0.004 },
        contextWindow: 16384
      }
    },
    
    // Default model
    defaultModel: 'gpt-3.5-turbo',
    
    // Generation parameters
    generation: {
      temperature: 0.7,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxTokens: 2000
    },
    
    // Rate limiting
    rateLimit: {
      requestsPerMinute: 3500,
      tokensPerMinute: 90000,
      requestsPerDay: 200000
    },
    
    // Retry configuration
    retry: {
      maxAttempts: 3,
      backoffMultiplier: 2,
      initialDelay: 1000
    }
  }
},

// Anthropic Claude
claude: {
  enabled: process.env.CLAUDE_ENABLED === 'true',
  apiKey: process.env.CLAUDE_API_KEY,
  baseURL: process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com',
  config: {
    // Available models
    models: {
      'claude-3-opus-20240229': {
        maxTokens: 4096,
        costPer1kTokens: { input: 0.015, output: 0.075 },
        contextWindow: 200000
      },
      'claude-3-sonnet-20240229': {
        maxTokens: 4096,
        costPer1kTokens: { input: 0.003, output: 0.015 },
        contextWindow: 200000
      },
      'claude-3-haiku-20240307': {
        maxTokens: 4096,
        costPer1kTokens: { input: 0.00025, output: 0.00125 },
        contextWindow: 200000
      }
    },
    
    // Default model
    defaultModel: 'claude-3-sonnet-20240229',
    
    // Generation parameters
    generation: {
      temperature: 0.7,
      topP: 1,
      topK: 40,
      maxTokens: 2000
    },
    
    // Rate limiting
    rateLimit: {
      requestsPerMinute: 1000,
      tokensPerMinute: 80000,
      requestsPerDay: 100000
    }
  }
},

// Local LLM (Ollama)
local: {
  enabled: process.env.LOCAL_LLM_ENABLED === 'true',
  baseURL: process.env.LOCAL_LLM_URL || 'http://localhost:11434',
  config: {
    // Available models
    models: {
      'llama2': {
        maxTokens: 4096,
        contextWindow: 4096
      },
      'mistral': {
        maxTokens: 8192,
        contextWindow: 8192
      },
      'codellama': {
        maxTokens: 4096,
        contextWindow: 4096
      }
    },
    
    // Default model
    defaultModel: 'llama2',
    
    // Generation parameters
    generation: {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      repeatPenalty: 1.1,
      maxTokens: 2000
    },
    
    // No rate limiting for local models
    rateLimit: null
  }
}
};

// Translation Services Configuration
const translationServices = {
// Google Translate
google: {
  enabled: process.env.GOOGLE_TRANSLATE_ENABLED === 'true',
  apiKey: process.env.GOOGLE_TRANSLATE_API_KEY,
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  config: {
    // Supported languages
    supportedLanguages: ['vi', 'en', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru'],
    
    // Default source and target languages
    defaultSource: 'auto',
    defaultTarget: 'en',
    
    // Rate limiting
    rateLimit: {
      charactersPerSecond: 10000,
      charactersPerDay: 500000
    }
  }
},

// Azure Translator
azure: {
  enabled: process.env.AZURE_TRANSLATE_ENABLED === 'true',
  subscriptionKey: process.env.AZURE_TRANSLATOR_KEY,
  region: process.env.AZURE_TRANSLATOR_REGION || 'southeastasia',
  config: {
    // Supported languages
    supportedLanguages: ['vi', 'en', 'zh-Hans', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru'],
    
    // Default settings
    defaultSource: 'auto',
    defaultTarget: 'en',
    
    // Rate limiting
    rateLimit: {
      charactersPerSecond: 10000,
      charactersPerMonth: 2000000
    }
  }
}
};

// AI Service Manager Class
class AIServiceManager {
constructor() {
  this.sttServices = sttServices;
  this.llmServices = llmServices;
  this.translationServices = translationServices;
  this.serviceHealth = new Map();
  this.usageStats = new Map();
}

// Get available STT services
getAvailableSTTServices() {
  return Object.entries(this.sttServices)
    .filter(([_, config]) => config.enabled)
    .map(([name, config]) => ({
      name,
      languages: config.config.languages,
      limits: config.config.limits
    }));
}

// Get available LLM services
getAvailableLLMServices() {
  return Object.entries(this.llmServices)
    .filter(([_, config]) => config.enabled)
    .map(([name, config]) => ({
      name,
      models: Object.keys(config.config.models),
      defaultModel: config.config.defaultModel
    }));
}

// Get best STT service for language
getBestSTTService(language = 'auto', fileSize = 0, duration = 0) {
  const availableServices = this.getAvailableSTTServices();
  
  // Filter services that support the language
  const compatibleServices = availableServices.filter(service => 
    service.languages.includes(language) || service.languages.includes('auto')
  );
  
  // Filter services that can handle file size and duration
  const suitableServices = compatibleServices.filter(service => {
    const limits = service.limits;
    return fileSize <= limits.maxFileSize && 
           (duration <= limits.maxDuration || !limits.maxDuration);
  });
  
  if (suitableServices.length === 0) {
    throw new Error('No suitable STT service available for the given requirements');
  }
  
  // Priority order: FPT for Vietnamese, Whisper for others, Google as fallback
  const priorityOrder = ['fpt', 'whisper', 'google', 'azure'];
  
  for (const serviceName of priorityOrder) {
    const service = suitableServices.find(s => s.name === serviceName);
    if (service) {
      return service.name;
    }
  }
  
  return suitableServices[0].name;
}

// Get best LLM service for task
getBestLLMService(taskType = 'summary', tokenCount = 0) {
  const availableServices = this.getAvailableLLMServices();
  
  if (availableServices.length === 0) {
    throw new Error('No LLM services available');
  }
  
  // Choose based on task type and token requirements
  if (taskType === 'summary' && tokenCount < 4000) {
    // Prefer cost-effective models for summaries
    return availableServices.find(s => s.name === 'openai')?.name || 
           availableServices.find(s => s.name === 'claude')?.name ||
           availableServices[0].name;
  }
  
  if (tokenCount > 8000) {
    // Need high-capacity models
    return availableServices.find(s => s.name === 'claude')?.name ||
           availableServices.find(s => s.name === 'openai')?.name ||
           availableServices[0].name;
  }
  
  // Default preference
  const priorityOrder = ['openai', 'claude', 'local'];
  
  for (const serviceName of priorityOrder) {
    const service = availableServices.find(s => s.name === serviceName);
    if (service) {
      return service.name;
    }
  }
  
  return availableServices[0].name;
}

// Check service health
async checkServiceHealth(serviceName, serviceType) {
  try {
    const service = this[`${serviceType}Services`][serviceName];
    if (!service || !service.enabled) {
      return { status: 'disabled' };
    }

    // Implement health check logic for each service
    // This is a placeholder - actual implementation would make API calls
    const healthStatus = {
      status: 'healthy',
      lastChecked: new Date(),
      responseTime: Math.random() * 100 + 50, // Mock response time
      rateLimit: service.config.rateLimit
    };

    this.serviceHealth.set(`${serviceType}:${serviceName}`, healthStatus);
    return healthStatus;
  } catch (error) {
    const errorStatus = {
      status: 'error',
      error: error.message,
      lastChecked: new Date()
    };
    
    this.serviceHealth.set(`${serviceType}:${serviceName}`, errorStatus);
    return errorStatus;
  }
}

// Get service configuration
getServiceConfig(serviceName, serviceType) {
  const service = this[`${serviceType}Services`][serviceName];
  if (!service) {
    throw new Error(`Service ${serviceName} not found in ${serviceType} services`);
  }
  
  return {
    ...service,
    // Remove sensitive information
    apiKey: service.apiKey ? '***' : undefined,
    subscriptionKey: service.subscriptionKey ? '***' : undefined
  };
}

// Update usage statistics
updateUsageStats(serviceName, serviceType, usage) {
  const key = `${serviceType}:${serviceName}`;
  const currentStats = this.usageStats.get(key) || {
    requests: 0,
    tokens: 0,
    characters: 0,
    cost: 0,
    lastUsed: null
  };
  
  this.usageStats.set(key, {
    requests: currentStats.requests + (usage.requests || 1),
    tokens: currentStats.tokens + (usage.tokens || 0),
    characters: currentStats.characters + (usage.characters || 0),
    cost: currentStats.cost + (usage.cost || 0),
    lastUsed: new Date()
  });
}

// Get usage statistics
getUsageStats(serviceName = null, serviceType = null) {
  if (serviceName && serviceType) {
    return this.usageStats.get(`${serviceType}:${serviceName}`) || null;
  }
  
  // Return all stats
  const stats = {};
  for (const [key, value] of this.usageStats.entries()) {
    stats[key] = value;
  }
  return stats;
}

// Validate service configuration
validateConfiguration() {
  const issues = [];
  
  // Check STT services
  Object.entries(this.sttServices).forEach(([name, config]) => {
    if (config.enabled && !config.apiKey && !config.keyFilename) {
      issues.push(`STT service ${name} is enabled but missing API key`);
    }
  });
  
  // Check LLM services
  Object.entries(this.llmServices).forEach(([name, config]) => {
    if (config.enabled && !config.apiKey && name !== 'local') {
      issues.push(`LLM service ${name} is enabled but missing API key`);
    }
  });
  
  // Check if at least one service is enabled
  const enabledSTT = Object.values(this.sttServices).some(s => s.enabled);
  const enabledLLM = Object.values(this.llmServices).some(s => s.enabled);
  
  if (!enabledSTT) {
    issues.push('No STT services are enabled');
  }
  
  if (!enabledLLM) {
    issues.push('No LLM services are enabled');
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}
}

// Create and export singleton instance
const aiServiceManager = new AIServiceManager();

// Validate configuration on startup
const configValidation = aiServiceManager.validateConfiguration();
if (!configValidation.valid) {
logger.warn('AI Services configuration issues:', configValidation.issues);
}

module.exports = {
sttServices,
llmServices,
translationServices,
AIServiceManager,
aiServiceManager
};
