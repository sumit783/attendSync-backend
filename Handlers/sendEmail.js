const nodemailer = require('nodemailer');
require('dotenv').config(); // Load environment variables

// Create a transporter for Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Email from the .env file
    pass: process.env.EMAIL_PASS, // App password from the .env file
  },
});

// Function to send OTP email
const sendOTPEmail = (email, otp, subject) => {
  // Define the email options
  const mailOptions = {
    from: process.env.EMAIL_USER, // Sender address
    to: email, // Recipient email
    subject: subject, // Email subject
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #4CAF50;">Your OTP for Verification</h2>
        <p>Hello,</p>
        <p>We received a request to verify your email address. Please use the One-Time Password (OTP) below to complete the process:</p>
        <h3 style="color: #4CAF50; font-size: 24px;">${otp}</h3>
        <p><strong>Note:</strong> This OTP will expire in <strong>2 minutes</strong>. Please use it promptly.</p>
        <p>If you did not request this, please ignore this email.</p>
        <p>Thank you for using our service!</p>
        <p style="color: #555;">- AttendSync</p>
      </div>
    `,
  };

  // Send the email
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('❌ Error sending OTP email:', error.message);
    } else {
      console.log('✅ OTP email sent successfully:');
      console.log('    - Recipient:', email);
      console.log('    - Subject:', subject);
      console.log('    - Response:', info.response);
    }
  });
};

// Example usage
//sendOTPEmail('test_recipient@example.com', '123456', 'Your OTP Code');

module.exports = sendOTPEmail;
