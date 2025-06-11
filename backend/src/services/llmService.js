// backend/src/services/llmService.js
/**
 * LLM Service
 * Integrates with multiple LLM providers for summarization and analysis
 */

const axios = require('axios');
const logger = require('../utils/logger');

class LLMService {
  constructor() {
    this.providers = {
      openai: {
        name: 'OpenAI GPT',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: process.env.OPENAI_API_KEY,
        enabled: !!process.env.OPENAI_API_KEY,
        models: ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo'],
        maxTokens: 4096,
        supportedLanguages: ['en', 'vi', 'ja', 'ko', 'zh']
      },
      anthropic: {
        name: 'Anthropic Claude',
        endpoint: 'https://api.anthropic.com/v1/messages',
        apiKey: process.env.ANTHROPIC_API_KEY,
        enabled: !!process.env.ANTHROPIC_API_KEY,
        models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
        maxTokens: 4096,
        supportedLanguages: ['en', 'vi', 'ja', 'ko', 'zh']
      },
      gemini: {
        name: 'Google Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
        apiKey: process.env.GOOGLE_AI_API_KEY,
        enabled: !!process.env.GOOGLE_AI_API_KEY,
        models: ['gemini-pro', 'gemini-pro-vision'],
        maxTokens: 8192,
        supportedLanguages: ['en', 'vi', 'ja', 'ko', 'zh']
      },
      fpt: {
        name: 'FPT AI',
        endpoint: process.env.FPT_LLM_ENDPOINT,
        apiKey: process.env.FPT_LLM_API_KEY,
        enabled: !!process.env.FPT_LLM_API_KEY,
        models: ['fpt-llm-v1'],
        maxTokens: 4096,
        supportedLanguages: ['vi', 'en']
      }
    };

    this.defaultProvider = process.env.DEFAULT_LLM_PROVIDER || 'openai';
    this.defaultModel = process.env.DEFAULT_LLM_MODEL || 'gpt-3.5-turbo';

    // Summary templates
    this.summaryTemplates = {
      meeting: {
        name: 'Meeting Summary',
        prompt: `Summarize this meeting transcript into a structured format with:
1. Key Discussion Points
2. Decisions Made
3. Action Items
4. Next Steps
5. Participants and their main contributions

Transcript: {transcript}

Please provide a clear, concise summary in {language}.`
      },
      
      executive: {
        name: 'Executive Summary',
        prompt: `Create an executive summary of this meeting transcript focusing on:
1. Main Objectives
2. Key Outcomes
3. Strategic Decisions
4. Resource Requirements
5. Timeline and Milestones

Keep it concise and business-focused.

Transcript: {transcript}

Language: {language}`
      },

      action_items: {
        name: 'Action Items',
        prompt: `Extract action items from this meeting transcript. For each action item, identify:
1. Task description
2. Assigned person/team
3. Due date (if mentioned)
4. Priority level
5. Dependencies

Format as a numbered list.

Transcript: {transcript}

Language: {language}`
      },

      technical: {
        name: 'Technical Summary',
        prompt: `Summarize this technical meeting transcript focusing on:
1. Technical Requirements
2. Architecture Decisions
3. Implementation Details
4. Technical Challenges
5. Solutions Proposed

Transcript: {transcript}

Language: {language}`
      },

      custom: {
        name: 'Custom Summary',
        prompt: '{customPrompt}\n\nTranscript: {transcript}\n\nLanguage: {language}'
      }
    };
  }

