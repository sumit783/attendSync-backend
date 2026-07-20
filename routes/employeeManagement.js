const express = require('express');
const jwt = require('jsonwebtoken');
const authenticateJWT = require('../middleware/authenticateJWT');
const haversineDistance = require('../Helpers/HaversineDistance.js');
const createNotification = require('../Helpers/CreateNotification.js');
const multer = require('multer');
const moment = require('moment-timezone');
const prisma = require('../prisma/client');
const router = express.Router();

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
    try {
        const { wifiSSID, wifiBSSID, deviceId, ipAddress, employeeLatitude, employeeLongitude } = req.body;
        const currentDate = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
        const currentLocalTime = moment().tz('Asia/Kolkata').toDate();

        const employee = await prisma.employee.findUnique({
            where: { id: req.user.id },
            include: { organization: true, devices: { where: { status: 'ACTIVE' } } }
        });

        if (!employee) return res.status(404).json({ message: 'Employee not found.' });

        // ✅ Validate Device
        if (employee.devices.length === 0 || employee.devices[0].uuid !== deviceId) {
            return res.status(403).json({ message: 'Device not registered or revoked. Please contact administrator.' });
        }

        const organization = employee.organization;

        // ✅ Check WiFi
        if (organization.wifiSSID && organization.wifiSSID !== wifiSSID) {
            return res.status(400).json({ message: `Wrong Wi-Fi. Please connect to ${organization.wifiSSID}.` });
        }
        if (organization.wifiBSSID && organization.wifiBSSID !== wifiBSSID) {
            return res.status(400).json({ message: 'Wi-Fi BSSID mismatch.' });
        }

        // ✅ GPS Check
        if (employeeLatitude && employeeLongitude && organization.latitude && organization.longitude && organization.radius) {
            const distance = haversineDistance(
                { latitude: employeeLatitude, longitude: employeeLongitude },
                { latitude: organization.latitude, longitude: organization.longitude }
            );
            if (distance > organization.radius) {
                return res.status(400).json({ message: 'You are outside the allowed radius for clock-in/out.' });
            }
        }

        const organizationInTime = moment.tz(`${currentDate} ${organization.inTime}`, 'YYYY-MM-DD hh:mm A', 'Asia/Kolkata').utc().toDate();
        const organizationOutTime = moment.tz(`${currentDate} ${organization.outTime}`, 'YYYY-MM-DD hh:mm A', 'Asia/Kolkata').utc().toDate();

        let shiftStart = moment.tz(`${currentDate} ${organization.inTime}`, 'YYYY-MM-DD hh:mm A', 'Asia/Kolkata');
        let shiftEnd = moment.tz(`${currentDate} ${organization.outTime}`, 'YYYY-MM-DD hh:mm A', 'Asia/Kolkata');
        if (shiftEnd.isBefore(shiftStart)) shiftEnd.add(1, 'day');

        // Find today's attendance
        let attendanceRecord = await prisma.attendance.findFirst({
            where: {
                employeeId: employee.id,
                date: {
                    gte: shiftStart.startOf('day').toDate(),
                    lte: shiftEnd.endOf('day').toDate()
                }
            },
            include: { sessions: true }
        });

        if (!attendanceRecord) {
            // First time clock-in
            const clockInRemark = moment(currentLocalTime).isAfter(moment(organizationInTime)) ? 'Late' : 'Present';

            attendanceRecord = await prisma.attendance.create({
                data: {
                    employeeId: employee.id,
                    employeeName: employee.employeeName,
                    organizationCode: employee.organizationCode,
                    date: currentLocalTime,
                    wifiSSID,
                    wifiBSSID,
                    deviceId,
                    ipAddress,
                    latitude: employeeLatitude,
                    longitude: employeeLongitude,
                    sessions: {
                        create: {
                            clockInTime: currentLocalTime,
                            clockInRemark
                        }
                    }
                },
                include: { sessions: true }
            });

            return res.status(200).json({ message: 'Clocked in successfully.', clockInTime: currentLocalTime, clockInRemark });
        }

        const lastSession = attendanceRecord.sessions[attendanceRecord.sessions.length - 1];

        if (!lastSession.clockOutTime) {
            // Clock out
            const duration = Math.max(0.01, ((currentLocalTime - lastSession.clockInTime) / (1000 * 60 * 60)).toFixed(2));
            const clockOutRemark = moment(currentLocalTime).isBefore(organizationOutTime) ? 'Left Early' : 'Present';

            await prisma.session.update({
                where: { id: lastSession.id },
                data: {
                    clockOutTime: currentLocalTime,
                    duration,
                    clockOutRemark
                }
            });

            const updatedSessions = await prisma.session.findMany({ where: { attendanceId: attendanceRecord.id } });
            const totalHours = updatedSessions.reduce((acc, s) => acc + (s.duration || 0), 0);
            
            let finalRemark = 'Present';
            if (totalHours < 4) finalRemark = 'Half Day';
            else if (clockOutRemark === 'Left Early') finalRemark = 'Left Early';

            await prisma.attendance.update({
                where: { id: attendanceRecord.id },
                data: { totalHours, finalRemark }
            });

            return res.status(200).json({ message: 'Clocked out successfully.', clockOutTime: currentLocalTime, totalHours, finalRemark });
        } else {
            // Additional Clock-in
            await prisma.session.create({
                data: {
                    attendanceId: attendanceRecord.id,
                    clockInTime: currentLocalTime,
                    clockInRemark: 'Present'
                }
            });

            return res.status(200).json({ message: 'Clocked in successfully.', clockInTime: currentLocalTime });
        }
    } catch (error) {
        console.error('Error in /clock-in-out:', error);
        res.status(500).json({ message: 'Internal server error.', error: error.message });
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
        const filePath = req.file.path.replace(/\\/g, '/'); // Local path to the file
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