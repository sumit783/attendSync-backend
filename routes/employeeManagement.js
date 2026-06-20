const express = require('express');
const jwt = require('jsonwebtoken');
const Employee = require('../models/employee');
const Organization = require('../models/organization');
const Attendance = require('../models/attendance');
const Leave = require('../models/leave.js');
const authenticateJWT = require('../middleware/authenticateJWT');
const haversineDistance = require('../Helpers/HaversineDistance.js');
const createNotification = require('../Helpers/CreateNotification.js');
const employee = require('../models/employee');
const multer = require('multer');
//const moment = require('moment');
const mongoose = require('mongoose');
const moment = require('moment-timezone'); // ✅ Correct import for timezone support
const router = express.Router();
const path = require('path');

// Configure Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './uploads/'); // Specify the upload directory
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    },
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1024 * 1024 * 2 }, // 2MB limit
});

function calculateDuration(inTime, outTime) {
    // For simplicity, assume inTime and outTime are in HH:MM AM/PM format
    const [inHour, inMinute, inPeriod] = parseTime(inTime);
    const [outHour, outMinute, outPeriod] = parseTime(outTime);

    const inTotalMinutes = inHour * 60 + inMinute + (inPeriod === 'PM' && inHour !== 12 ? 12 * 60 : 0);
    const outTotalMinutes = outHour * 60 + outMinute + (outPeriod === 'PM' && outHour !== 12 ? 12 * 60 : 0);

    const durationMinutes = outTotalMinutes - inTotalMinutes;

    // Convert duration in minutes to hours and minutes
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;

    return `${hours} hours ${minutes} minutes`;
}

// Helper function to parse time in "HH:MM AM/PM" format
function parseTime(time) {
    const [timePart, period] = time.split(' ');
    const [hour, minute] = timePart.split(':').map(num => parseInt(num, 10));
    return [hour, minute, period];
}

