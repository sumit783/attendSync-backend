const multer = require('multer');

// Store files in memory as a buffer so we can convert them to Base64
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only accept image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// We keep the cloudinary export just to avoid breaking routes that destructure it, 
// even though we aren't using it anymore.
module.exports = { cloudinary: {}, upload };
