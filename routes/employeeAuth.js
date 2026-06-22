const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Employee = require('../models/employee');
const Organization = require('../models/organization');
const sendOTPEmail = require('../Handlers/sendEmail');
const Notification = require('../models/notification'); 
const router = express.Router();

const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit OTP

router.post('/signup', async (req, res) => {
    try {
        const { employeeName, employeeEmail, password, confirmPassword, organizationCode } = req.body;

        if (!employeeName || !employeeEmail || !password || !confirmPassword || !organizationCode) {
            return res.status(400).send({ message: 'Please enter all required data' });
        }

        if (password !== confirmPassword) {
            return res.status(400).send({ message: 'Passwords do not match' });
        }

        // Find the organization using organizationCode
        const organization = await Organization.findOne({ organizationCode });

        if (!organization) {
            return res.status(400).send({ message: 'Invalid organization code' });
        }

        const existingEmployee = await Employee.findOne({ employeeEmail });

        if (existingEmployee) {
            if (existingEmployee.isVerified) {
                return res.status(400).send({ message: 'Employee already exists' });
            } else {
                // Update OTP and resend
                const otp = generateOTP();
                existingEmployee.otp = otp;
                existingEmployee.otpExpires = Date.now() + 2 * 60 * 1000;
                await existingEmployee.save();

                sendOTPEmail(employeeEmail, otp, 'Verify your Employee Email Again');
                return res.status(200).send({ message: 'Unverified account found. OTP resent.' });
            }
        }


        const otp = generateOTP();
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save Employee with organization ID reference
        const newEmployee = new Employee({
            employeeName,
            employeeEmail,
            password: hashedPassword,
            organization: organization._id, // Assign the actual organization reference
            isVerified: false, // Mark as unverified
            otp,
            otpExpires: Date.now() + 2 * 60 * 1000, // OTP valid for 2 minutes
        });

        await newEmployee.save();
        sendOTPEmail(employeeEmail, otp, 'Verify your Employee Email');

        res.status(201).send({ message: 'Employee created. Please verify your email.' });

    } catch (error) {
        console.error('Error in signup:', error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    const user = await Employee.findOne({ employeeEmail: email }) || await Organization.findOne({ organizationEmail: email });

    if (!user) {
        return res.status(400).send({ message: 'Invalid email or password' });
    }

    if (!user.isVerified) {
        return res.status(400).send({ message: 'Email is not verified. Please verify your email to log in.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return res.status(400).send({ message: 'Invalid email or password' });
    }

    const userType = user.employeeEmail ? 'Employee' : 'Organization';

    let finalUser = user;
    if (userType === 'Employee') {
        finalUser = await Employee.findById(user._id).populate('organization');
    }

    const token = jwt.sign({ id: user._id, email: user.email || user.organizationEmail }, process.env.JWT_SECRET, { expiresIn: '60d' });

    res.status(200).send({
        message: `${userType} login successful`,
        id: user._id,
        token,
        organizationCode: user.organizationCode || null,
        employee: userType === 'Employee' ? finalUser : undefined,
        organization: userType === 'Organization' ? finalUser : undefined
    });
});

router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp, action } = req.body;

        const user = await Employee.findOne({ employeeEmail: email }) ||
            await Organization.findOne({ organizationEmail: email });

        if (!user) {
            return res.status(400).send({ message: 'User not found' });
        }

        if (user.otp !== otp || user.otpExpires < Date.now()) {
            return res.status(400).send({ message: 'Invalid or expired OTP.' });
        }

        if (action === 'verify-email') {
            // Mark user as verified
            user.isVerified = true;

            // If user is an Employee, assign organizationId and organizationCode
            if (user.employeeEmail) {
                const organization = await Organization.findById(user.organization);

                if (!organization) {
                    return res.status(400).send({ message: 'Organization not found.' });
                }

                user.organizationCode = organization.organizationCode;

                // 🔥 Increment employee count
                organization.employeeCount += 1;
                await organization.save();
                // ✅ Add notification to organization that employee has joined
                const notification = new Notification({
                    user: organization._id, // Not actually used by org for filtering, but kept for consistency
                    organization: organization._id,
                    message: `${user.employeeName} has joined your organization.`,
                    type: 'Join', // or you can create a new type like 'Join', up to your enum
                    target: 'Organization'
                });
                await notification.save();
            }
        }
        else if (action === 'forgot-password') {
            return res.status(200).send({ message: 'OTP verified. You can now reset your password.' });
        } else {
            return res.status(400).send({ message: 'Invalid action specified.' });
        }

        // Clear OTP fields after verification
        user.otp = undefined;
        user.otpExpires = undefined;

        await user.save();
        res.status(200).send({ message: 'Email verified successfully.', organizationCode: user.organizationCode });

    } catch (error) {
        console.error('Error in verify-otp:', error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
});


// ================== Forgot & Reset Password ==================
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const user = await Employee.findOne({ employeeEmail: email });

    if (!user) return res.status(400).send({ message: 'User not found' });

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpires = Date.now() + 2 * 60 * 1000;
    await user.save();

    sendOTPEmail(email, otp, 'Password Reset OTP');
    res.status(200).send({ message: 'Password reset OTP sent to email.' });
});

router.post('/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const user = await Employee.findOne({ employeeEmail: email });

    if (!user || user.otp !== otp || user.otpExpires < Date.now()) {
        return res.status(400).send({ message: 'Invalid or expired OTP.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.status(200).send({ message: 'Password reset successfully.' });
});

module.exports = router;
