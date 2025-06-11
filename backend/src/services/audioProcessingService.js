// backend/src/services/audioProcessingService.js
/**
 * Audio Processing Service
 * Handles audio file processing, conversion, enhancement, and analysis
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const { createReadStream, createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');
const logger = require('../utils/logger');
const { uploadFile, downloadFile } = require('../utils/fileHandler');

class AudioProcessingService {
constructor() {
  this.supportedFormats = [
    'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma',
    'mp4', 'avi', 'mov', 'mkv', 'webm'
  ];
  
  this.outputFormats = {
    transcription: 'wav', // Best for speech recognition
    storage: 'mp3',       // Compressed for storage
    streaming: 'aac'      // Good for streaming
  };

  // Audio processing settings
  this.settings = {
    sampleRate: 16000,    // 16kHz for speech recognition
    channels: 1,          // Mono for speech
    bitRate: '64k',       // Reasonable quality/size balance
    maxDuration: 14400,   // 4 hours max
    maxFileSize: 500 * 1024 * 1024, // 500MB max
  };
}

/**
 * Process audio file for transcription
 */
async processForTranscription(inputPath, outputPath = null) {
  try {
    logger.info('Starting audio processing for transcription', { inputPath });

    // Validate input file
    await this.validateAudioFile(inputPath);

    // Generate output path if not provided
    if (!outputPath) {
      const inputDir = path.dirname(inputPath);
      const inputName = path.basename(inputPath, path.extname(inputPath));
      outputPath = path.join(inputDir, `${inputName}_processed.wav`);
    }

    // Get audio info
    const audioInfo = await this.getAudioInfo(inputPath);
    logger.info('Audio file info', audioInfo);

    // Process audio
    const processedInfo = await this.convertAudio(inputPath, outputPath, {
      format: 'wav',
      sampleRate: this.settings.sampleRate,
      channels: this.settings.channels,
      normalize: true,
      removeNoise: true,
      enhanceSpeech: true
    });

    logger.info('Audio processing completed', {
      inputPath,
      outputPath,
      originalSize: audioInfo.size,
      processedSize: processedInfo.size,
      duration: audioInfo.duration
    });

    return {
      success: true,
      inputPath,
      outputPath,
      originalInfo: audioInfo,
      processedInfo,
      processingTime: processedInfo.processingTime
    };

  } catch (error) {
    logger.error('Error processing audio for transcription:', error);
    throw new Error(`Audio processing failed: ${error.message}`);
  }
}

/**
 * Extract audio from video file
 */
async extractAudioFromVideo(videoPath, outputPath = null) {
  try {
    logger.info('Extracting audio from video', { videoPath });

    // Generate output path if not provided
    if (!outputPath) {
      const videoDir = path.dirname(videoPath);
      const videoName = path.basename(videoPath, path.extname(videoPath));
      outputPath = path.join(videoDir, `${videoName}_audio.wav`);
    }

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(this.settings.sampleRate)
        .audioChannels(this.settings.channels)
        .format('wav')
        .on('start', (commandLine) => {
          logger.info('FFmpeg process started', { command: commandLine });
        })
        .on('progress', (progress) => {
          logger.debug('Audio extraction progress', progress);
        })
        .on('end', async () => {
          try {
            const processingTime = Date.now() - startTime;
            const audioInfo = await this.getAudioInfo(outputPath);
            
            logger.info('Audio extraction completed', {
              videoPath,
              outputPath,
              processingTime,
              audioInfo
            });

            resolve({
              success: true,
              videoPath,
              audioPath: outputPath,
              audioInfo,
              processingTime
            });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          logger.error('Audio extraction failed:', error);
          reject(new Error(`Audio extraction failed: ${error.message}`));
        })
        .save(outputPath);
    });

  } catch (error) {
    logger.error('Error extracting audio from video:', error);
    throw error;
  }
}

/**
 * Convert audio to different format
 */
