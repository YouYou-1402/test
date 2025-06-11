// backend/src/middleware/upload.js
/**
 * Upload Middleware
 * File upload handling with Multer for audio/video files
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { AppError } = require('./errorHandler');
const logger = require('../utils/logger');

// Ensure upload directories exist
const ensureDirectoryExists = async (dirPath) => {
try {
  await fs.access(dirPath);
} catch (error) {
  await fs.mkdir(dirPath, { recursive: true });
}
};

// Generate unique filename
const generateUniqueFilename = (originalName) => {
const timestamp = Date.now();
const randomBytes = crypto.randomBytes(6).toString('hex');
const extension = path.extname(originalName);
const baseName = path.basename(originalName, extension)
  .replace(/[^a-zA-Z0-9]/g, '_')
  .substring(0, 50);

return `${timestamp}_${randomBytes}_${baseName}${extension}`;
};

// File filter function
const createFileFilter = (allowedTypes, maxSize) => {
return (req, file, cb) => {
  // Check file type
  const isAllowedType = allowedTypes.some(type => {
    if (type.includes('/')) {
      return file.mimetype === type;
    } else {
      return file.mimetype.startsWith(type + '/');
    }
  });
  
  if (!isAllowedType) {
    return cb(new AppError(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`, 400), false);
  }
  
  cb(null, true);
};
};

// Storage configuration
const createStorage = (uploadPath, filenameGenerator) => {
return multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const userDir = path.join(uploadPath, req.user._id.toString());
      await ensureDirectoryExists(userDir);
      cb(null, userDir);
    } catch (error) {
      cb(error);
    }
  },
  
  filename: (req, file, cb) => {
    try {
      const filename = filenameGenerator ? filenameGenerator(file) : generateUniqueFilename(file.originalname);
      cb(null, filename);
    } catch (error) {
      cb(error);
    }
  }
});
};

// Memory storage for processing
const memoryStorage = multer.memoryStorage();

// Audio file upload configuration
const audioUpload = multer({
storage: createStorage(path.join(__dirname, '../../storage/uploads/audio')),
fileFilter: createFileFilter([
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
  'audio/x-m4a'
]),
limits: {
  fileSize: 100 * 1024 * 1024, // 100MB
  files: 1
}
});

// Video file upload configuration
const videoUpload = multer({
storage: createStorage(path.join(__dirname, '../../storage/uploads/video')),
fileFilter: createFileFilter([
  'video/mp4',
  'video/avi',
  'video/mov',
  'video/wmv',
  'video/flv',
  'video/webm',
  'video/mkv'
]),
limits: {
  fileSize: 500 * 1024 * 1024, // 500MB
  files: 1
}
});

// Mixed media upload (audio + video)
const mediaUpload = multer({
storage: createStorage(path.join(__dirname, '../../storage/uploads/media')),
fileFilter: createFileFilter([
  'audio',
  'video'
]),
limits: {
  fileSize: 500 * 1024 * 1024, // 500MB
  files: 5
}
});

// Avatar/profile image upload
const avatarUpload = multer({
storage: memoryStorage,
fileFilter: createFileFilter([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
]),
limits: {
  fileSize: 5 * 1024 * 1024, // 5MB
  files: 1
}
});

// Document upload (for meeting documents)
const documentUpload = multer({
storage: createStorage(path.join(__dirname, '../../storage/uploads/documents')),
fileFilter: createFileFilter([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
]),
limits: {
  fileSize: 10 * 1024 * 1024, // 10MB
  files: 10
}
});

// File validation middleware
const validateUploadedFile = (req, res, next) => {
if (!req.file && !req.files) {
  return next(new AppError('No file uploaded', 400));
}

const files = req.files || [req.file];

files.forEach(file => {
  // Additional file validation
  if (file.size === 0) {
    return next(new AppError('Uploaded file is empty', 400));
  }
  
  // Log file upload
  logger.info(`File uploaded: ${file.originalname} (${file.size} bytes) by user ${req.user._id}`);
});

next();
};

// Check storage quota
const checkStorageQuota = async (req, res, next) => {
try {
  const user = req.user;
  const files = req.files || [req.file];
  
  if (!files || files.length === 0) {
    return next();
  }
  
  const totalUploadSize = files.reduce((total, file) => total + file.size, 0);
  const maxStorage = user.subscription.limits.storageGB * 1024 * 1024 * 1024; // Convert GB to bytes
  
  if (user.usage.storageUsed + totalUploadSize > maxStorage) {
    return next(new AppError('Storage quota exceeded. Please upgrade your plan or delete some files.', 403));
  }
  
  // Update storage usage
  user.usage.storageUsed += totalUploadSize;
  await user.save({ validateBeforeSave: false });
  
  next();
} catch (error) {
  next(error);
}
};

// File processing preparation
const prepareFileProcessing = (req, res, next) => {
const files = req.files || [req.file];

if (!files || files.length === 0) {
  return next();
}

req.uploadedFiles = files.map(file => ({
  originalName: file.originalname,
  filename: file.filename,
  path: file.path,
  size: file.size,
  mimetype: file.mimetype,
  fieldname: file.fieldname,
  uploadedAt: new Date()
}));

next();
};

// Clean up failed uploads
const cleanupFailedUpload = async (req, res, next) => {
if (req.uploadedFiles) {
  try {
    await Promise.all(
      req.uploadedFiles.map(async (file) => {
        if (file.path) {
          await fs.unlink(file.path).catch(() => {}); // Ignore errors
        }
      })
    );
    
    logger.info(`Cleaned up ${req.uploadedFiles.length} failed upload files`);
  } catch (error) {
    logger.error('Error cleaning up failed uploads:', error);
  }
}

next();
};

// Virus scanning placeholder (integrate with ClamAV or similar)
const virusScan = async (req, res, next) => {
// This is a placeholder for virus scanning
// In production, integrate with antivirus software

const files = req.files || [req.file];

if (!files || files.length === 0) {
  return next();
}

// Simulate virus scan
for (const file of files) {
  // Basic file extension check
  const suspiciousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.com'];
  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  if (suspiciousExtensions.includes(fileExtension)) {
    return next(new AppError('File type not allowed for security reasons', 400));
  }
  
  // Check for suspicious file names
  const suspiciousPatterns = [/virus/i, /malware/i, /trojan/i];
  if (suspiciousPatterns.some(pattern => pattern.test(file.originalname))) {
    return next(new AppError('File name contains suspicious content', 400));
  }
}

next();
};

// File metadata extraction
const extractFileMetadata = async (req, res, next) => {
const files = req.files || [req.file];

if (!files || files.length === 0) {
  return next();
}

try {
  for (const file of files) {
    // Extract basic metadata
    const stats = await fs.stat(file.path);
    
    file.metadata = {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      extension: path.extname(file.originalname),
      basename: path.basename(file.originalname, path.extname(file.originalname))
    };
    
    // For audio/video files, you could use ffprobe here
    if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
      // Placeholder for media metadata extraction
      // const ffprobe = require('ffprobe');
      // const metadata = await ffprobe(file.path);
      // file.mediaMetadata = metadata;
    }
  }
  
  next();
} catch (error) {
  next(error);
}
};

// Upload progress tracking (for large files)
const trackUploadProgress = (req, res, next) => {
// This would typically be handled by the client
// But you can add server-side progress tracking here

next();
};

// Middleware factory for different upload types
const createUploadMiddleware = (uploadType, options = {}) => {
const middlewares = [];

// Add virus scanning if enabled
if (options.virusScan !== false) {
  middlewares.push(virusScan);
}

// Add storage quota check
if (options.checkQuota !== false) {
  middlewares.push(checkStorageQuota);
}

// Add file validation
middlewares.push(validateUploadedFile);

// Add file processing preparation
middlewares.push(prepareFileProcessing);

// Add metadata extraction
if (options.extractMetadata !== false) {
  middlewares.push(extractFileMetadata);
}

return middlewares;
};

// Error handler for multer errors
const handleMulterError = (err, req, res, next) => {
if (err instanceof multer.MulterError) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return next(new AppError('File too large', 400));
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return next(new AppError('Too many files', 400));
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return next(new AppError('Unexpected file field', 400));
  }
  if (err.code === 'LIMIT_PART_COUNT') {
    return next(new AppError('Too many parts', 400));
  }
  if (err.code === 'LIMIT_FIELD_KEY') {
    return next(new AppError('Field name too long', 400));
  }
  if (err.code === 'LIMIT_FIELD_VALUE') {
    return next(new AppError('Field value too long', 400));
  }
  if (err.code === 'LIMIT_FIELD_COUNT') {
    return next(new AppError('Too many fields', 400));
  }
}

next(err);
};

// File cleanup utility
const cleanupTempFiles = async (filePaths) => {
const cleanupPromises = filePaths.map(async (filePath) => {
  try {
    await fs.unlink(filePath);
    logger.debug(`Cleaned up temp file: ${filePath}`);
  } catch (error) {
    logger.warn(`Failed to cleanup temp file: ${filePath}`, error);
  }
});

await Promise.all(cleanupPromises);
};

// Scheduled cleanup for old temp files
const scheduleCleanup = () => {
const cleanupInterval = 24 * 60 * 60 * 1000; // 24 hours

setInterval(async () => {
  try {
    const tempDirs = [
      path.join(__dirname, '../../storage/temp'),
      path.join(__dirname, '../../storage/uploads/temp')
    ];
    
    for (const tempDir of tempDirs) {
      try {
        const files = await fs.readdir(tempDir);
        const now = Date.now();
        
        for (const file of files) {
          const filePath = path.join(tempDir, file);
          const stats = await fs.stat(filePath);
          
          // Delete files older than 24 hours
          if (now - stats.mtime.getTime() > cleanupInterval) {
            await fs.unlink(filePath);
            logger.debug(`Cleaned up old temp file: ${filePath}`);
          }
        }
      } catch (error) {
        logger.warn(`Error cleaning up temp directory: ${tempDir}`, error);
      }
    }
  } catch (error) {
    logger.error('Error in scheduled cleanup:', error);
  }
}, cleanupInterval);
};

// Initialize cleanup scheduler
scheduleCleanup();

module.exports = {
audioUpload,
videoUpload,
mediaUpload,
avatarUpload,
documentUpload,
validateUploadedFile,
checkStorageQuota,
prepareFileProcessing,
cleanupFailedUpload,
virusScan,
extractFileMetadata,
trackUploadProgress,
createUploadMiddleware,
handleMulterError,
cleanupTempFiles,
generateUniqueFilename,
ensureDirectoryExists
};