  /**
   * Generate meeting summary
   */
  async generateSummary(transcript, options = {}) {
    try {
      const {
        provider = this.defaultProvider,
        model = this.defaultModel,
        template = 'meeting',
        language = 'Vietnamese',
        customPrompt = null,
        maxLength = 1000,
        tone = 'professional'
      } = options;

      logger.info('Generating summary', {
        provider,
        model,
        template,
        language,
        transcriptLength: transcript.length
      });

      // Validate provider
      if (!this.providers[provider] || !this.providers[provider].enabled) {
        throw new Error(`Provider ${provider} is not available or not configured`);
      }

      // Prepare prompt
      const prompt = this.buildPrompt(transcript, template, language, customPrompt);

      // Generate summary based on provider
      let result;
      switch (provider) {
        case 'openai':
          result = await this.generateWithOpenAI(prompt, model, options);
          break;
        case 'anthropic':
          result = await this.generateWithAnthropic(prompt, model, options);
          break;
        case 'gemini':
          result = await this.generateWithGemini(prompt, model, options);
          break;
        case 'fpt':
          result = await this.generateWithFPT(prompt, model, options);
          break;
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }

      // Post-process result
      const processedResult = this.postProcessSummary(result, options);

      logger.info('Summary generation completed', {
        provider,
        model,
        inputLength: transcript.length,
        outputLength: processedResult.summary.length,
        tokensUsed: result.tokensUsed
      });

      return {
        success: true,
        summary: processedResult.summary,
        metadata: {
          provider,
          model,
          template,
          language,
          tokensUsed: result.tokensUsed,
          processingTime: result.processingTime,
          confidence: result.confidence || 0.8
        },
        structured: processedResult.structured
      };

    } catch (error) {
      logger.error('Summary generation failed:', error);
      throw new Error(`Summary generation failed: ${error.message}`);
    }
  }

