const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');
const sendOTPEmail = require('../Handlers/sendEmail');

const generateOTP = () => {
    if (process.env.NODE_ENV === 'development') return '1234';
    return Math.floor(1000 + Math.random() * 9000).toString();
};

exports.signup = async (req, res) => {
    const { organizationName, organizationEmail, organizationOwnerName, password, confirmPassword } = req.body;
  
    if (!organizationName || !organizationEmail || !organizationOwnerName || !password || !confirmPassword) {
      return res.status(400).send({ message: 'Please enter all data' });
    }
  
    if (password !== confirmPassword) {
      return res.status(400).send({ message: 'Passwords do not match' });
    }
  
    const existingOrg = await prisma.organization.findUnique({ where: { organizationEmail } });
    if (existingOrg) {
      return res.status(400).send({ message: 'Organization already exists' });
    }
  
    const organizationCode = generateOTP(); // Unique organization code
    const otp = generateOTP();
    const hashedPassword = await bcrypt.hash(password, 10);
  
    const newOrg = await prisma.organization.create({
      data: {
        organizationName,
        organizationEmail,
        organizationOwnerName,
        password: hashedPassword,
        organizationCode,
        otp,
        otpExpires: new Date(Date.now() + 2 * 60 * 1000),
      }
    });
  
    if (process.env.NODE_ENV !== 'development') {
        sendOTPEmail(organizationEmail, otp, 'Verify your Organization Email');
    }
  
    res.status(201).send({ message: 'Organization created. Please verify your email.' });
};

exports.login = async (req, res) => {
  const { email, organizationEmail, password } = req.body;
  const loginEmail = email || organizationEmail;
  const user = await prisma.organization.findUnique({ where: { organizationEmail: loginEmail } });
  
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(400).send({ message: 'Invalid email or password' });
  }
  
  if (!user.isVerified) {
    return res.status(400).send({ message: 'Email not verified. Please verify your email to log in.' });
  }
  
  const token = jwt.sign({ id: user.id, email: user.organizationEmail }, process.env.JWT_SECRET, { expiresIn: '60d' });
  res.status(200).send({ message: 'Organization login successful', token, id: user.id, organization: user });
};

exports.verifyOtp = async (req, res) => {
  try {
      const { email, otp, action } = req.body;

      const user = await prisma.organization.findUnique({ where: { organizationEmail: email } });
      if (!user) {
          return res.status(400).send({ message: 'Organization not found.' });
      }

      if (user.otp !== otp || !user.otpExpires || user.otpExpires < new Date()) {
          return res.status(400).send({ message: 'Invalid or expired OTP.' });
      }

      const updateData = {
          otp: null,
          otpExpires: null
      };

      if (action === 'verify-email') {
          updateData.isVerified = true;
      } else if (action === 'forgot-password') {
          await prisma.organization.update({
              where: { id: user.id },
              data: updateData
          });
          return res.status(200).send({ message: 'OTP verified. You can now reset your password.' });
      } else {
          return res.status(400).send({ message: 'Invalid action specified.' });
      }

      await prisma.organization.update({
          where: { id: user.id },
          data: updateData
      });

      res.status(200).send({ message: 'Email verified successfully.' });

  } catch (error) {
      console.error('Error in /organization/verify-otp:', error);
      res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.forgotPassword = async (req, res) => {
    const { email } = req.body;
    const user = await prisma.organization.findUnique({ where: { organizationEmail: email } });
  
    if (!user) return res.status(400).send({ message: 'User not found' });
  
    const otp = generateOTP();
    await prisma.organization.update({
        where: { id: user.id },
        data: {
            otp,
            otpExpires: new Date(Date.now() + 2 * 60 * 1000)
        }
    });
  
    if (process.env.NODE_ENV !== 'development') {
        sendOTPEmail(email, otp, 'Password Reset OTP');
    }
    res.status(200).send({ message: 'Password reset OTP sent to email.' });
};
  
exports.resetPassword = async (req, res) => {
    const { email, otp, newPassword, confirmNewPassword } = req.body;

    if (!email || !otp || !newPassword || !confirmNewPassword) {
        return res.status(400).send({ message: 'Please enter all required fields.' });
    }

    if (newPassword !== confirmNewPassword) {
        return res.status(400).send({ message: 'New passwords do not match.' });
    }

    const user = await prisma.organization.findUnique({ where: { organizationEmail: email } });

    if (!user || user.otp !== otp || !user.otpExpires || user.otpExpires < new Date()) {
        return res.status(400).send({ message: 'Invalid or expired OTP.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.organization.update({
        where: { id: user.id },
        data: {
            password: hashedPassword,
            otp: null,
            otpExpires: null
        }
    });

    res.status(200).send({ message: 'Password reset successfully.' });
};