async convertAudio(inputPath, outputPath, options = {}) {
  try {
    const {
      format = 'wav',
      sampleRate = this.settings.sampleRate,
      channels = this.settings.channels,
      bitRate = this.settings.bitRate,
      normalize = false,
      removeNoise = false,
      enhanceSpeech = false
    } = options;

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath);

      // Set audio parameters
      command = command
        .audioCodec(this.getAudioCodec(format))
        .audioFrequency(sampleRate)
        .audioChannels(channels)
        .format(format);

      // Set bitrate for compressed formats
      if (['mp3', 'aac', 'm4a'].includes(format)) {
        command = command.audioBitrate(bitRate);
      }

      // Audio enhancement filters
      const filters = [];

      if (normalize) {
        filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
      }

      if (removeNoise) {
        // Simple noise reduction
        filters.push('highpass=f=80');
        filters.push('lowpass=f=8000');
      }

      if (enhanceSpeech) {
        // Speech enhancement
        filters.push('compand=attacks=0.3:decays=0.8:points=-80/-80|-45/-15|-27/-9|0/-7|20/-7');
      }

      if (filters.length > 0) {
        command = command.audioFilters(filters);
      }

      command
        .on('start', (commandLine) => {
          logger.info('Audio conversion started', { command: commandLine });
        })
        .on('progress', (progress) => {
          logger.debug('Audio conversion progress', progress);
        })
        .on('end', async () => {
          try {
            const processingTime = Date.now() - startTime;
            const stats = await fs.stat(outputPath);
            
            resolve({
              success: true,
              outputPath,
              size: stats.size,
              processingTime,
              format
            });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          logger.error('Audio conversion failed:', error);
          reject(new Error(`Audio conversion failed: ${error.message}`));
        })
        .save(outputPath);
    });

  } catch (error) {
    logger.error('Error converting audio:', error);
    throw error;
  }
}

/**
 * Split audio into chunks for processing
 */
async splitAudio(inputPath, chunkDuration = 300, outputDir = null) {
  try {
    logger.info('Splitting audio into chunks', { 
      inputPath, 
      chunkDuration,
      outputDir 
    });

    // Create output directory
    if (!outputDir) {
      const inputDir = path.dirname(inputPath);
      const inputName = path.basename(inputPath, path.extname(inputPath));
      outputDir = path.join(inputDir, `${inputName}_chunks`);
    }

    await fs.mkdir(outputDir, { recursive: true });

    // Get audio duration
    const audioInfo = await this.getAudioInfo(inputPath);
    const totalDuration = audioInfo.duration;
    const numChunks = Math.ceil(totalDuration / chunkDuration);

    logger.info('Audio splitting info', {
      totalDuration,
      chunkDuration,
      numChunks
    });

    const chunks = [];

    // Split audio into chunks
    for (let i = 0; i < numChunks; i++) {
      const startTime = i * chunkDuration;
      const chunkPath = path.join(outputDir, `chunk_${i.toString().padStart(3, '0')}.wav`);
      
      await this.extractAudioSegment(inputPath, chunkPath, startTime, chunkDuration);
      
      const chunkInfo = await this.getAudioInfo(chunkPath);
      chunks.push({
        index: i,
        path: chunkPath,
        startTime,
        duration: chunkInfo.duration,
        size: chunkInfo.size
      });
    }

    logger.info('Audio splitting completed', {
      inputPath,
      outputDir,
      totalChunks: chunks.length
    });

    return {
      success: true,
      inputPath,
      outputDir,
      chunks,
      totalChunks: chunks.length,
      totalDuration
    };

  } catch (error) {
    logger.error('Error splitting audio:', error);
    throw new Error(`Audio splitting failed: ${error.message}`);
  }
}

/**
 * Extract specific segment from audio
 */
async extractAudioSegment(inputPath, outputPath, startTime, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(duration)
      .audioCodec('pcm_s16le')
      .audioFrequency(this.settings.sampleRate)
      .audioChannels(this.settings.channels)
      .format('wav')
      .on('end', () => {
        resolve({ success: true, outputPath });
      })
      .on('error', (error) => {
        reject(new Error(`Segment extraction failed: ${error.message}`));
      })
      .save(outputPath);
  });
}

/**
 * Merge audio chunks back together
 */
