// Function to send OTP email
const sendOTPEmail = async (email, otp, subject) => {
  try {
    const response = await fetch('https://smtp-otp.vercel.app/api/v1/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: email,
        subject: subject,
        project: 'AttendSync',
        apiKey: 'XrFBLePtHyxm',
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
        `
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('❌ Error sending OTP email:', errorData);
      return;
    }

    const data = await response.json();

    console.log('✅ OTP email sent successfully:');
    console.log('    - Recipient:', email);
    console.log('    - Subject:', subject);
    console.log('    - Response ID:', data.messageId);
  } catch (error) {
    console.error('❌ Exception sending OTP email:', error.message);
  }
};

module.exports = sendOTPEmail;
