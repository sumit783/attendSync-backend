const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Organization = require('../models/organization');
const sendOTPEmail = require('../Handlers/sendEmail');

const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit OTP

exports.signup = async (req, res) => {
    const { organizationName, organizationEmail, organizationOwnerName, password, confirmPassword } = req.body;
  
    if (!organizationName || !organizationEmail || !organizationOwnerName || !password || !confirmPassword) {
      return res.status(400).send({ message: 'Please enter all data' });
    }
  
    if (password !== confirmPassword) {
      return res.status(400).send({ message: 'Passwords do not match' });
    }
  
    const existingOrg = await Organization.findOne({ organizationEmail });
    if (existingOrg) {
      return res.status(400).send({ message: 'Organization already exists' });
    }
  
    const organizationCode = generateOTP(); // Unique organization code
    const otp = generateOTP();
    const hashedPassword = await bcrypt.hash(password, 10);
  
    const newOrg = new Organization({
      organizationName,
      organizationEmail,
      organizationOwnerName,
      password: hashedPassword,
      organizationCode,
      otp,
      otpExpires: Date.now() + 2 * 60 * 1000,
    });
  
    await newOrg.save();
    sendOTPEmail(organizationEmail, otp, 'Verify your Organization Email');
  
    res.status(201).send({ message: 'Organization created. Please verify your email.' });
};

exports.login = async (req, res) => {
  const { email, organizationEmail, password } = req.body;
  const loginEmail = email || organizationEmail;
  const user = await Organization.findOne({ organizationEmail: loginEmail });
  
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(400).send({ message: 'Invalid email or password' });
  }
  
  if (!user.isVerified) {
    return res.status(400).send({ message: 'Email not verified. Please verify your email to log in.' });
  }
  
  const token = jwt.sign({ id: user._id, email: user.organizationEmail }, process.env.JWT_SECRET, { expiresIn: '60d' });
  res.status(200).send({ message: 'Organization login successful', token, id: user._id, organization: user });
};

exports.verifyOtp = async (req, res) => {
  try {
      const { email, otp, action } = req.body;

      const user = await Organization.findOne({ organizationEmail: email });
      if (!user) {
          return res.status(400).send({ message: 'Organization not found.' });
      }

      if (user.otp !== otp || user.otpExpires < Date.now()) {
          return res.status(400).send({ message: 'Invalid or expired OTP.' });
      }

      if (action === 'verify-email') {
          user.isVerified = true;
      } else if (action === 'forgot-password') {
          return res.status(200).send({ message: 'OTP verified. You can now reset your password.' });
      } else {
          return res.status(400).send({ message: 'Invalid action specified.' });
      }

      user.otp = undefined;
      user.otpExpires = undefined;
      await user.save();

      res.status(200).send({ message: 'Email verified successfully.' });

  } catch (error) {
      console.error('Error in /organization/verify-otp:', error);
      res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.forgotPassword = async (req, res) => {
    const { email } = req.body;
    const user = await Organization.findOne({ organizationEmail: email });
  
    if (!user) return res.status(400).send({ message: 'User not found' });
  
    const otp = generateOTP();
    user.otp = otp;
    user.otpExpires = Date.now() + 2 * 60 * 1000;
    await user.save();
  
    sendOTPEmail(email, otp, 'Password Reset OTP');
    res.status(200).send({ message: 'Password reset OTP sent to email.' });
};
  
exports.resetPassword = async (req, res) => {
    const { email, otp, newPassword, confirmNewPassword } = req.body;

    // Check if all required fields are present
    if (!email || !otp || !newPassword || !confirmNewPassword) {
        return res.status(400).send({ message: 'Please enter all required fields.' });
    }

    // Check if new password and confirm password match
    if (newPassword !== confirmNewPassword) {
        return res.status(400).send({ message: 'New passwords do not match.' });
    }

    const user = await Organization.findOne({ organizationEmail: email });

    // Validate OTP and its expiration
    if (!user || user.otp !== otp || user.otpExpires < Date.now()) {
        return res.status(400).send({ message: 'Invalid or expired OTP.' });
    }

    // Hash the new password and update the user record
    user.password = await bcrypt.hash(newPassword, 10);
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.status(200).send({ message: 'Password reset successfully.' });
};