  /**
   * Generate with OpenAI
   */
  async generateWithOpenAI(prompt, model, options = {}) {
    try {
      const startTime = Date.now();
      
      const response = await axios.post(this.providers.openai.endpoint, {
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are a professional meeting assistant that creates clear, structured summaries.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: options.maxTokens || this.providers.openai.maxTokens,
        temperature: options.temperature || 0.7,
        top_p: options.topP || 1,
        frequency_penalty: options.frequencyPenalty || 0,
        presence_penalty: options.presencePenalty || 0
      }, {
        headers: {
          'Authorization': `Bearer ${this.providers.openai.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      });

      const result = response.data;
      
      return {
        summary: result.choices[0].message.content,
        tokensUsed: result.usage.total_tokens,
        processingTime: Date.now() - startTime,
        model: result.model,
        provider: 'openai'
      };

    } catch (error) {
      logger.error('OpenAI generation error:', error);
      throw new Error(`OpenAI generation failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Generate with Anthropic Claude
   */
  async generateWithAnthropic(prompt, model, options = {}) {
    try {
      const startTime = Date.now();

      const response = await axios.post(this.providers.anthropic.endpoint, {
        model: model,
        max_tokens: options.maxTokens || this.providers.anthropic.maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: options.temperature || 0.7,
        top_p: options.topP || 1
      }, {
        headers: {
          'x-api-key': this.providers.anthropic.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        timeout: 60000
      });

      const result = response.data;

      return {
        summary: result.content[0].text,
        tokensUsed: result.usage.input_tokens + result.usage.output_tokens,
        processingTime: Date.now() - startTime,
        model: result.model,
        provider: 'anthropic'
      };

    } catch (error) {
      logger.error('Anthropic generation error:', error);
      throw new Error(`Anthropic generation failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Generate with Google Gemini
   */
  async generateWithGemini(prompt, model, options = {}) {
    try {
      const startTime = Date.now();

      const response = await axios.post(
        `${this.providers.gemini.endpoint}/${model}:generateContent?key=${this.providers.gemini.apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: options.temperature || 0.7,
            topP: options.topP || 1,
            maxOutputTokens: options.maxTokens || this.providers.gemini.maxTokens
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      const result = response.data;

      if (!result.candidates || result.candidates.length === 0) {
        throw new Error('No response generated from Gemini');
      }

      return {
        summary: result.candidates[0].content.parts[0].text,
        tokensUsed: result.usageMetadata?.totalTokenCount || 0,
        processingTime: Date.now() - startTime,
        model: model,
        provider: 'gemini'
      };

    } catch (error) {
      logger.error('Gemini generation error:', error);
      throw new Error(`Gemini generation failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Generate with FPT AI
   */
  async generateWithFPT(prompt, model, options = {}) {
    try {
      const startTime = Date.now();

      const response = await axios.post(this.providers.fpt.endpoint, {
        model: model,
        prompt: prompt,
        max_tokens: options.maxTokens || this.providers.fpt.maxTokens,
        temperature: options.temperature || 0.7,
        top_p: options.topP || 1
      }, {
        headers: {
          'Authorization': `Bearer ${this.providers.fpt.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      });

      const result = response.data;

      return {
        summary: result.choices[0].text || result.response,
        tokensUsed: result.usage?.total_tokens || 0,
        processingTime: Date.now() - startTime,
        model: model,
        provider: 'fpt'
      };

    } catch (error) {
      logger.error('FPT generation error:', error);
      throw new Error(`FPT generation failed: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Build prompt from template
   */
  buildPrompt(transcript, template, language, customPrompt) {
    let promptTemplate;

    if (template === 'custom' && customPrompt) {
      promptTemplate = this.summaryTemplates.custom.prompt;
    } else if (this.summaryTemplates[template]) {
      promptTemplate = this.summaryTemplates[template].prompt;
    } else {
      promptTemplate = this.summaryTemplates.meeting.prompt;
    }

    return promptTemplate
      .replace('{transcript}', transcript)
      .replace('{language}', language)
      .replace('{customPrompt}', customPrompt || '');
  }

  /**
   * Post-process summary result
   */
  postProcessSummary(result, options = {}) {
    let summary = result.summary;

    // Clean up the summary
    summary = summary.trim();
    
    // Remove any markdown formatting if not wanted
    if (options.removeMarkdown) {
      summary = summary.replace(/[#*_`]/g, '');
    }

    // Extract structured data if possible
    const structured = this.extractStructuredData(summary);

    // Limit length if specified
    if (options.maxLength && summary.length > options.maxLength) {
      summary = summary.substring(0, options.maxLength) + '...';
    }

    return {
      summary,
      structured
    };
  }

  /**
   * Extract structured data from summary
   */
  extractStructuredData(summary) {
    const structured = {
      keyPoints: [],
      actionItems: [],
      decisions: [],
      participants: [],
      nextSteps: []
    };

    try {
      // Extract key points
      const keyPointsMatch = summary.match(/(?:Key Discussion Points?|Main Points?|Key Points?):?\s*([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i);
      if (keyPointsMatch) {
        structured.keyPoints = this.extractListItems(keyPointsMatch[1]);
      }

      // Extract action items
      const actionItemsMatch = summary.match(/(?:Action Items?|Tasks?|To[- ]?Do):?\s*([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i);
      if (actionItemsMatch) {
        structured.actionItems = this.extractListItems(actionItemsMatch[1]);
      }

      // Extract decisions
      const decisionsMatch = summary.match(/(?:Decisions? Made?|Decisions?|Resolutions?):?\s*([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i);
      if (decisionsMatch) {
        structured.decisions = this.extractListItems(decisionsMatch[1]);
      }

      // Extract next steps
      const nextStepsMatch = summary.match(/(?:Next Steps?|Follow[- ]?up|Future Actions?):?\s*([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i);
      if (nextStepsMatch) {
        structured.nextSteps = this.extractListItems(nextStepsMatch[1]);
      }

    } catch (error) {
      logger.warn('Error extracting structured data:', error);
    }

    return structured;
  }

  /**
   * Extract list items from text
   */
  extractListItems(text) {
    if (!text) return [];

    return text
      .split(/\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.replace(/^[-*•\d+.)\s]+/, '').trim())
      .filter(line => line.length > 0);
  }

  /**
   * Analyze meeting sentiment
   */
  async analyzeSentiment(transcript, options = {}) {
    try {
      const {
        provider = this.defaultProvider,
        model = this.defaultModel,
        language = 'Vietnamese'
      } = options;

      const prompt = `Analyze the sentiment and tone of this meeting transcript. Provide:
1. Overall sentiment (positive, negative, neutral)
2. Tone analysis (professional, casual, tense, collaborative, etc.)
3. Key emotional moments
4. Participant engagement levels
5. Conflict or agreement indicators

Transcript: ${transcript}

Please analyze in ${language} and provide structured output.`;

      const result = await this.generateWithProvider(prompt, provider, model, options);

      return {
        success: true,
        sentiment: this.parseSentimentAnalysis(result.summary),
        metadata: {
          provider,
          model,
          tokensUsed: result.tokensUsed,
          processingTime: result.processingTime
        }
      };

    } catch (error) {
      logger.error('Sentiment analysis failed:', error);
      throw new Error(`Sentiment analysis failed: ${error.message}`);
    }
  }

  /**
   * Extract key topics from transcript
   */
  async extractTopics(transcript, options = {}) {
    try {
      const {
        provider = this.defaultProvider,
        model = this.defaultModel,
        language = 'Vietnamese',
        maxTopics = 10
      } = options;

      const prompt = `Extract the main topics and themes discussed in this meeting transcript. For each topic, provide:
1. Topic name
2. Brief description
3. Time spent discussing (if identifiable)
4. Key participants involved
5. Importance level (high, medium, low)

Limit to ${maxTopics} most important topics.

Transcript: ${transcript}

Language: ${language}`;

      const result = await this.generateWithProvider(prompt, provider, model, options);

      return {
        success: true,
        topics: this.parseTopicExtraction(result.summary),
        metadata: {
          provider,
          model,
          tokensUsed: result.tokensUsed,
          processingTime: result.processingTime
        }
      };

    } catch (error) {
      logger.error('Topic extraction failed:', error);
      throw new Error(`Topic extraction failed: ${error.message}`);
    }
  }

  /**
   * Generate meeting insights
   */
  async generateInsights(transcript, options = {}) {
    try {
      const {
        provider = this.defaultProvider,
        model = this.defaultModel,
        language = 'Vietnamese'
      } = options;

      const prompt = `Provide deep insights about this meeting transcript including:
1. Meeting effectiveness analysis
2. Communication patterns
3. Decision-making process quality
4. Participation balance
5. Potential improvements
6. Follow-up recommendations
7. Risk factors identified
8. Opportunities highlighted

Transcript: ${transcript}

Language: ${language}`;

      const result = await this.generateWithProvider(prompt, provider, model, options);

      return {
        success: true,
        insights: this.parseInsights(result.summary),
        metadata: {
          provider,
          model,
          tokensUsed: result.tokensUsed,
          processingTime: result.processingTime
        }
      };

    } catch (error) {
      logger.error('Insights generation failed:', error);
      throw new Error(`Insights generation failed: ${error.message}`);
    }
  }

  /**
   * Translate summary to different language
   */
  async translateSummary(summary, targetLanguage, options = {}) {
    try {
      const {
        provider = this.defaultProvider,
        model = this.defaultModel
      } = options;

      const prompt = `Translate this meeting summary to ${targetLanguage}. Maintain the structure and professional tone:

${summary}

Target language: ${targetLanguage}`;

      const result = await this.generateWithProvider(prompt, provider, model, options);

      return {
        success: true,
        translatedSummary: result.summary,
        sourceLanguage: 'auto-detected',
        targetLanguage,
        metadata: {
          provider,
          model,
          tokensUsed: result.tokensUsed,
          processingTime: result.processingTime
        }
      };

    } catch (error) {
      logger.error('Translation failed:', error);
      throw new Error(`Translation failed: ${error.message}`);
    }
  }

  /**
   * Generate with any provider
   */
  async generateWithProvider(prompt, provider, model, options) {
    switch (provider) {
      case 'openai':
        return await this.generateWithOpenAI(prompt, model, options);
      case 'anthropic':
        return await this.generateWithAnthropic(prompt, model, options);
      case 'gemini':
        return await this.generateWithGemini(prompt, model, options);
      case 'fpt':
        return await this.generateWithFPT(prompt, model, options);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * Parse sentiment analysis result
   */
  parseSentimentAnalysis(text) {
    // Extract sentiment data from AI response
    const sentiment = {
      overall: 'neutral',
      score: 0,
      tone: 'professional',
      emotions: [],
      confidence: 0.8
    };

    try {
      // Simple parsing - in production, this would be more sophisticated
      if (text.toLowerCase().includes('positive')) {
        sentiment.overall = 'positive';
        sentiment.score = 0.7;
      } else if (text.toLowerCase().includes('negative')) {
        sentiment.overall = 'negative';
        sentiment.score = -0.7;
      }

      // Extract tone
      const toneMatches = text.match(/tone[:\s]*([\w\s,]+)/i);
      if (toneMatches) {
        sentiment.tone = toneMatches[1].trim().split(',')[0];
      }

    } catch (error) {
      logger.warn('Error parsing sentiment analysis:', error);
    }

    return sentiment;
  }

  /**
   * Parse topic extraction result
   */
  parseTopicExtraction(text) {
    const topics = [];

    try {
      // Extract topics from structured text
      const lines = text.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        if (line.match(/^\d+\.|^-|^\*/)) {
          const topicMatch = line.match(/(?:\d+\.\s*|[-*]\s*)([^:]+)(?::\s*(.+))?/);
          if (topicMatch) {
            topics.push({
              name: topicMatch[1].trim(),
              description: topicMatch[2]?.trim() || '',
              importance: 'medium',
              timeSpent: 0
            });
          }
        }
      }

    } catch (error) {
      logger.warn('Error parsing topic extraction:', error);
    }

    return topics;
  }

  /**
   * Parse insights result
   */
  parseInsights(text) {
    return {
      effectiveness: this.extractInsightSection(text, 'effectiveness'),
      communication: this.extractInsightSection(text, 'communication'),
      decisions: this.extractInsightSection(text, 'decision'),
      participation: this.extractInsightSection(text, 'participation'),
      improvements: this.extractInsightSection(text, 'improvement'),
      risks: this.extractInsightSection(text, 'risk'),
      opportunities: this.extractInsightSection(text, 'opportunit')
    };
  }

  /**
   * Extract insight section
   */
  extractInsightSection(text, keyword) {
    const regex = new RegExp(`${keyword}[^:]*:?\\s*([^\\n]+)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
  }

  /**
   * Batch process summaries
   */
  async batchGenerateSummaries(transcripts, options = {}) {
    try {
      logger.info('Starting batch summary generation', { count: transcripts.length });

      const results = [];
      const batchSize = options.batchSize || 3;

      for (let i = 0; i < transcripts.length; i += batchSize) {
        const batch = transcripts.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (transcript, index) => {
          try {
            const result = await this.generateSummary(transcript, {
              ...options,
              batchIndex: i + index
            });
            return { success: true, transcript, result };
          } catch (error) {
            logger.error(`Batch summary failed for transcript ${i + index}:`, error);
            return { success: false, transcript, error: error.message };
          }
        });

        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults.map(r => r.value || r.reason));

        // Add delay between batches
        if (i + batchSize < transcripts.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;

      logger.info('Batch summary generation completed', {
        total: results.length,
        success: successCount,
        failed: failureCount
      });

      return {
        success: true,
        results,
        summary: {
          total: results.length,
          success: successCount,
          failed: failureCount
        }
      };

    } catch (error) {
      logger.error('Batch summary generation error:', error);
      throw error;
    }
  }

  /**
   * Get available providers
   */
  getAvailableProviders() {
    return Object.entries(this.providers)
      .filter(([, config]) => config.enabled)
      .map(([key, config]) => ({
        id: key,
        name: config.name,
        models: config.models,
        maxTokens: config.maxTokens,
        supportedLanguages: config.supportedLanguages
      }));
  }

  /**
   * Get available templates
   */
  getAvailableTemplates() {
    return Object.entries(this.summaryTemplates).map(([key, template]) => ({
      id: key,
      name: template.name,
      description: template.prompt.substring(0, 100) + '...'
    }));
  }

  /**
   * Validate input parameters
   */
  validateInput(transcript, options = {}) {
    if (!transcript || typeof transcript !== 'string') {
      throw new Error('Transcript must be a non-empty string');
    }

    if (transcript.length < 10) {
      throw new Error('Transcript too short for meaningful summary');
    }

    if (transcript.length > 100000) {
      throw new Error('Transcript too long, please split into smaller chunks');
    }

    const { provider, model } = options;
    
    if (provider && !this.providers[provider]) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    if (provider && !this.providers[provider].enabled) {
      throw new Error(`Provider ${provider} is not enabled`);
    }

    if (model && provider && !this.providers[provider].models.includes(model)) {
      throw new Error(`Model ${model} not available for provider ${provider}`);
    }

    return true;
  }

  /**
   * Get usage statistics
   */
  getUsageStats() {
    return {
      providers: this.getAvailableProviders(),
      templates: this.getAvailableTemplates(),
      defaultProvider: this.defaultProvider,
      defaultModel: this.defaultModel
    };
  }
}

module.exports = new LLMService();