router.post('/clock-in-out', authenticateJWT, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { scannerCode, employeeLatitude, employeeLongitude } = req.body;
        const currentDate = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
        const currentLocalTime = moment().tz('Asia/Kolkata').toDate();

        console.log("Received scannerCode:", scannerCode);

        // ✅ Extract and verify token
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            await session.abortTransaction();
            return res.status(401).json({ message: 'Authorization token is required.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const employee = await Employee.findById(decoded.id).session(session);
        if (!employee) {
            await session.abortTransaction();
            return res.status(404).json({ message: 'Employee not found.' });
        }

        // ✅ Fetch organization using scannerCode
        const organization = await Organization.findOne({ qrCode: scannerCode }).session(session);
        if (!organization) {
            await session.abortTransaction();
            return res.status(404).json({ message: 'Invalid scanner code.' });
        }

        // ✅ Check QR Code expiry
        if (!organization.qrCodeExpires || moment(organization.qrCodeExpires).isBefore(moment())) {
            await session.abortTransaction();
            return res.status(400).json({ message: 'QR code has expired. Please scan a new QR code.' });
        }
        // ✅ New Validation: Ensure employee belongs to this organization
        if (!employee.organization.equals(organization._id)) {
            await session.abortTransaction();
            return res.status(403).json({ message: 'You are not authorized to clock in/out for this organization.' });
        }

        // ✅ Calculate distance
        const distance = haversineDistance(
            { latitude: employeeLatitude, longitude: employeeLongitude },
            { latitude: organization.location.coordinates[1], longitude: organization.location.coordinates[0] }
        );

        console.log("Calculated Distance (KM):", distance);
        console.log("Allowed Radius (KM):", organization.radius);

        if (distance > organization.radius) {
            await session.abortTransaction();
            return res.status(400).json({ message: 'You are outside the allowed radius for clock-in/out.' });
        }

        // ✅ Define organization in-time & out-time
        const organizationInTime = moment.tz(
            `${currentDate} ${organization.inTime}`, 'YYYY-MM-DD hh:mm A', 'Asia/Kolkata'
        ).utc().toDate();

        const organizationOutTime = moment.tz(
            `${currentDate} ${organization.outTime}`, 'YYYY-MM-DD hh:mm A', 'Asia/Kolkata'
        ).utc().toDate();

        console.log("Current Local Time (IST):", moment().tz("Asia/Kolkata").format());
        console.log("Organization In-Time (UTC):", organizationInTime);
        console.log("Organization Out-Time (UTC):", organizationOutTime);

        // Calculate org shift window
        let shiftStart = moment.tz(`${currentDate} ${organization.inTime}`, 'YYYY-MM-DD hh:mm A', 'Asia/Kolkata');
        let shiftEnd = moment.tz(`${currentDate} ${organization.outTime}`, 'YYYY-MM-DD hh:mm A', 'Asia/Kolkata');

        // Handle shifts that span midnight
        if (shiftEnd.isBefore(shiftStart)) {
            shiftEnd.add(1, 'day');
        }

        // Find existing attendance that started within this shift window
        let attendanceRecord = await Attendance.findOne({
            employee: employee._id,
            date: {
                $gte: shiftStart.startOf('day').toDate(),
                $lte: shiftEnd.endOf('day').toDate()
            },
            scannerCode
        }).session(session);


        if (!attendanceRecord) {
            // ✅ First-time Clock-in
            const clockInRemark = moment(currentLocalTime).isAfter(moment(organizationInTime)) ? 'Late' : 'Present';

            attendanceRecord = new Attendance({
                employee: employee._id,
                employeeName: employee.employeeName,
                organizationCode: employee.organizationCode,
                date: currentDate,
                scannerCode,
                sessions: [{
                    clockInTime: currentLocalTime,
                    clockInRemark
                }]
            });

            await attendanceRecord.save({ session });

            await createNotification(employee._id, organization._id, 'You have successfully clocked in.', 'ClockIn', session, 'Employee');

            await session.commitTransaction();
            return res.status(200).json({
                message: 'Clocked in successfully.',
                employeeName: employee.employeeName,
                clockInTime: currentLocalTime,
                clockInRemark
            });
        }

        const lastSession = attendanceRecord.sessions[attendanceRecord.sessions.length - 1];

        if (!lastSession.clockOutTime) {
            // ✅ Clock-out logic
            lastSession.clockOutTime = currentLocalTime;
            lastSession.duration = Math.max(0.01, ((currentLocalTime - lastSession.clockInTime) / (1000 * 60 * 60)).toFixed(2));

            // ✅ Calculate total hours and determine final remark
            attendanceRecord.calculateTotalHoursAndRemark(organizationInTime, organizationOutTime);

            await attendanceRecord.save({ session });

            await createNotification(employee._id, organization._id, 'You have successfully clocked out.', 'ClockOut', session, 'Employee');

            await session.commitTransaction();
            return res.status(200).json({
                message: 'Clocked out successfully.',
                employeeName: attendanceRecord.employeeName,
                clockOutTime: lastSession.clockOutTime,
                totalHours: attendanceRecord.totalHours,
                finalRemark: attendanceRecord.finalRemark
            });
        } else {
            // ✅ Additional Clock-in
            attendanceRecord.sessions.push({
                clockInTime: currentLocalTime,
                clockInRemark: 'Present' // No "Late" after the first clock-in
            });

            await attendanceRecord.save({ session });

            await createNotification(employee._id, organization._id, 'You have successfully clocked in again.', 'ClockIn', session, 'Employee');

            await session.commitTransaction();
            return res.status(200).json({
                message: 'Clocked in successfully.',
                employeeName: employee.employeeName,
                clockInTime: currentLocalTime
            });
        }
    } catch (error) {
        await session.abortTransaction();
        console.error('Error in /clock-in-out:', error);
        res.status(500).json({ message: 'Internal server error.', error: error.message });
    } finally {
        session.endSession();
    }
});

router.get('/employee-calendar', authenticateJWT, async (req, res) => {
    try {
        const employeeId = req.user.id;

        // Step 1: Get employee and their org code
        const employee = await Employee.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found.' });
        }

        const organizationCode = employee.organizationCode;

        // Step 2: Fetch all attendance records
        const attendances = await Attendance.find({
            employee: employeeId,
            organizationCode
        });

        // Step 3: Fetch all approved leave records
        const leaves = await Leave.find({
            employee: employeeId,
            organizationCode,
            status: 'Approved'
        });
        //console.log(leaves)

        // Step 4: Build maps of attendance and leave dates
        const attendanceMap = {};
        const allAttendanceDates = new Set();

        attendances.forEach(a => {
            const dateStr = moment(a.date).format('YYYY-MM-DD');
            attendanceMap[dateStr] = a.finalRemark;
            allAttendanceDates.add(dateStr);
        });

        const leaveDates = new Set();
        leaves.forEach(leave => {
            const leaveStart = moment(leave.startDate);
            const leaveEnd = moment(leave.endDate);
            for (let m = moment(leaveStart); m.diff(leaveEnd, 'days') <= 0; m.add(1, 'days')) {
                leaveDates.add(m.format('YYYY-MM-DD'));
            }
        });

        const allDates = new Set([...allAttendanceDates, ...leaveDates]);

        // Step 5: Categorize dates
        const result = {
            employeeId,
            employeeName: employee.employeeName,
            presentDates: [],
            absentDates: [],
            leaveDates: [],
        };

        allDates.forEach(date => {
            if (['Present', 'Half Day', 'Left Early'].includes(attendanceMap[date])) {
                result.presentDates.push(date);
            } else if (leaveDates.has(date)) {
                result.leaveDates.push(date);
            } else {
                result.absentDates.push(date);
            }
        });

        res.status(200).json(result);
    } catch (err) {
        console.error('Error fetching attendance status:', err);
        res.status(500).json({ message: 'Server Error' });
    }
});

