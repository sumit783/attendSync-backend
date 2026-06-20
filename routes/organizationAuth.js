const express = require('express');
const router = express.Router();

const {
    signup,
    login,
    verifyOtp,
    forgotPassword,
    resetPassword
} = require('../controllers/organizationAuthController');

// ================== Organization Signup ==================
router.post('/signup', signup);

// ================== Organization Login ==================
router.post('/login', login);

router.post('/verify-otp', verifyOtp);

// ================== Forgot & Reset Password ==================
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
