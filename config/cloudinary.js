const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'attendsync_uploads', // Optional: customize the folder name in Cloudinary
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif'],
    // transformation: [{ width: 500, height: 500, crop: 'limit' }], // Optional transformations
  },
});

const upload = multer({ storage: storage });

module.exports = { cloudinary, upload };
