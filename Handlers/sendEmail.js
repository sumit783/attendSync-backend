const { Resend } = require('resend');
require('dotenv').config();

// Initialize Resend with your API Key
const resend = new Resend(process.env.RESEND_API_KEY);

// Function to send OTP email
const sendOTPEmail = async (email, otp, subject) => {
  try {
    const { data, error } = await resend.emails.send({
      // Resend requires a verified domain to send from. 
      // For testing, Resend allows sending to the email address registered to your account using 'onboarding@resend.dev' as the sender.
      // Once you add and verify a domain, you can change this (e.g., 'no-reply@yourdomain.com').
      from: 'onboarding@resend.dev', 
      to: email, 
      subject: subject, 
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
    });

    if (error) {
      console.error('❌ Error sending OTP email:', error);
      return;
    }

    console.log('✅ OTP email sent successfully:');
    console.log('    - Recipient:', email);
    console.log('    - Subject:', subject);
    console.log('    - Response ID:', data.id);
  } catch (error) {
    console.error('❌ Exception sending OTP email:', error.message);
  }
};

module.exports = sendOTPEmail;
