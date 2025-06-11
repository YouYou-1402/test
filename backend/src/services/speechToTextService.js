// backend/src/services/speechToTextService.js
/**
 * Speech-to-Text Service
 * Integrates with multiple STT providers (FPT AI, Whisper, Google, Azure, AWS)
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs').promises;
const { createReadStream } = require('fs');
const logger = require('../utils/logger');
const { redisConfig } = require('../config/redis');
const audioProcessingService = require('./audioProcessingService');

class SpeechToTextService {
constructor() {
  this.providers = {
    fpt: {
      name: 'FPT AI',
      endpoint: process.env.FPT_STT_ENDPOINT,
      apiKey: process.env.FPT_API_KEY,
      enabled: !!process.env.FPT_API_KEY,
      languages: ['vi-VN', 'en-US'],
      maxFileSize: 25 * 1024 * 1024, // 25MB
      supportedFormats: ['wav', 'mp3', 'flac']
    },
    whisper: {
      name: 'OpenAI Whisper',
      endpoint: process.env.OPENAI_API_ENDPOINT || 'https://api.openai.com/v1/audio/transcriptions',
      apiKey: process.env.OPENAI_API_KEY,
      enabled: !!process.env.OPENAI_API_KEY,
      languages: ['auto'], // Auto-detect
      maxFileSize: 25 * 1024 * 1024, // 25MB
      supportedFormats: ['wav', 'mp3', 'mp4', 'm4a', 'flac', 'webm']
    },
    google: {
      name: 'Google Cloud Speech-to-Text',
      enabled: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
      languages: ['vi-VN', 'en-US', 'ja-JP', 'ko-KR'],
      maxFileSize: 10 * 1024 * 1024, // 10MB for sync, unlimited for async
      supportedFormats: ['wav', 'flac', 'mp3', 'ogg']
    },
    azure: {
      name: 'Azure Speech Services',
      endpoint: process.env.AZURE_SPEECH_ENDPOINT,
      apiKey: process.env.AZURE_SPEECH_KEY,
      region: process.env.AZURE_SPEECH_REGION,
      enabled: !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
      languages: ['vi-VN', 'en-US', 'ja-JP', 'ko-KR'],
      maxFileSize: 100 * 1024 * 1024, // 100MB
      supportedFormats: ['wav', 'mp3', 'ogg', 'flac']
    },
    aws: {
      name: 'Amazon Transcribe',
      enabled: !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
      languages: ['vi-VN', 'en-US', 'ja-JP', 'ko-KR'],
      maxFileSize: 2 * 1024 * 1024 * 1024, // 2GB
      supportedFormats: ['wav', 'mp3', 'mp4', 'flac', 'm4a']
    }
  };

  this.defaultProvider = process.env.DEFAULT_STT_PROVIDER || 'fpt';
}

/**
 * Transcribe audio file using specified provider
 */
