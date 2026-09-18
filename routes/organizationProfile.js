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

// Replaced local multer with Cloudinary storage

/**
 * Upload or Update Organization Profile Picture
 */
router.post('/upload-profile-pic', authenticateAdmin, requireOrganizationAccess, upload.single('organizationProfilePic'), uploadProfilePic);

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