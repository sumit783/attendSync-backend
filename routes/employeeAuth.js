const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sendOTPEmail = require('../Handlers/sendEmail');
const prisma = require('../prisma/client');
const router = express.Router();

const generateOTP = () => {
    if (process.env.NODE_ENV === 'development') return '1234';
    return Math.floor(1000 + Math.random() * 9000).toString();
};

router.post('/signup', async (req, res) => {
    try {
        const { employeeName, employeeEmail, password, confirmPassword, organizationCode } = req.body;

        if (!employeeName || !employeeEmail || !password || !confirmPassword || !organizationCode) {
            return res.status(400).send({ message: 'Please enter all required data' });
        }

        if (password !== confirmPassword) {
            return res.status(400).send({ message: 'Passwords do not match' });
        }

        const organization = await prisma.organization.findUnique({
            where: { organizationCode }
        });

        if (!organization) {
            return res.status(400).send({ message: 'Invalid organization code' });
        }

        const existingEmployee = await prisma.employee.findUnique({
            where: { employeeEmail }
        });

        if (existingEmployee) {
            if (existingEmployee.isVerified) {
                return res.status(400).send({ message: 'Employee already exists' });
            } else {
                const otp = generateOTP();
                await prisma.employee.update({
                    where: { id: existingEmployee.id },
                    data: {
                        otp,
                        otpExpires: new Date(Date.now() + 2 * 60 * 1000)
                    }
                });

                if (process.env.NODE_ENV !== 'development') {
                    sendOTPEmail(employeeEmail, otp, 'Verify your Employee Email Again');
                }
                return res.status(200).send({ message: 'Unverified account found. OTP resent.' });
            }
        }

        const otp = generateOTP();
        const hashedPassword = await bcrypt.hash(password, 10);

        const newEmployee = await prisma.employee.create({
            data: {
                employeeName,
                employeeEmail,
                password: hashedPassword,
                organizationId: organization.id,
                organizationCode,
                isVerified: false,
                otp,
                otpExpires: new Date(Date.now() + 2 * 60 * 1000),
            }
        });

        if (process.env.NODE_ENV !== 'development') {
            sendOTPEmail(employeeEmail, otp, 'Verify your Employee Email');
        }
        res.status(201).send({ message: 'Employee created. Please verify your email.' });

    } catch (error) {
        console.error('Error in signup:', error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password, deviceId, deviceModel, manufacturer, platform, osVersion } = req.body;

        const employee = await prisma.employee.findUnique({ where: { employeeEmail: email }, include: { organization: true, shift: true, devices: { where: { status: 'ACTIVE' } } } });
        
        let userType = 'Employee';
        let user = employee;

        if (!user) {
            const org = await prisma.organization.findUnique({ where: { organizationEmail: email } });
            if (org) {
                user = org;
                userType = 'Organization';
            }
        }

        if (!user) return res.status(400).send({ message: 'Invalid email or password' });
        
        if (!user.isVerified) return res.status(400).send({ message: 'Email is not verified. Please verify your email to log in.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).send({ message: 'Invalid email or password' });

        if (userType === 'Employee' && deviceId) {
            if (user.devices.length === 0) {
                // Register Device
                await prisma.employeeDevice.create({
                    data: {
                        employeeId: user.id,
                        uuid: deviceId,
                        model: deviceModel || 'Unknown',
                        manufacturer: manufacturer || 'Unknown',
                        androidVersion: osVersion || 'Unknown',
                        status: 'ACTIVE'
                    }
                });
            } else if (user.devices[0].uuid !== deviceId && process.env.NODE_ENV !== 'development') {
                return res.status(403).send({ message: 'Unauthorized device. Please contact your admin to reset your device.' });
            }
        }

        const token = jwt.sign({ id: user.id, email: user.employeeEmail || user.organizationEmail }, process.env.JWT_SECRET, { expiresIn: '60d' });

        res.status(200).send({
            message: `${userType} login successful`,
            id: user.id,
            token,
            organizationCode: user.organizationCode || null,
            employee: userType === 'Employee' ? user : undefined,
            organization: userType === 'Organization' ? user : undefined
        });
    } catch(err) {
        console.error('Error in login:', err);
        res.status(500).send({ message: 'Internal Server Error' });
    }
});

router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp, action } = req.body;

        const employee = await prisma.employee.findUnique({ where: { employeeEmail: email } });
        const org = await prisma.organization.findUnique({ where: { organizationEmail: email } });

        const user = employee || org;

        if (!user) return res.status(400).send({ message: 'User not found' });

        if (user.otp !== otp || user.otpExpires < new Date()) {
            return res.status(400).send({ message: 'Invalid or expired OTP.' });
        }

        if (action === 'verify-email') {
            if (employee) {
                await prisma.employee.update({
                    where: { id: user.id },
                    data: { isVerified: true, otp: null, otpExpires: null }
                });
                
                await prisma.organization.update({
                    where: { id: user.organizationId },
                    data: { employeeCount: { increment: 1 } }
                });
            } else {
                await prisma.organization.update({
                    where: { id: user.id },
                    data: { isVerified: true, otp: null, otpExpires: null }
                });
            }
        }
        else if (action === 'forgot-password') {
            return res.status(200).send({ message: 'OTP verified. You can now reset your password.' });
        } else {
            return res.status(400).send({ message: 'Invalid action specified.' });
        }

        res.status(200).send({ message: 'Email verified successfully.', organizationCode: user.organizationCode });

    } catch (error) {
        console.error('Error in verify-otp:', error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
});


router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await prisma.employee.findUnique({ where: { employeeEmail: email } });
    
        if (!user) return res.status(400).send({ message: 'User not found' });
    
        const otp = generateOTP();
        await prisma.employee.update({
            where: { id: user.id },
            data: { otp, otpExpires: new Date(Date.now() + 2 * 60 * 1000) }
        });
    
        if (process.env.NODE_ENV !== 'development') {
            sendOTPEmail(email, otp, 'Password Reset OTP');
        }
        res.status(200).send({ message: 'Password reset OTP sent to email.' });
    } catch(err) {
        console.error(err);
        res.status(500).send({ message: 'Internal Server Error' });
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const user = await prisma.employee.findUnique({ where: { employeeEmail: email } });
    
        if (!user || user.otp !== otp || user.otpExpires < new Date()) {
            return res.status(400).send({ message: 'Invalid or expired OTP.' });
        }
    
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await prisma.employee.update({
            where: { id: user.id },
            data: { password: hashedPassword, otp: null, otpExpires: null }
        });
    
        res.status(200).send({ message: 'Password reset successfully.' });
    } catch(err) {
        console.error(err);
        res.status(500).send({ message: 'Internal Server Error' });
    }
});

module.exports = router;
