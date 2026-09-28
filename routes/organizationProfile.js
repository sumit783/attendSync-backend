const express = require('express');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const requireOrganizationAccess = require('../middleware/requireOrganizationAccess');
const { upload } = require('../config/cloudinary');
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

const handleUpload = (req, res, next) => {
    upload.any()(req, res, (err) => {
        if (err) {
            console.error('Multer upload error:', err);
            return res.status(400).send({ message: err.message || 'File upload error' });
        }
        if (req.files && req.files.length > 0) {
            req.file = req.files[0];
        }
        next();
    });
};

/**
 * Upload or Update Organization Profile Picture (Blob / Base64 format)
 */
router.post('/upload-profile-pic', handleUpload, authenticateAdmin, requireOrganizationAccess, uploadProfilePic);

/**
 * Set Organization Location and Radius
 */
router.post('/set-location', authenticateAdmin, requireOrganizationAccess, setLocation);

/**
 * Set In-Time and Out-Time for Organization
 */
router.post('/set-time', authenticateAdmin, requireOrganizationAccess, setTime);

/**
 * Get Organization Details (Including Employee Count)
 */
router.get('/details/:organizationId', authenticateAdmin, requireOrganizationAccess, getDetails);

/**
 * Update Organization Location and Radius
 */
router.put('/update-location', authenticateAdmin, requireOrganizationAccess, updateLocation);

/**
 * Update In-Time and Out-Time for Organization
 */
router.put('/update-time', authenticateAdmin, requireOrganizationAccess, updateTime);

/**
 * Update Organization Details (Name, Address, Profile Pic, etc.)
 */
router.put('/update-details', authenticateAdmin, requireOrganizationAccess, updateDetails);

/**
 * Set Working Days for Organization
 */
router.post('/set-working-days', authenticateAdmin, requireOrganizationAccess, setWorkingDays);

/**
 * Update Working Days for Organization
 */
router.put('/update-working-days', authenticateAdmin, requireOrganizationAccess, updateWorkingDays);

module.exports = router;