async mergeAudioChunks(chunkPaths, outputPath) {
  try {
    logger.info('Merging audio chunks', { 
      chunkCount: chunkPaths.length,
      outputPath 
    });

    return new Promise((resolve, reject) => {
      let command = ffmpeg();

      // Add all input files
      chunkPaths.forEach(chunkPath => {
        command = command.input(chunkPath);
      });

      command
        .on('start', (commandLine) => {
          logger.info('Audio merging started', { command: commandLine });
        })
        .on('end', async () => {
          try {
            const mergedInfo = await this.getAudioInfo(outputPath);
            logger.info('Audio merging completed', { outputPath, mergedInfo });
            
            resolve({
              success: true,
              outputPath,
              mergedInfo
            });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          logger.error('Audio merging failed:', error);
          reject(new Error(`Audio merging failed: ${error.message}`));
        })
        .mergeToFile(outputPath);
    });

  } catch (error) {
    logger.error('Error merging audio chunks:', error);
    throw error;
  }
}

/**
 * Get audio file information
 */
async getAudioInfo(filePath) {
  try {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (error, metadata) => {
        if (error) {
          reject(new Error(`Failed to get audio info: ${error.message}`));
          return;
        }

        const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
        
        if (!audioStream) {
          reject(new Error('No audio stream found in file'));
          return;
        }

        const stats = require('fs').statSync(filePath);

        resolve({
          duration: parseFloat(metadata.format.duration) || 0,
          size: stats.size,
          format: metadata.format.format_name,
          codec: audioStream.codec_name,
          sampleRate: parseInt(audioStream.sample_rate) || 0,
          channels: audioStream.channels || 0,
          bitRate: parseInt(audioStream.bit_rate) || parseInt(metadata.format.bit_rate) || 0,
          filename: path.basename(filePath)
        });
      });
    });

  } catch (error) {
    logger.error('Error getting audio info:', error);
    throw error;
  }
}

/**
 * Validate audio file
 */
async validateAudioFile(filePath) {
  try {
    // Check if file exists
    await fs.access(filePath);

    // Get file stats
    const stats = await fs.stat(filePath);

    // Check file size
    if (stats.size > this.settings.maxFileSize) {
      throw new Error(`File size exceeds maximum allowed size of ${this.settings.maxFileSize / (1024 * 1024)}MB`);
    }

    // Check file format
    const ext = path.extname(filePath).toLowerCase().substring(1);
    if (!this.supportedFormats.includes(ext)) {
      throw new Error(`Unsupported file format: ${ext}. Supported formats: ${this.supportedFormats.join(', ')}`);
    }

    // Get audio info to validate it's a valid audio/video file
    const audioInfo = await this.getAudioInfo(filePath);

    // Check duration
    if (audioInfo.duration > this.settings.maxDuration) {
      throw new Error(`Audio duration exceeds maximum allowed duration of ${this.settings.maxDuration / 3600} hours`);
    }

    return {
      valid: true,
      fileInfo: {
        path: filePath,
        size: stats.size,
        ...audioInfo
      }
    };

  } catch (error) {
    logger.error('Audio file validation failed:', error);
    throw error;
  }
}

/**
 * Enhance audio quality for better transcription
 */
async enhanceAudioQuality(inputPath, outputPath) {
  try {
    logger.info('Enhancing audio quality', { inputPath, outputPath });

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioFilters([
          // Normalize audio levels
          'loudnorm=I=-16:TP=-1.5:LRA=11',
          // Remove low frequency noise
          'highpass=f=80',
          // Remove high frequency noise
          'lowpass=f=8000',
          // Dynamic range compression for speech
          'compand=attacks=0.3:decays=0.8:points=-80/-80|-45/-15|-27/-9|0/-7|20/-7',
          // Reduce background noise
          'afftdn=nr=10:nf=-25'
        ])
        .audioCodec('pcm_s16le')
        .audioFrequency(this.settings.sampleRate)
        .audioChannels(this.settings.channels)
        .format('wav')
        .on('start', (commandLine) => {
          logger.info('Audio enhancement started', { command: commandLine });
        })
        .on('end', async () => {
          try {
            const enhancedInfo = await this.getAudioInfo(outputPath);
            logger.info('Audio enhancement completed', { outputPath, enhancedInfo });
            
            resolve({
              success: true,
              inputPath,
              outputPath,
              enhancedInfo
            });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          logger.error('Audio enhancement failed:', error);
          reject(new Error(`Audio enhancement failed: ${error.message}`));
        })
        .save(outputPath);
    });

  } catch (error) {
    logger.error('Error enhancing audio quality:', error);
    throw error;
  }
}