router.get('/all-present-days', authenticateJWT, async (req, res) => {
    try {
        // Extract and verify JWT token
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Authorization token is required.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const employee = await Employee.findById(decoded.id);
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found.' });
        }

        // Fetch all records where the employee was present (finalRemark is NOT 'Absent')
        const presentDays = await Attendance.find({
            employee: employee._id,
            finalRemark: { $ne: 'Absent' } // Fetches only present days
        }).sort({ date: 1 }).select('date finalRemark');

        res.status(200).json({ presentDays });
    } catch (error) {
        console.error('Error in /all-present-days:', error);
        res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
});

router.get('/profile', authenticateJWT, async (req, res) => {
    try {
        // Check for the authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).send({ message: 'Authorization header missing' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch the employee by ID with populated organization details
        const employeeInstance = await Employee.findById(decoded.id).populate('organization');
        if (!employeeInstance) {
            return res.status(404).send({ message: 'Employee not found' });
        }

        // Send the employee profile as a response
        res.status(200).json({
            message: 'Employee profile fetched successfully',
            id: employeeInstance._id,
            employeeName: employeeInstance.employeeName,
            employeeEmail: employeeInstance.employeeEmail,
            organizationCode: employeeInstance.organizationCode,
            profilePic: employeeInstance.profilePic,
            isVerified: employeeInstance.isVerified,
            createdAt: employeeInstance.createdAt,
            updatedAt: employeeInstance.updatedAt,
            organization: employeeInstance.organization,
        });
    } catch (error) {
        console.error('Error fetching employee profile:', error);

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).send({ message: 'Invalid token' });
        }

        // Handle other server errors
        res.status(500).json({ message: 'Server error' });
    }
});

