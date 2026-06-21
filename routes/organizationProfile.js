const express = require('express');
const authenticateJWT = require('../middleware/authenticateJWT'); // Assuming JWT auth middleware
const multer = require('multer');
const path = require('path');
const router = express.Router();

const {
    uploadProfilePic,
    setLocation,
    setTime,
    getDetails,
    updateLocation,
    updateTime,
    updateDetails,
    setWorkingDays,
    updateWorkingDays
} = require('../controllers/organizationProfileController');

// Storage configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + ext);
    }
});
const upload = multer({ storage: storage });

/**
 * Upload or Update Organization Profile Picture
 */
router.post('/upload-profile-pic', authenticateJWT, upload.single('organizationProfilePic'), uploadProfilePic);

/**
 * Set Organization Location and Radius
 */
router.post('/set-location', authenticateJWT, setLocation);

/**
 * Set In-Time and Out-Time for Organization
 */
router.post('/set-time', authenticateJWT, setTime);

/**
 * Get Organization Details (Including Employee Count)
 */
router.get('/details/:organizationId', authenticateJWT, getDetails);

/**
 * Update Organization Location and Radius
 */
router.put('/update-location', authenticateJWT, updateLocation);

/**
 * Update In-Time and Out-Time for Organization
 */
router.put('/update-time', authenticateJWT, updateTime);

/**
 * Update Organization Details (Name, Address, Profile Pic, etc.)
 */
router.put('/update-details', authenticateJWT, updateDetails);

/**
 * Set Working Days for Organization
 */
router.post('/set-working-days', authenticateJWT, setWorkingDays);

/**
 * Update Working Days for Organization
 */
router.put('/update-working-days', authenticateJWT, updateWorkingDays);

module.exports = router;