async transcribe(audioPath, options = {}) {
  try {
    const {
      provider = this.defaultProvider,
      language = 'vi-VN',
      enableSpeakerDiarization = true,
      enablePunctuation = true,
      enableWordTimestamps = true,
      customVocabulary = [],
      model = 'latest'
    } = options;

    logger.info('Starting transcription', {
      audioPath,
      provider,
      language,
      options
    });

    // Validate provider
    if (!this.providers[provider] || !this.providers[provider].enabled) {
      throw new Error(`Provider ${provider} is not available or not configured`);
    }

    // Validate audio file
    const audioInfo = await audioProcessingService.getAudioInfo(audioPath);
    await this.validateAudioForProvider(audioPath, provider, audioInfo);

    // Choose transcription method based on provider
    let result;
    switch (provider) {
      case 'fpt':
        result = await this.transcribeWithFPT(audioPath, { language, enablePunctuation });
        break;
      case 'whisper':
        result = await this.transcribeWithWhisper(audioPath, { language, model });
        break;
      case 'google':
        result = await this.transcribeWithGoogle(audioPath, { 
          language, 
          enableSpeakerDiarization, 
          enablePunctuation,
          enableWordTimestamps,
          customVocabulary 
        });
        break;
      case 'azure':
        result = await this.transcribeWithAzure(audioPath, { 
          language, 
          enableSpeakerDiarization,
          enablePunctuation 
        });
        break;
      case 'aws':
        result = await this.transcribeWithAWS(audioPath, { 
          language, 
          enableSpeakerDiarization 
        });
        break;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }

    // Post-process result
    const processedResult = await this.postProcessTranscription(result, options);

    logger.info('Transcription completed', {
      provider,
      duration: audioInfo.duration,
      wordCount: processedResult.segments?.reduce((count, segment) => 
        count + (segment.text?.split(' ').length || 0), 0) || 0,
      confidence: processedResult.confidence
    });

    return {
      success: true,
      provider,
      audioInfo,
      transcription: processedResult,
      processingTime: Date.now() - result.startTime
    };

  } catch (error) {
    logger.error('Transcription failed:', error);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

/**
 * Transcribe with FPT AI
 */
async transcribeWithFPT(audioPath, options = {}) {
  try {
    const startTime = Date.now();
    const { language = 'vi-VN', enablePunctuation = true } = options;

    // Prepare form data
    const formData = new FormData();
    formData.append('file', createReadStream(audioPath));
    formData.append('language', language);
    formData.append('format', 'json');
    
    if (enablePunctuation) {
      formData.append('punctuation', 'true');
    }

    // Make API request
    const response = await axios.post(this.providers.fpt.endpoint, formData, {
      headers: {
        ...formData.getHeaders(),
        'api-key': this.providers.fpt.apiKey
      },
      timeout: 300000 // 5 minutes
    });

    if (response.data.error) {
      throw new Error(`FPT API error: ${response.data.error}`);
    }

    // Parse FPT response
    const segments = this.parseFPTResponse(response.data);

    return {
      startTime,
      text: segments.map(s => s.text).join(' '),
      segments,
      confidence: this.calculateAverageConfidence(segments),
      language: language,
      provider: 'fpt'
    };

  } catch (error) {
    logger.error('FPT transcription error:', error);
    throw new Error(`FPT transcription failed: ${error.message}`);
  }
}

/**
 * Transcribe with OpenAI Whisper
 */
async transcribeWithWhisper(audioPath, options = {}) {
  try {
    const startTime = Date.now();
    const { language, model = 'whisper-1' } = options;

    // Prepare form data
    const formData = new FormData();
    formData.append('file', createReadStream(audioPath));
    formData.append('model', model);
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'word');
    formData.append('timestamp_granularities[]', 'segment');
    
    if (language && language !== 'auto') {
      formData.append('language', language.split('-')[0]);
    }

    // Make API request
    const response = await axios.post(this.providers.whisper.endpoint, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${this.providers.whisper.apiKey}`
      },
      timeout: 300000 // 5 minutes
    });

    // Parse Whisper response
    const segments = this.parseWhisperResponse(response.data);

    return {
      startTime,
      text: response.data.text,
      segments,
      confidence: this.calculateAverageConfidence(segments),
      language: response.data.language,
      provider: 'whisper'
    };

  } catch (error) {
    logger.error('Whisper transcription error:', error);
    throw new Error(`Whisper transcription failed: ${error.message}`);
  }
}

/**
 * Transcribe with Google Cloud Speech-to-Text
 */
async transcribeWithGoogle(audioPath, options = {}) {
  try {
    const startTime = Date.now();
    const { 
      language = 'vi-VN', 
      enableSpeakerDiarization = true,
      enablePunctuation = true,
      enableWordTimestamps = true,
      customVocabulary = []
    } = options;

    const { SpeechClient } = require('@google-cloud/speech');
    const client = new SpeechClient();

    // Read audio file
    const audioBytes = await fs.readFile(audioPath);

    // Configure request
    const request = {
      audio: {
        content: audioBytes.toString('base64')
      },
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: language,
        enableAutomaticPunctuation: enablePunctuation,
        enableWordTimeOffsets: enableWordTimestamps,
        model: 'latest_long',
        useEnhanced: true
      }
    };

    // Enable speaker diarization if requested
    if (enableSpeakerDiarization) {
      request.config.diarizationConfig = {
        enableSpeakerDiarization: true,
        minSpeakerCount: 1,
        maxSpeakerCount: 10
      };
    }

    // Add custom vocabulary if provided
    if (customVocabulary.length > 0) {
      request.config.speechContexts = [{
        phrases: customVocabulary
      }];
    }

    // Make API request
    const [response] = await client.recognize(request);

    // Parse Google response
    const segments = this.parseGoogleResponse(response);

    return {
      startTime,
      text: segments.map(s => s.text).join(' '),
      segments,
      confidence: this.calculateAverageConfidence(segments),
      language: language,
      provider: 'google'
    };

  } catch (error) {
    logger.error('Google transcription error:', error);
    throw new Error(`Google transcription failed: ${error.message}`);
  }
}

/**
 * Transcribe with Azure Speech Services
 */
async transcribeWithAzure(audioPath, options = {}) {
  try {
    const startTime = Date.now();
    const { 
      language = 'vi-VN', 
      enableSpeakerDiarization = true,
      enablePunctuation = true 
    } = options;

    const sdk = require('microsoft-cognitiveservices-speech-sdk');

    // Configure speech config
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      this.providers.azure.apiKey,
      this.providers.azure.region
    );
    speechConfig.speechRecognitionLanguage = language;
    speechConfig.outputFormat = sdk.OutputFormat.Detailed;

    // Configure audio input
    const audioConfig = sdk.AudioConfig.fromWavFileInput(
      await fs.readFile(audioPath)
    );

    // Create recognizer
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    // Configure recognition settings
    if (enablePunctuation) {
      speechConfig.setProperty(
        sdk.PropertyId.SpeechServiceResponse_RequestDetailedResultTrueFalse,
        'true'
      );
    }

    if (enableSpeakerDiarization) {
      const conversationTranscriber = new sdk.ConversationTranscriber(speechConfig, audioConfig);
      return await this.performAzureConversationTranscription(conversationTranscriber, startTime);
    }

    // Perform recognition
    return new Promise((resolve, reject) => {
      const segments = [];

      recognizer.recognized = (s, e) => {
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
          segments.push(this.parseAzureResult(e.result));
        }
      };

      recognizer.sessionStopped = (s, e) => {
        recognizer.stopContinuousRecognitionAsync();
        
        resolve({
          startTime,
          text: segments.map(s => s.text).join(' '),
          segments,
          confidence: this.calculateAverageConfidence(segments),
          language: language,
          provider: 'azure'
        });
      };

      recognizer.canceled = (s, e) => {
        recognizer.stopContinuousRecognitionAsync();
        reject(new Error(`Azure recognition canceled: ${e.errorDetails}`));
      };

      recognizer.startContinuousRecognitionAsync();
    });

  } catch (error) {
    logger.error('Azure transcription error:', error);
    throw new Error(`Azure transcription failed: ${error.message}`);
  }
}

/**
 * Transcribe with AWS Transcribe
 */
async transcribeWithAWS(audioPath, options = {}) {
  try {
    const startTime = Date.now();
    const { language = 'vi-VN', enableSpeakerDiarization = true } = options;

    const AWS = require('aws-sdk');
    const { v4: uuidv4 } = require('uuid');

    // Configure AWS
    const transcribeService = new AWS.TranscribeService({
      region: process.env.AWS_REGION || 'us-east-1'
    });

    const s3 = new AWS.S3();

    // Upload file to S3 first
    const bucketName = process.env.AWS_TRANSCRIBE_BUCKET;
    const objectKey = `transcribe/${uuidv4()}.wav`;
    
    const audioBuffer = await fs.readFile(audioPath);
    await s3.upload({
      Bucket: bucketName,
      Key: objectKey,
      Body: audioBuffer,
      ContentType: 'audio/wav'
    }).promise();

    const mediaFileUri = `s3://${bucketName}/${objectKey}`;

    // Start transcription job
    const jobName = `transcribe-job-${uuidv4()}`;
    const params = {
      TranscriptionJobName: jobName,
      LanguageCode: language,
      MediaFormat: 'wav',
      Media: {
        MediaFileUri: mediaFileUri
      },
      OutputBucketName: bucketName,
      Settings: {
        ShowSpeakerLabels: enableSpeakerDiarization,
        MaxSpeakerLabels: enableSpeakerDiarization ? 10 : undefined
      }
    };

    await transcribeService.startTranscriptionJob(params).promise();

    // Poll for completion
    const result = await this.pollAWSTranscriptionJob(transcribeService, jobName);

    // Download and parse result
    const transcriptUri = result.TranscriptionJob.Transcript.TranscriptFileUri;
    const transcriptResponse = await axios.get(transcriptUri);
    const segments = this.parseAWSResponse(transcriptResponse.data);

    // Cleanup S3 objects
    await this.cleanupAWSResources(s3, bucketName, [objectKey]);

    return {
      startTime,
      text: segments.map(s => s.text).join(' '),
      segments,
      confidence: this.calculateAverageConfidence(segments),
      language: language,
      provider: 'aws'
    };

  } catch (error) {
    logger.error('AWS transcription error:', error);
    throw new Error(`AWS transcription failed: ${error.message}`);
  }
}

/**
 * Batch transcription for multiple files
 */
async batchTranscribe(audioPaths, options = {}) {
  try {
    logger.info('Starting batch transcription', { fileCount: audioPaths.length });

    const results = [];
    const batchSize = options.batchSize || 5;
    
    // Process files in batches
    for (let i = 0; i < audioPaths.length; i += batchSize) {
      const batch = audioPaths.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (audioPath, index) => {
        try {
          const result = await this.transcribe(audioPath, {
            ...options,
            batchIndex: i + index
          });
          return { success: true, audioPath, result };
        } catch (error) {
          logger.error(`Batch transcription failed for ${audioPath}:`, error);
          return { success: false, audioPath, error: error.message };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(r => r.value || r.reason));

      // Add delay between batches to avoid rate limiting
      if (i + batchSize < audioPaths.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    logger.info('Batch transcription completed', {
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
    logger.error('Batch transcription error:', error);
    throw error;
  }
}

/**
 * Get transcription job status
 */
async getJobStatus(jobId, provider) {
  try {
    // Implementation depends on provider
    switch (provider) {
      case 'aws':
        return await this.getAWSJobStatus(jobId);
      case 'azure':
        return await this.getAzureJobStatus(jobId);
      case 'google':
        return await this.getGoogleJobStatus(jobId);
      default:
        throw new Error(`Job status not supported for provider: ${provider}`);
    }
  } catch (error) {
    logger.error('Error getting job status:', error);
    throw error;
  }
}

/**
 * Validate audio file for specific provider
 */
async validateAudioForProvider(audioPath, provider, audioInfo) {
  const providerConfig = this.providers[provider];
  
  if (!providerConfig) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  // Check file size
  if (audioInfo.size > providerConfig.maxFileSize) {
    throw new Error(
      `File size ${audioInfo.size} exceeds ${provider} limit of ${providerConfig.maxFileSize}`
    );
  }

  // Check format
  const fileExt = audioPath.split('.').pop().toLowerCase();
  if (!providerConfig.supportedFormats.includes(fileExt)) {
    throw new Error(
      `Format ${fileExt} not supported by ${provider}. Supported: ${providerConfig.supportedFormats.join(', ')}`
    );
  }

  return true;
}

/**
 * Parse FPT AI response
 */
parseFPTResponse(data) {
  try {
    const segments = [];
    
    if (data.hypotheses && data.hypotheses.length > 0) {
      const hypothesis = data.hypotheses[0];
      
      if (hypothesis.utterances) {
        hypothesis.utterances.forEach((utterance, index) => {
          segments.push({
            id: index,
            text: utterance.transcript,
            startTime: utterance.startTime || 0,
            endTime: utterance.endTime || 0,
            confidence: utterance.confidence || 0.5,
            speaker: utterance.speaker || 'Speaker 1',
            words: utterance.words || []
          });
        });
      } else {
        // Simple transcript without timestamps
        segments.push({
          id: 0,
          text: hypothesis.transcript,
          startTime: 0,
          endTime: 0,
          confidence: hypothesis.confidence || 0.5,
          speaker: 'Speaker 1',
          words: []
        });
      }
    }

    return segments;
  } catch (error) {
    logger.error('Error parsing FPT response:', error);
    throw new Error('Failed to parse FPT response');
  }
}

/**
 * Parse OpenAI Whisper response
 */
parseWhisperResponse(data) {
  try {
    const segments = [];

    if (data.segments) {
      data.segments.forEach((segment, index) => {
        segments.push({
          id: index,
          text: segment.text.trim(),
          startTime: segment.start,
          endTime: segment.end,
          confidence: segment.avg_logprob ? Math.exp(segment.avg_logprob) : 0.8,
          speaker: 'Speaker 1', // Whisper doesn't provide speaker diarization
          words: segment.words || []
        });
      });
    } else {
      // Fallback for simple response
      segments.push({
        id: 0,
        text: data.text,
        startTime: 0,
        endTime: 0,
        confidence: 0.8,
        speaker: 'Speaker 1',
        words: []
      });
    }

    return segments;
  } catch (error) {
    logger.error('Error parsing Whisper response:', error);
    throw new Error('Failed to parse Whisper response');
  }
}

/**
 * Parse Google Cloud Speech response
 */
parseGoogleResponse(response) {
  try {
    const segments = [];

    if (response.results) {
      response.results.forEach((result, resultIndex) => {
        if (result.alternatives && result.alternatives.length > 0) {
          const alternative = result.alternatives[0];
          
          segments.push({
            id: resultIndex,
            text: alternative.transcript,
            startTime: alternative.words ? alternative.words[0]?.startTime?.seconds || 0 : 0,
            endTime: alternative.words ? 
              alternative.words[alternative.words.length - 1]?.endTime?.seconds || 0 : 0,
            confidence: alternative.confidence || 0.5,
            speaker: alternative.speakerTag ? `Speaker ${alternative.speakerTag}` : 'Speaker 1',
            words: alternative.words || []
          });
        }
      });
    }

    return segments;
  } catch (error) {
    logger.error('Error parsing Google response:', error);
    throw new Error('Failed to parse Google response');
  }
}

/**
 * Parse Azure Speech response
 */
parseAzureResult(result) {
  try {
    return {
      text: result.text,
      startTime: result.offset / 10000000, // Convert from ticks to seconds
      endTime: (result.offset + result.duration) / 10000000,
      confidence: result.json ? JSON.parse(result.json).NBest[0].Confidence : 0.5,
      speaker: 'Speaker 1'
    };
  } catch (error) {
    logger.error('Error parsing Azure result:', error);
    return {
      text: result.text,
      startTime: 0,
      endTime: 0,
      confidence: 0.5,
      speaker: 'Speaker 1'
    };
  }
}

/**
 * Parse AWS Transcribe response
 */
parseAWSResponse(data) {
  try {
    const segments = [];

    if (data.results && data.results.transcripts) {
      const transcript = data.results.transcripts[0];
      
      if (data.results.speaker_labels) {
        // With speaker diarization
        const speakerLabels = data.results.speaker_labels.segments;
        
        speakerLabels.forEach((segment, index) => {
          const items = data.results.items.filter(item => 
            item.start_time >= segment.start_time && 
            item.end_time <= segment.end_time
          );
          
          const text = items.map(item => item.alternatives[0].content).join(' ');
          
          segments.push({
            id: index,
            text: text,
            startTime: parseFloat(segment.start_time),
            endTime: parseFloat(segment.end_time),
            confidence: items.reduce((sum, item) => 
              sum + parseFloat(item.alternatives[0].confidence), 0) / items.length,
            speaker: `Speaker ${segment.speaker_label}`,
            words: items
          });
        });
      } else {
        // Without speaker diarization
        segments.push({
          id: 0,
          text: transcript.transcript,
          startTime: 0,
          endTime: 0,
          confidence: 0.8,
          speaker: 'Speaker 1',
          words: data.results.items || []
        });
      }
    }

    return segments;
  } catch (error) {
    logger.error('Error parsing AWS response:', error);
    throw new Error('Failed to parse AWS response');
  }
}

/**
 * Calculate average confidence score
 */
calculateAverageConfidence(segments) {
  if (!segments || segments.length === 0) return 0;
  
  const totalConfidence = segments.reduce((sum, segment) => 
    sum + (segment.confidence || 0), 0);
  
  return totalConfidence / segments.length;
}

/**
 * Post-process transcription result
 */
async postProcessTranscription(result, options = {}) {
  try {
    let processedResult = { ...result };

    // Clean up text
    if (options.cleanText !== false) {
      processedResult.segments = processedResult.segments.map(segment => ({
        ...segment,
        text: this.cleanTranscriptText(segment.text)
      }));
      
      processedResult.text = processedResult.segments.map(s => s.text).join(' ');
    }

    // Add paragraph breaks
    if (options.addParagraphs !== false) {
      processedResult.segments = this.addParagraphBreaks(processedResult.segments);
    }

    // Merge short segments
    if (options.mergeShortSegments !== false) {
      processedResult.segments = this.mergeShortSegments(processedResult.segments);
    }

    // Add punctuation if missing
    if (options.addPunctuation !== false) {
      processedResult.segments = await this.addPunctuation(processedResult.segments);
    }

    return processedResult;

  } catch (error) {
    logger.error('Error post-processing transcription:', error);
    return result; // Return original if post-processing fails
  }
}

/**
 * Clean transcript text
 */
cleanTranscriptText(text) {
  return text
    .replace(/\s+/g, ' ') // Multiple spaces to single space
    .replace(/[^\w\s\p{P}]/gu, '') // Remove special characters except punctuation
    .trim();
}

/**
 * Add paragraph breaks based on silence detection
 */
addParagraphBreaks(segments, silenceThreshold = 3) {
  const processedSegments = [];
  
  for (let i = 0; i < segments.length; i++) {
    const currentSegment = segments[i];
    const nextSegment = segments[i + 1];
    
    processedSegments.push(currentSegment);
    
    // Add paragraph break if there's a long pause
    if (nextSegment && 
        (nextSegment.startTime - currentSegment.endTime) > silenceThreshold) {
      processedSegments.push({
        id: `break_${i}`,
        text: '\n\n',
        startTime: currentSegment.endTime,
        endTime: nextSegment.startTime,
        confidence: 1,
        speaker: 'system',
        type: 'paragraph_break'
      });
    }
  }
  
  return processedSegments;
}

/**
 * Merge short segments
 */
mergeShortSegments(segments, minDuration = 2) {
  const mergedSegments = [];
  let currentMerge = null;
  
  for (const segment of segments) {
    const duration = segment.endTime - segment.startTime;
    
    if (duration < minDuration && segment.type !== 'paragraph_break') {
      if (!currentMerge) {
        currentMerge = { ...segment };
      } else {
        currentMerge.text += ' ' + segment.text;
        currentMerge.endTime = segment.endTime;
        currentMerge.confidence = (currentMerge.confidence + segment.confidence) / 2;
      }
    } else {
      if (currentMerge) {
        mergedSegments.push(currentMerge);
        currentMerge = null;
      }
      mergedSegments.push(segment);
    }
  }
  
  if (currentMerge) {
    mergedSegments.push(currentMerge);
  }
  
  return mergedSegments;
}

/**
 * Add punctuation using AI
 */
async addPunctuation(segments) {
  // This would integrate with an AI service for punctuation
  // For now, return segments as-is
  return segments;
}

/**
 * Poll AWS transcription job
 */
async pollAWSTranscriptionJob(transcribeService, jobName, maxAttempts = 60) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await transcribeService.getTranscriptionJob({
      TranscriptionJobName: jobName
    }).promise();

    const status = result.TranscriptionJob.TranscriptionJobStatus;

    if (status === 'COMPLETED') {
      return result;
    } else if (status === 'FAILED') {
      throw new Error(`AWS transcription job failed: ${result.TranscriptionJob.FailureReason}`);
    }

    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error('AWS transcription job timeout');
}

/**
 * Cleanup AWS resources
 */
async cleanupAWSResources(s3, bucketName, objectKeys) {
  try {
    const deleteParams = {
      Bucket: bucketName,
      Delete: {
        Objects: objectKeys.map(key => ({ Key: key }))
      }
    };

    await s3.deleteObjects(deleteParams).promise();
    logger.info('AWS resources cleaned up', { objectKeys });
  } catch (error) {
    logger.warn('Failed to cleanup AWS resources:', error);
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
      languages: config.languages,
      maxFileSize: config.maxFileSize,
      supportedFormats: config.supportedFormats
    }));
}

/**
 * Get provider capabilities
 */
getProviderCapabilities(providerId) {
  const provider = this.providers[providerId];
  if (!provider) {
    throw new Error(`Provider ${providerId} not found`);
  }

  return {
    id: providerId,
    name: provider.name,
    enabled: provider.enabled,
    languages: provider.languages,
    maxFileSize: provider.maxFileSize,
    supportedFormats: provider.supportedFormats,
    features: {
      speakerDiarization: ['google', 'azure', 'aws'].includes(providerId),
      wordTimestamps: ['whisper', 'google', 'azure'].includes(providerId),
      customVocabulary: ['google', 'azure'].includes(providerId),
      realTime: ['azure', 'google'].includes(providerId)
    }
  };
}
}

module.exports = new SpeechToTextService();