// Route to upload profile picture
router.post('/upload-profile-pic', authenticateJWT, upload.single('profilePic'), async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).send({ message: 'Authorization header missing' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Find the employee by ID
        const employeeInstance = await Employee.findById(decoded.id);
        console.log(decoded.id)
        if (!employeeInstance) {
            return res.status(404).send({ message: 'Employee not found' });
        }

        // Check if a file is uploaded
        if (!req.file) {
            return res.status(400).send({ message: 'No file uploaded' });
        }

        // Save the file path to the employee's profile
        const filePath = req.file.path; // Local path to the file
        employeeInstance.profilePic = filePath;
        await employeeInstance.save();

        res.status(200).json({
            message: 'Profile picture uploaded successfully',
            profilePic: filePath,
        });
    } catch (error) {
        console.error('Error uploading profile picture:', error);

        if (error instanceof multer.MulterError) {
            return res.status(400).send({ message: error.message });
        }

        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/attendance/today', authenticateJWT, async (req, res) => {
    try {
        // Extract JWT token
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Authorization token is required.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Find the employee
        const employee = await Employee.findById(decoded.id);
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found.' });
        }

        // Get today's date range
        const startOfDay = moment().startOf('day').toDate();
        const endOfDay = moment().endOf('day').toDate();

        // Fetch today's attendance record
        const attendanceRecord = await Attendance.findOne({
            employee: employee._id,
            date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (!attendanceRecord) {
            return res.status(200).json({ message: 'No attendance record found for today.' });
        }

        // Calculate total hours if sessions exist
        let totalHours = attendanceRecord.totalHours || 0;
        if (!totalHours && attendanceRecord.sessions.length > 0) {
            totalHours = attendanceRecord.sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
        }

        // Extract clock-in and clock-out details
        const firstSession = attendanceRecord.sessions.length > 0 ? attendanceRecord.sessions[0] : null;
        const lastSession = attendanceRecord.sessions.length > 0 ? attendanceRecord.sessions[attendanceRecord.sessions.length - 1] : null;

        // Format session details
        const formattedSessions = attendanceRecord.sessions.map(session => ({
            clockInTime: session.clockInTime || 'Not clocked in',
            clockInRemark: session.clockInRemark || 'N/A',
            clockOutTime: session.clockOutTime || 'Not clocked out',
            clockOutRemark: session.clockOutRemark || 'N/A',
            duration: session.duration || 0,
        }));

        // Construct final response
        const formattedRecord = {
            date: attendanceRecord.date.toISOString().split('T')[0], // YYYY-MM-DD format
            clockInTime: firstSession?.clockInTime || 'Not clocked in',
            clockInRemark: firstSession?.clockInRemark || 'N/A',
            clockOutTime: lastSession?.clockOutTime || 'Not clocked out',
            clockOutRemark: lastSession?.clockOutRemark || 'N/A',
            totalHours: totalHours,
            sessions: formattedSessions, // Include all sessions
        };

        res.status(200).json({ attendance: formattedRecord });
    } catch (error) {
        console.error('Error fetching today\'s attendance record:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

router.get('/attendance/present-nearby', authenticateJWT, async (req, res) => {
    try {
        console.log("Received Request Body:", req.body);

        // Extract search keyword from query param
        const searchKeyword = req.query.search?.toLowerCase() || '';

        // Extract JWT token
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Authorization token is required.' });
        }

        // Verify and decode the token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Find the requesting employee
        const requestingEmployee = await Employee.findById(decoded.id);
        if (!requestingEmployee) {
            return res.status(404).json({ message: 'Employee not found.' });
        }

        // Fetch attendances where clockInTime exists
        const presentEmployees = await Attendance.find({
            'sessions.clockInTime': { $exists: true }
        }).populate('employee', 'employeeName profilePic');

        if (!presentEmployees.length) {
            return res.status(200).json({
                message: 'No employees currently present nearby.',
                presentEmployees: []
            });
        }

        // Deduplicate employees
        const uniqueMap = new Map();
        presentEmployees.forEach(record => {
            const emp = record.employee;
            const empId = emp?._id?.toString();
            if (
                empId &&
                !uniqueMap.has(empId) &&
                (!searchKeyword || emp.employeeName.toLowerCase().includes(searchKeyword))
            ) {
                uniqueMap.set(empId, {
                    name: emp.employeeName,
                    profileImage: emp.profilePic || 'default.png'
                });
            }
        });

        const presentList = Array.from(uniqueMap.values());

        res.status(200).json({ presentEmployees: presentList });

    } catch (error) {
        console.error('Error fetching present employees:', error);
        res.status(500).json({ message: 'Server error', error: error.stack });
    }
});

router.get('/attendance/:date', authenticateJWT, async (req, res) => {
    try {
        // Extract JWT token
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Authorization token is required.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Find the employee
        const employee = await Employee.findById(decoded.id);
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found.' });
        }

        // Get the selected date from params
        const selectedDate = req.params.date; // Format: YYYY-MM-DD
        const startOfDay = moment(selectedDate).startOf('day').toDate();
        const endOfDay = moment(selectedDate).endOf('day').toDate();

        // Fetch attendance record for the selected date
        const attendanceRecord = await Attendance.findOne({
            employee: employee._id,
            date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (!attendanceRecord) {
            return res.status(200).json({ message: `No attendance record found for ${selectedDate}.` });
        }

        // Calculate total hours if sessions exist
        let totalHours = attendanceRecord.totalHours || 0;
        if (!totalHours && attendanceRecord.sessions.length > 0) {
            totalHours = attendanceRecord.sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
        }

        // Extract first and last session details
        const firstSession = attendanceRecord.sessions.length > 0 ? attendanceRecord.sessions[0] : null;
        const lastSession = attendanceRecord.sessions.length > 0 ? attendanceRecord.sessions[attendanceRecord.sessions.length - 1] : null;

        // Format session details
        const formattedSessions = attendanceRecord.sessions.map(session => ({
            clockInTime: session.clockInTime || 'Not clocked in',
            clockInRemark: session.clockInRemark || 'N/A',
            clockOutTime: session.clockOutTime || 'Not clocked out',
            clockOutRemark: session.clockOutRemark || 'N/A',
            duration: session.duration || 0,
        }));

        // Construct final response
        const formattedRecord = {
            date: selectedDate,
            clockInTime: firstSession?.clockInTime || 'Not clocked in',
            clockInRemark: firstSession?.clockInRemark || 'N/A',
            clockOutTime: lastSession?.clockOutTime || 'Not clocked out',
            clockOutRemark: lastSession?.clockOutRemark || 'N/A',
            totalHours: totalHours,
            sessions: formattedSessions, // Include all sessions
        };

        res.status(200).json({ attendance: formattedRecord });
    } catch (error) {
        console.error('Error fetching attendance record rrrrrrrr:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;