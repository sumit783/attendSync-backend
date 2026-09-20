const express = require('express');
const router = express.Router();

const {
    signup,
    login,
    verifyOtp,
    forgotPassword,
    resetPassword,
    createOrganization,
    createAdminForOrganization,
    getSuperAdminOrganizations
} = require('../controllers/organizationAuthController');

const authenticateAdmin = require('../middleware/authenticateAdmin');

/**
 * @swagger
 * tags:
 *   name: Admin Authentication
 *   description: Admin and Organization authentication management
 */

// ================== Admin / Organization Signup ==================
/**
 * @swagger
 * /api/organization/signup:
 *   post:
 *     summary: Sign up an Admin / Super Admin
 *     tags: [All Company]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - organizationEmail
 *               - password
 *               - confirmPassword
 *             properties:
 *               organizationEmail:
 *                 type: string
 *               password:
 *                 type: string
 *               confirmPassword:
 *                 type: string
 *               organizationName:
 *                 type: string
 *                 description: Optional. If provided, creates an organization and links it to the admin as SUPER_ADMIN.
 *               organizationOwnerName:
 *                 type: string
 *     responses:
 *       201:
 *         description: Admin created successfully.
 *       400:
 *         description: Invalid input or user already exists.
 */
router.post('/signup', signup);

// ================== Admin Login ==================
/**
 * @swagger
 * /api/organization/login:
 *   post:
 *     summary: Log in an Admin
 *     tags: [All Company]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Admin login successful. Returns token and admin details.
 *       400:
 *         description: Invalid email or password.
 */
router.post('/login', login);

/**
 * @swagger
 * /api/organization/verify-otp:
 *   post:
 *     summary: Verify OTP for email verification or password reset
 *     tags: [All Company]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *               - action
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *               action:
 *                 type: string
 *                 enum: [verify-email, forgot-password]
 *     responses:
 *       200:
 *         description: OTP verified successfully.
 *       400:
 *         description: Invalid OTP or Admin not found.
 */
router.post('/verify-otp', verifyOtp);

// ================== Forgot & Reset Password ==================
/**
 * @swagger
 * /api/organization/forgot-password:
 *   post:
 *     summary: Send OTP for password reset
 *     tags: [All Company]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent to email.
 *       400:
 *         description: User not found.
 */
router.post('/forgot-password', forgotPassword);

/**
 * @swagger
 * /api/organization/reset-password:
 *   post:
 *     summary: Reset password with OTP
 *     tags: [All Company]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *               - newPassword
 *               - confirmNewPassword
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *               newPassword:
 *                 type: string
 *               confirmNewPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successfully.
 *       400:
 *         description: Invalid OTP or passwords do not match.
 */
router.post('/reset-password', resetPassword);

// ================== Super Admin Routes ==================
/**
 * @swagger
 * /api/organization/create-organization:
 *   post:
 *     summary: Create a new Organization (Super Admin only)
 *     tags: [All Company]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - organizationName
 *               - organizationOwnerName
 *             properties:
 *               organizationName:
 *                 type: string
 *               organizationOwnerName:
 *                 type: string
 *     responses:
 *       201:
 *         description: Organization created successfully.
 *       401:
 *         description: Unauthorized.
 */
router.post('/create-organization', authenticateAdmin, createOrganization);

/**
 * @swagger
 * /api/organization/create-admin:
 *   post:
 *     summary: Create a dedicated Admin for an Organization (Super Admin only)
 *     tags: [All Company]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - organizationId
 *               - email
 *               - password
 *             properties:
 *               organizationId:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: Admin created successfully for the organization.
 *       400:
 *         description: Invalid input or Admin already exists.
 */
router.post('/create-admin', authenticateAdmin, createAdminForOrganization);

/**
 * @swagger
 * /api/organization/my-companies:
 *   get:
 *     summary: Get a list of all companies under a Super Admin
 *     tags: [All Company]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of organizations.
 *       401:
 *         description: Unauthorized.
 */
router.get('/my-companies', authenticateAdmin, getSuperAdminOrganizations);

module.exports = router;