/**
 * Generate audio waveform data
 */
async generateWaveform(inputPath, width = 1000, height = 200) {
  try {
    logger.info('Generating audio waveform', { inputPath, width, height });

    const outputPath = inputPath.replace(path.extname(inputPath), '_waveform.png');

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .complexFilter([
          `[0:a]showwavespic=s=${width}x${height}:colors=0x3b82f6[v]`
        ])
        .map('[v]')
        .format('png')
        .on('end', () => {
          logger.info('Waveform generation completed', { outputPath });
          resolve({
            success: true,
            waveformPath: outputPath,
            width,
            height
          });
        })
        .on('error', (error) => {
          logger.error('Waveform generation failed:', error);
          reject(new Error(`Waveform generation failed: ${error.message}`));
        })
        .save(outputPath);
    });

  } catch (error) {
    logger.error('Error generating waveform:', error);
    throw error;
  }
}

/**
 * Detect silence in audio
 */
async detectSilence(inputPath, silenceThreshold = -30, minSilenceDuration = 2) {
  try {
    logger.info('Detecting silence in audio', { 
      inputPath, 
      silenceThreshold, 
      minSilenceDuration 
    });

    return new Promise((resolve, reject) => {
      const silenceSegments = [];
      
      ffmpeg(inputPath)
        .audioFilters([
          `silencedetect=noise=${silenceThreshold}dB:duration=${minSilenceDuration}`
        ])
        .format('null')
        .on('stderr', (stderrLine) => {
          // Parse silence detection output
          const silenceStart = stderrLine.match(/silence_start: ([\d.]+)/);
          const silenceEnd = stderrLine.match(/silence_end: ([\d.]+)/);
          
          if (silenceStart) {
            silenceSegments.push({ start: parseFloat(silenceStart[1]) });
          }
          
          if (silenceEnd && silenceSegments.length > 0) {
            const lastSegment = silenceSegments[silenceSegments.length - 1];
            if (!lastSegment.end) {
              lastSegment.end = parseFloat(silenceEnd[1]);
              lastSegment.duration = lastSegment.end - lastSegment.start;
            }
          }
        })
        .on('end', () => {
          logger.info('Silence detection completed', { 
            silenceSegments: silenceSegments.length 
          });
          
          resolve({
            success: true,
            silenceSegments,
            totalSilenceTime: silenceSegments.reduce((total, segment) => 
              total + (segment.duration || 0), 0
            )
          });
        })
        .on('error', (error) => {
          logger.error('Silence detection failed:', error);
          reject(new Error(`Silence detection failed: ${error.message}`));
        })
        .output('-')
        .run();
    });

  } catch (error) {
    logger.error('Error detecting silence:', error);
    throw error;
  }
}

/**
 * Get appropriate audio codec for format
 */
getAudioCodec(format) {
  const codecs = {
    'wav': 'pcm_s16le',
    'mp3': 'libmp3lame',
    'aac': 'aac',
    'm4a': 'aac',
    'flac': 'flac',
    'ogg': 'libvorbis'
  };

  return codecs[format] || 'pcm_s16le';
}

/**
 * Clean up temporary files
 */
async cleanup(filePaths) {
  try {
    if (!Array.isArray(filePaths)) {
      filePaths = [filePaths];
    }

    const results = await Promise.allSettled(
      filePaths.map(async (filePath) => {
        try {
          await fs.unlink(filePath);
          logger.info('Temporary file cleaned up', { filePath });
          return { success: true, filePath };
        } catch (error) {
          logger.warn('Failed to clean up temporary file', { filePath, error: error.message });
          return { success: false, filePath, error: error.message };
        }
      })
    );

    return results;

  } catch (error) {
    logger.error('Error during cleanup:', error);
    throw error;
  }
}

/**
 * Get processing statistics
 */
getProcessingStats() {
  return {
    supportedFormats: this.supportedFormats,
    outputFormats: this.outputFormats,
    settings: this.settings,
    maxFileSize: `${this.settings.maxFileSize / (1024 * 1024)}MB`,
    maxDuration: `${this.settings.maxDuration / 3600} hours`
  };
}
}

module.exports = new AudioProcessingService();