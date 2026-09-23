const express = require('express');
const jwt = require('jsonwebtoken');
const authenticateJWT = require('../middleware/authenticateJWT');
const haversineDistance = require('../Helpers/HaversineDistance.js');
const createNotification = require('../Helpers/CreateNotification.js');
const moment = require('moment-timezone');
const prisma = require('../prisma/client');
const router = express.Router();
const { upload } = require('../config/cloudinary');

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
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        const { wifiSSID, wifiBSSID, deviceId, ipAddress, employeeLatitude, employeeLongitude, isIOS, date, time } = req.body;

        let currentLocalTime = moment().tz('Asia/Kolkata').toDate();
        let currentDate = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

        if (date && time) {
            currentLocalTime = moment.tz(`${date} ${time}`, ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD HH:mm:ss'], 'Asia/Kolkata').toDate();
            currentDate = moment.tz(date, 'YYYY-MM-DD', 'Asia/Kolkata').format('YYYY-MM-DD');
        } else if (date) {
            currentDate = moment.tz(date, 'YYYY-MM-DD', 'Asia/Kolkata').format('YYYY-MM-DD');
            currentLocalTime = moment.tz(date, 'YYYY-MM-DD', 'Asia/Kolkata').toDate();
        }

        const employee = await prisma.employee.findUnique({
            where: { id: req.user.id },
            include: { organization: true, shift: true, devices: { where: { status: 'ACTIVE' } } }
        });

        if (!employee) return res.status(404).json({ message: 'Employee not found.' });

        // ✅ Validate Device
        if (process.env.NODE_ENV !== 'development') {
            if (employee.devices.length === 0) {
                return res.status(403).json({ message: 'Device not registered or revoked. Please contact administrator.' });
            }
            if (employee.devices[0].uuid !== deviceId) {
                // If iOS, we accept it and update it because iOS PWA local storage clears after 7 days
                if (isIOS || deviceId === 'web-fallback-id') {
                    const existingDevice = await prisma.employeeDevice.findUnique({ where: { uuid: deviceId } });
                    
                    if (existingDevice) {
                        await prisma.employeeDevice.update({
                            where: { uuid: deviceId },
                            data: { employeeId: employee.id, status: 'ACTIVE' }
                        });
                        if (existingDevice.id !== employee.devices[0].id) {
                            await prisma.employeeDevice.delete({ where: { id: employee.devices[0].id } });
                        }
                    } else {
                        await prisma.employeeDevice.update({
                            where: { id: employee.devices[0].id },
                            data: { uuid: deviceId }
                        });
                    }
                } else {
                    return res.status(403).json({ message: 'Device not registered or revoked. Please contact administrator.' });
                }
            }
        }

        const organization = employee.organization;

        // ✅ Check WiFi (Skip for iOS, rely on GPS)
        if (!isIOS) {
            if (organization.wifiSSID && organization.wifiSSID !== wifiSSID) {
                return res.status(400).json({ message: `Wrong Wi-Fi. Please connect to ${organization.wifiSSID}.` });
            }
            if (organization.wifiBSSID && wifiBSSID && wifiBSSID !== '02:00:00:00:00:00' && organization.wifiBSSID.toLowerCase() !== wifiBSSID.toLowerCase()) {
                return res.status(400).json({ message: `Wi-Fi BSSID mismatch. Expected: ${organization.wifiBSSID}, Got: ${wifiBSSID}` });
            }
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

        const inTimeStr = employee.shift ? employee.shift.startTime : organization.inTime;
        const outTimeStr = employee.shift ? employee.shift.endTime : organization.outTime;
        
        // Parse time using standard format if it's from shift (HH:mm) or organization format
        const orgInFormat = employee.shift ? 'HH:mm' : 'hh:mm A';
        const orgOutFormat = employee.shift ? 'HH:mm' : 'hh:mm A';

        const currentMom = moment(currentLocalTime).tz('Asia/Kolkata');
        let shiftStart = moment.tz(`${currentDate} ${inTimeStr}`, `YYYY-MM-DD ${orgInFormat}`, 'Asia/Kolkata');
        let shiftEnd = moment.tz(`${currentDate} ${outTimeStr}`, `YYYY-MM-DD ${orgOutFormat}`, 'Asia/Kolkata');
        
        let isOvernight = false;
        if (shiftEnd.isBefore(shiftStart)) {
            isOvernight = true;
            shiftEnd.add(1, 'day');
        }

        // If it's an overnight shift and the employee is hitting the API after midnight
        if (isOvernight && currentMom.isBefore(moment.tz(`${currentDate} ${inTimeStr}`, `YYYY-MM-DD ${orgInFormat}`, 'Asia/Kolkata'))) {
            shiftStart.subtract(1, 'day');
            shiftEnd.subtract(1, 'day');
        }

        const organizationInTime = shiftStart.utc().toDate();
        const organizationOutTime = shiftEnd.utc().toDate();

        // Search window: 12 hours before shift start, to shift end
        const searchStart = shiftStart.clone().subtract(12, 'hours').toDate();
        const searchEnd = shiftEnd.clone().add(4, 'hours').toDate();

        // 1. First check if there is an active unclosed session for this employee
        const activeSession = await prisma.session.findFirst({
            where: {
                clockOutTime: null,
                attendance: {
                    employeeId: employee.id
                }
            },
            include: {
                attendance: {
                    include: { sessions: true }
                }
            },
            orderBy: { clockInTime: 'desc' }
        });

        if (activeSession) {
            // Clock out from the active session
            const attendanceRecord = activeSession.attendance;
            const lastSession = activeSession;
            
            const diffMs = moment(currentLocalTime).diff(moment(lastSession.clockInTime));
            const duration = Math.max(0.01, parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2)));
            
            let clockOutRemark = 'Present';
            if (moment(currentLocalTime).isSame(moment(organizationOutTime), 'minute')) {
                clockOutRemark = 'On Time';
            } else if (moment(currentLocalTime).isBefore(moment(organizationOutTime))) {
                clockOutRemark = 'Left Early';
            }

            await prisma.session.update({
                where: { id: lastSession.id },
                data: {
                    clockOutTime: currentLocalTime,
                    duration,
                    clockOutRemark
                }
            });

            const updatedSessions = await prisma.session.findMany({ where: { attendanceId: attendanceRecord.id } });
            const totalHours = parseFloat(updatedSessions.reduce((acc, s) => acc + (s.duration || 0), 0).toFixed(2));
            
            // Calculate extra hours
            const expectedDurationMs = moment(organizationOutTime).diff(moment(organizationInTime));
            const expectedHours = expectedDurationMs > 0 ? expectedDurationMs / (1000 * 60 * 60) : 0;
            let extraHours = 0;
            if (expectedHours > 0 && totalHours > expectedHours) {
                extraHours = parseFloat((totalHours - expectedHours).toFixed(2));
            }
            
            // Determine expected half day threshold dynamically based on assigned shift duration
            const halfShiftHours = expectedHours > 0 ? (expectedHours / 2) : 4;

            // Determine finalRemark by comparing login & logout times against assigned shift
            const firstSession = updatedSessions[0];
            const isLate = firstSession?.clockInRemark === 'Late';
            const isEarlyLogout = clockOutRemark === 'Left Early';

            let finalRemark = 'Present';
            if (totalHours < halfShiftHours) {
                finalRemark = 'Half Day';
            } else if (isLate && isEarlyLogout) {
                finalRemark = 'Late & Left Early';
            } else if (isLate) {
                finalRemark = 'Late';
            } else if (isEarlyLogout) {
                finalRemark = 'Left Early';
            } else if (firstSession?.clockInRemark === 'Early Login') {
                finalRemark = 'Early Login';
            } else {
                finalRemark = 'On Time';
            }

            await prisma.attendance.update({
                where: { id: attendanceRecord.id },
                data: { totalHours, extraHours, finalRemark }
            });

            return res.status(200).json({ message: 'Clocked out successfully.', clockOutTime: currentLocalTime, totalHours, extraHours, finalRemark });
        }

        // 2. If no active session, it is a clock-in: check if an attendance record exists for today / current shift
        let attendanceRecord = await prisma.attendance.findFirst({
            where: {
                employeeId: employee.id,
                date: {
                    gte: searchStart,
                    lte: searchEnd
                }
            },
            orderBy: { date: 'desc' },
            include: { sessions: true }
        });

        if (!attendanceRecord) {
            // First time clock-in for this date / shift
            let clockInRemark = 'Present';
            if (moment(currentLocalTime).isSame(moment(organizationInTime), 'minute')) {
                clockInRemark = 'On Time';
            } else if (moment(currentLocalTime).isAfter(moment(organizationInTime))) {
                clockInRemark = 'Late';
            } else if (moment(currentLocalTime).isBefore(moment(organizationInTime))) {
                clockInRemark = 'Early Login';
            }

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
                    finalRemark: 'Clocked In',
                    sessions: {
                        create: {
                            clockInTime: currentLocalTime,
                            clockInRemark
                        }
                    }
                },
                include: { sessions: true }
            });

            return res.status(200).json({ message: 'Clocked in successfully.', clockInTime: currentLocalTime, clockInRemark, finalRemark: 'Clocked In' });
        } else {
            // Additional Clock-in
            await prisma.session.create({
                data: {
                    attendanceId: attendanceRecord.id,
                    clockInTime: currentLocalTime,
                    clockInRemark: 'Present'
                }
            });

            await prisma.attendance.update({
                where: { id: attendanceRecord.id },
                data: { finalRemark: 'Clocked In' }
            });

            return res.status(200).json({ message: 'Clocked in successfully.', clockInTime: currentLocalTime });
        }
    } catch (error) {
        console.error('Error in /clock-in-out:', error);
        res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
});

router.get('/employee-calendar', authenticateJWT, async (req, res) => {
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        const employeeId = req.user.id;

        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            include: { shift: true }
        });
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found.' });
        }

        const organizationCode = employee.organizationCode;

        const [attendances, leaves, pendingRegularizations, holidays] = await Promise.all([
            prisma.attendance.findMany({
                where: {
                    employeeId: employeeId,
                    organizationCode: organizationCode
                },
                select: {
                    date: true,
                    finalRemark: true,
                    sessions: {
                        select: {
                            clockInRemark: true
                        },
                        orderBy: {
                            clockInTime: 'asc'
                        },
                        take: 1
                    }
                }
            }),
            prisma.leave.findMany({
                where: {
                    employeeId: employeeId,
                    organizationCode: organizationCode,
                    status: 'Approved'
                },
                select: {
                    startDate: true,
                    endDate: true
                }
            }),
            prisma.attendanceRegularization.findMany({
                where: {
                    employeeId: employeeId,
                    organizationCode: organizationCode,
                    status: 'Pending'
                },
                select: {
                    attendanceDate: true
                }
            }),
            prisma.holiday.findMany({
                where: {
                    organizationId: employee.organizationId
                },
                select: {
                    startDate: true,
                    endDate: true,
                    name: true
                }
            })
        ]);

        // Step 4: Build maps of attendance and leave dates
        const attendanceMap = {};
        const allAttendanceDates = new Set();

        attendances.forEach(a => {
            const dateStr = moment(a.date).format('YYYY-MM-DD');
            const firstSessionRemark = a.sessions && a.sessions.length > 0 ? a.sessions[0].clockInRemark : null;
            attendanceMap[dateStr] = {
                finalRemark: a.finalRemark,
                remark: firstSessionRemark
            };
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

        const pendingRegularizeSet = new Set();
        pendingRegularizations.forEach(reg => {
            pendingRegularizeSet.add(moment(reg.attendanceDate).format('YYYY-MM-DD'));
        });

        const holidayDatesSet = new Set();
        const holidayDetails = {};
        holidays.forEach(holiday => {
            const hStart = moment(holiday.startDate);
            const hEnd = moment(holiday.endDate);
            for (let m = moment(hStart); m.diff(hEnd, 'days') <= 0; m.add(1, 'days')) {
                const dateStr = m.format('YYYY-MM-DD');
                holidayDatesSet.add(dateStr);
                holidayDetails[dateStr] = holiday.name;
            }
        });
        const allDates = new Set([...allAttendanceDates, ...leaveDates, ...pendingRegularizeSet, ...holidayDatesSet]);

        // Step 5: Categorize dates
        const result = {
            employeeId,
            employeeName: employee.employeeName,
            presentDates: [],
            lateDates: [],
            earlyLoginDates: [],
            onTimeDates: [],
            absentDates: [],
            leaveDates: [],
            holidayDates: Array.from(holidayDatesSet),
            holidayDetails: holidayDetails,
            regularizedDates: [],
            pendingRegularizeDates: [],
            weekOffDays: employee.shift && employee.shift.weekOffs ? employee.shift.weekOffs.split(',') : []
        };

        allDates.forEach(date => {
            const att = attendanceMap[date];
            if (pendingRegularizeSet.has(date)) {
                result.pendingRegularizeDates.push(date);
            } else if (att && ['Present', 'Half Day', 'Left Early', 'Clocked In', 'Regularized'].includes(att.finalRemark)) {
                if (att.finalRemark === 'Regularized') {
                    result.regularizedDates.push(date);
                } else if (att.remark === 'Late') {
                    result.lateDates.push(date);
                } else if (att.remark === 'Early Login') {
                    result.earlyLoginDates.push(date);
                } else if (att.remark === 'On Time') {
                    result.onTimeDates.push(date);
                } else {
                    result.presentDates.push(date);
                }
            } else if (leaveDates.has(date)) {
                result.leaveDates.push(date);
            } else if (holidayDatesSet.has(date)) {
                // Do not mark as absent if it is a holiday
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

router.get('/dashboard-summary', authenticateJWT, async (req, res) => {
    // #swagger.tags = ['Attendance and Employee Management']
    try {
        const employeeId = req.user.id;
        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            select: { organizationId: true, organizationCode: true, salary: true, shift: true }
        });
        if (!employee) return res.status(404).json({ message: 'Employee not found.' });

        const now = moment().tz('Asia/Kolkata');
        const currentMonthStart = now.clone().startOf('month');
        const currentMonthEnd = now.clone().endOf('month');
        const today = now.clone().startOf('day');

        // Parallelise attendance + holiday fetch
        const [attendances, organization] = await Promise.all([
            prisma.attendance.findMany({
                where: {
                    employeeId,
                    organizationCode: employee.organizationCode,
                    date: { gte: currentMonthStart.toDate(), lte: currentMonthEnd.toDate() }
                },
                select: { finalRemark: true, totalHours: true, extraHours: true, date: true }
            }),
            prisma.organization.findUnique({
                where: { id: employee.organizationId },
                select: {
                    holidays: {
                        where: {
                            startDate: { lte: currentMonthEnd.toDate() },
                            endDate: { gte: currentMonthStart.toDate() }
                        },
                        select: { startDate: true, endDate: true }
                    }
                }
            })
        ]);

        const holidayDates = new Set();
        for (const h of (organization?.holidays || [])) {
            let d = moment(h.startDate);
            const end = moment(h.endDate);
            while (d.isSameOrBefore(end, 'day')) {
                holidayDates.add(d.format('YYYY-MM-DD'));
                d.add(1, 'day');
            }
        }

        const weekOffNames = employee.shift?.weekOffs ? employee.shift.weekOffs.split(',').map(d => d.trim().toLowerCase()) : [];
        let expectedWorkingDays = 0;
        let actualWorkingDays = 0;
        let completedWorkingHours = 0;

        const PRESENT_REMARKS = ['Present', 'Half Day', 'Left Early', 'Clocked In', 'Regularized'];
        for (const a of attendances) {
            if (PRESENT_REMARKS.includes(a.finalRemark)) {
                if (moment(a.date).isSameOrBefore(today, 'day')) {
                    actualWorkingDays++;
                }
            }
            const dayTotal = Math.max(0, a.totalHours || 0);
            const dayExtra = Math.max(0, a.extraHours || 0);
            completedWorkingHours += dayTotal + dayExtra;
        }

        let currentDay = currentMonthStart.clone();
        const maxDay = currentMonthEnd;

        while (currentDay.isSameOrBefore(maxDay, 'day')) {
            const dateStr = currentDay.format('YYYY-MM-DD');
            const dayName = currentDay.format('dddd').toLowerCase();

            if (!weekOffNames.includes(dayName) && !holidayDates.has(dateStr)) {
                expectedWorkingDays++;
            }
            currentDay.add(1, 'day');
        }

        const shiftStart = employee.shift?.startTime ? moment(employee.shift.startTime, 'HH:mm') : null;
        const shiftEnd = employee.shift?.endTime ? moment(employee.shift.endTime, 'HH:mm') : null;
        let dailyShiftHours = 8; // Default
        if (shiftStart && shiftEnd) {
            dailyShiftHours = shiftEnd.diff(shiftStart, 'hours', true);
            if (dailyShiftHours < 0) dailyShiftHours += 24; // overnight shift
        }

        const expectedWorkingHours = Math.max(0, parseFloat((expectedWorkingDays * dailyShiftHours).toFixed(2)));
        completedWorkingHours = Math.max(0, parseFloat(completedWorkingHours.toFixed(2)));
        const salary = employee.salary || 0;

        res.status(200).json({
            expectedWorkingDays,
            actualWorkingDays,
            expectedWorkingHours,
            completedWorkingHours,
            salary
        });
    } catch (err) {
        console.error('Error fetching dashboard summary:', err);
        res.status(500).json({ message: 'Server Error' });
    }
});


router.get('/all-present-days', authenticateJWT, async (req, res) => {
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        // req.user is already set by authenticateJWT middleware — no need to re-decode
        const employeeId = req.user.id;

        // Fetch all records where the employee was present (finalRemark is NOT 'Absent')
        const presentDays = await prisma.attendance.findMany({
            where: {
                employeeId,
                finalRemark: { not: 'Absent' }
            },
            orderBy: { date: 'asc' },
            select: { date: true, finalRemark: true }
        });

        res.status(200).json({ presentDays });
    } catch (error) {
        console.error('Error in /all-present-days:', error);
        res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
});

router.get('/profile', authenticateJWT, async (req, res) => {
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        // req.user is already set by authenticateJWT
        const employeeId = req.user.id;

        // Fetch the employee by ID with populated organization details
        const employeeInstance = await prisma.employee.findUnique({
            where: { id: employeeId },
            include: { organization: true, shift: true }
        });
        if (!employeeInstance) {
            return res.status(404).send({ message: 'Employee not found' });
        }

        // Send the employee profile as a response
        res.status(200).json({
            message: 'Employee profile fetched successfully',
            id: employeeInstance.id,
            employeeName: employeeInstance.employeeName,
            employeeEmail: employeeInstance.employeeEmail,
            organizationCode: employeeInstance.organizationCode,
            profilePic: employeeInstance.profilePic,
            isVerified: employeeInstance.isVerified,
            createdAt: employeeInstance.createdAt,
            updatedAt: employeeInstance.updatedAt,
            organization: employeeInstance.organization,
            shift: employeeInstance.shift,
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
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        const employeeId = req.user.id;

        // Find the employee by ID
        const employeeInstance = await prisma.employee.findUnique({
            where: { id: employeeId }
        });

        if (!employeeInstance) {
            return res.status(404).send({ message: 'Employee not found' });
        }

        // Check if a file is uploaded
        if (!req.file) {
            return res.status(400).send({ message: 'No file uploaded' });
        }

        // Save the file buffer as base64 to the employee's profile
        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        await prisma.employee.update({
            where: { id: employeeInstance.id },
            data: { profilePic: base64Image }
        });

        res.status(200).json({
            message: 'Profile picture uploaded successfully',
            profilePic: base64Image,
        });
    } catch (error) {
        console.error('Error uploading profile picture:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

router.get('/attendance/today', authenticateJWT, async (req, res) => {
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        // Extract JWT token
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Authorization token is required.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Find the employee
        const employee = await prisma.employee.findUnique({
            where: { id: decoded.id }
        });
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found.' });
        }

        // Get today's date range
        const startOfDay = moment().startOf('day').toDate();
        const endOfDay = moment().endOf('day').toDate();

        // Fetch the most recent attendance record
        const attendanceRecord = await prisma.attendance.findFirst({
            where: {
                employeeId: employee.id
            },
            orderBy: { date: 'desc' },
            include: { sessions: true }
        });

        if (!attendanceRecord) {
            return res.status(200).json({ message: 'No attendance record found for today.' });
        }

        const isToday = attendanceRecord.date >= startOfDay && attendanceRecord.date <= endOfDay;
        const hasOpenSession = attendanceRecord.sessions.some(session => !session.clockOutTime);

        if (!isToday && !hasOpenSession) {
            return res.status(200).json({ message: 'No attendance record found for today.' });
        }

        // Calculate total hours dynamically to include ongoing sessions
        let totalHours = 0;
        if (attendanceRecord.sessions.length > 0) {
            totalHours = attendanceRecord.sessions.reduce((sum, session) => {
                let duration = session.duration || 0;
                if (!session.clockOutTime && session.clockInTime) {
                    const now = moment();
                    const end = moment.min(now, moment(attendanceRecord.date).endOf('day'));
                    duration = Math.max(0, end.diff(moment(session.clockInTime)) / (1000 * 60 * 60));
                }
                return sum + duration;
            }, 0);
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
            date: moment(attendanceRecord.date).tz('Asia/Kolkata').format('YYYY-MM-DD'), // YYYY-MM-DD format
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

router.get('/attendance/present-nearby', authenticateJWT,async (req, res) => {
    // #swagger.tags = ['Attendance and Employee Management']

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
        const requestingEmployee = await prisma.employee.findUnique({
            where: { id: decoded.id }
        });
        if (!requestingEmployee) {
            return res.status(404).json({ message: 'Employee not found.' });
        }

        const startOfDay = moment().startOf('day').toDate();
        const endOfDay = moment().endOf('day').toDate();

        // Fetch attendances where clockInTime exists
        const presentEmployees = await prisma.attendance.findMany({
            where: {
                organizationCode: requestingEmployee.organizationCode,
                date: { gte: startOfDay, lte: endOfDay },
                sessions: {
                    some: {}
                }
            },
            include: { employee: true }
        });

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
            const empId = emp?.id;
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
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        // Extract JWT token
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Authorization token is required.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Find the employee
        const employee = await prisma.employee.findUnique({
            where: { id: decoded.id }
        });
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found.' });
        }

        // Get the selected date from params
        const selectedDate = req.params.date; // Format: YYYY-MM-DD
        const startOfDay = moment.tz(selectedDate, 'YYYY-MM-DD', 'Asia/Kolkata').startOf('day').toDate();
        const endOfDay = moment.tz(selectedDate, 'YYYY-MM-DD', 'Asia/Kolkata').endOf('day').toDate();

        // Fetch attendance record for the selected date
        const attendanceRecord = await prisma.attendance.findFirst({
            where: {
                employeeId: employee.id,
                date: { gte: startOfDay, lte: endOfDay }
            },
            include: { sessions: true }
        });

        if (!attendanceRecord) {
            return res.status(200).json({ message: `No attendance record found for ${selectedDate}.` });
        }

        // Calculate total hours dynamically to include ongoing sessions
        let totalHours = 0;
        if (attendanceRecord.sessions.length > 0) {
            totalHours = attendanceRecord.sessions.reduce((sum, session) => {
                let duration = session.duration || 0;
                if (!session.clockOutTime && session.clockInTime) {
                    const now = moment().tz('Asia/Kolkata');
                    duration = Math.max(0, now.diff(moment(session.clockInTime)) / (1000 * 60 * 60));
                }
                return sum + duration;
            }, 0);
        }

        // Calculate Break Time
        let breakTime = 0;
        if (attendanceRecord.sessions.length > 1) {
            for (let i = 0; i < attendanceRecord.sessions.length - 1; i++) {
                const currentSession = attendanceRecord.sessions[i];
                const nextSession = attendanceRecord.sessions[i + 1];
                if (currentSession.clockOutTime && nextSession.clockInTime) {
                    const gap = moment(nextSession.clockInTime).diff(moment(currentSession.clockOutTime));
                    if (gap > 0) breakTime += gap / (1000 * 60 * 60); // Convert to hours
                }
            }
        }

        // Calculate Overtime (assuming 9 hours standard shift)
        const STANDARD_SHIFT_HOURS = 9;
        let overtime = 0;
        if (totalHours > STANDARD_SHIFT_HOURS) {
            overtime = totalHours - STANDARD_SHIFT_HOURS;
        }

        // Extract first and last session details
        const firstSession = attendanceRecord.sessions.length > 0 ? attendanceRecord.sessions[0] : null;
        const lastSession = attendanceRecord.sessions.length > 0 ? attendanceRecord.sessions[attendanceRecord.sessions.length - 1] : null;

        // Determine Status
        let status = 'Absent';
        if (attendanceRecord.finalRemark && attendanceRecord.finalRemark !== 'Absent') {
            status = attendanceRecord.finalRemark;
        } else if (firstSession) {
            if (firstSession.clockInRemark === 'Late') {
                status = 'Late';
            } else if (firstSession.clockInRemark === 'Early Login') {
                status = 'Early Login';
            } else if (firstSession.clockInRemark === 'On Time') {
                status = 'On Time';
            } else {
                status = 'Present';
            }
        }
        
        // If not clocked out, override to 'Working'
        if (lastSession && !lastSession.clockOutTime) {
            status = 'Working';
        }

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
            breakTime: breakTime,
            overtime: overtime,
            status: status,
            finalRemark: attendanceRecord.finalRemark,
            regularized: attendanceRecord.regularized,
            sessions: formattedSessions, // Include all sessions
        };

        res.status(200).json({ attendance: formattedRecord });
    } catch (error) {
        console.error('Error fetching attendance record rrrrrrrr:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});
router.get('/attendance/weekly', authenticateJWT, async (req, res) => {
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Authorization token is required.' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const employee = await prisma.employee.findUnique({ where: { id: decoded.id } });
        if (!employee) return res.status(404).json({ message: 'Employee not found.' });

        // Default to current week (Monday-Sunday) if no dates provided
        const startDate = req.query.startDate ? moment(req.query.startDate).startOf('day').toDate() : moment().startOf('isoWeek').toDate();
        const endDate = req.query.endDate ? moment(req.query.endDate).endOf('day').toDate() : moment().endOf('isoWeek').toDate();

        const attendances = await prisma.attendance.findMany({
            where: {
                employeeId: employee.id,
                date: { gte: startDate, lte: endDate }
            },
            include: { sessions: true }
        });

        let totalWeeklyHours = 0;
        const dailyData = [];

        // Initialize array for the 7 days of the week
        for (let i = 0; i < 7; i++) {
            const currentDay = moment(startDate).add(i, 'days');
            dailyData.push({
                fullDate: currentDay.format('YYYY-MM-DD'),
                day: currentDay.format('ddd'),
                date: currentDay.format('DD'),
                hours: 0,
                label: '0h'
            });
        }

        // Populate actual hours
        attendances.forEach(record => {
            const recordDate = moment(record.date).format('YYYY-MM-DD');
            const dayIndex = dailyData.findIndex(d => d.fullDate === recordDate);
            if (dayIndex !== -1) {
                // Calculate dynamically
                let hours = 0;
                if (record.sessions && record.sessions.length > 0) {
                    hours = record.sessions.reduce((sum, session) => {
                        let duration = session.duration || 0;
                        if (!session.clockOutTime && session.clockInTime) {
                            const now = moment();
                            const end = moment.min(now, moment(record.date).endOf('day'));
                            duration = Math.max(0, end.diff(moment(session.clockInTime)) / (1000 * 60 * 60));
                        }
                        return sum + duration;
                    }, 0);
                } else {
                    hours = record.totalHours || 0;
                }
                
                dailyData[dayIndex].hours = hours;
                
                const h = Math.floor(hours);
                const m = Math.round((hours - h) * 60);
                dailyData[dayIndex].label = m > 0 ? `${h}h ${m}m` : (h > 0 ? `${h}h` : '0h');
                
                totalWeeklyHours += hours;
            }
        });

        const totalH = Math.floor(totalWeeklyHours);
        const totalM = Math.round((totalWeeklyHours - totalH) * 60);
        const totalLabel = totalM > 0 ? `${totalH}h ${totalM}m` : `${totalH}h`;

        res.status(200).json({
            weeklyData: dailyData,
            totalWeeklyHours: totalWeeklyHours,
            totalLabel: totalLabel,
            dateRange: `${moment(startDate).format('DD MMM')} - ${moment(endDate).format('DD MMM YYYY')}`
        });

    } catch (error) {
        console.error('Error in /attendance/weekly:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ================== Employee Expense / Bill Reimbursement ==================

/**
 * @swagger
 * /api/employee/expenses:
 *   post:
 *     summary: Submit a bill/expense for reimbursement
 *     tags: [Attendance and Employee Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - type
 *               - amount
 *             properties:
 *               title:
 *                 type: string
 *               type:
 *                 type: string
 *                 example: Travel
 *               amount:
 *                 type: number
 *               billUrl:
 *                 type: string
 *                 description: Base64 string or uploaded URL of the bill
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Expense submitted successfully
 *       400:
 *         description: Missing required fields
 */
router.post('/expenses', authenticateJWT, async (req, res) => {
  // #swagger.tags = ['Attendance and Employee Management']
  try {
    const { title, type, amount, billUrl, description } = req.body;

    if (!title || !type || !amount) {
      return res.status(400).json({ message: 'title, type, and amount are required.' });
    }

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ message: 'amount must be a positive number.' });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: req.user.id },
      select: { id: true, organizationId: true, organizationCode: true }
    });

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    const expense = await prisma.expense.create({
      data: {
        employeeId: employee.id,
        organizationId: employee.organizationId,
        organizationCode: employee.organizationCode,
        title: title.trim(),
        type: type.trim(),
        amount: parseFloat(amount),
        billUrl: billUrl || null,
        description: description || null,
      }
    });

    return res.status(201).json({ message: 'Expense submitted successfully.', expense });
  } catch (error) {
    console.error('Error submitting expense:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @swagger
 * /api/employee/expenses/{id}:
 *   put:
 *     summary: Edit a pending expense
 *     tags: [Attendance and Employee Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               type:
 *                 type: string
 *               amount:
 *                 type: number
 *               description:
 *                 type: string
 *               billUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Expense updated successfully
 *       400:
 *         description: Bad request or not pending
 *       404:
 *         description: Expense not found
 */
router.put('/expenses/:id', authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, type, amount, billUrl, description } = req.body;

    const expense = await prisma.expense.findUnique({
      where: { id }
    });

    if (!expense || expense.employeeId !== req.user.id) {
      return res.status(404).json({ message: 'Expense not found.' });
    }
    
    if (expense.status !== 'PENDING') {
      return res.status(400).json({ message: 'Only pending expenses can be edited.' });
    }

    if (!title || !type || !amount) {
      return res.status(400).json({ message: 'title, type, and amount are required.' });
    }

    const updatedExpense = await prisma.expense.update({
      where: { id },
      data: {
        title: title.trim(),
        type: type.trim(),
        amount: parseFloat(amount),
        billUrl: billUrl || expense.billUrl,
        description: description || null,
      }
    });

    return res.status(200).json({ message: 'Expense updated successfully.', expense: updatedExpense });
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @swagger
 * /api/employee/expenses/{id}:
 *   delete:
 *     summary: Delete a pending expense
 *     tags: [Attendance and Employee Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Expense deleted successfully
 *       400:
 *         description: Bad request or not pending
 *       404:
 *         description: Expense not found
 */
router.delete('/expenses/:id', authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;

    const expense = await prisma.expense.findUnique({
      where: { id }
    });

    if (!expense || expense.employeeId !== req.user.id) {
      return res.status(404).json({ message: 'Expense not found.' });
    }

    if (expense.status !== 'PENDING') {
      return res.status(400).json({ message: 'Only pending expenses can be deleted.' });
    }

    await prisma.expense.delete({
      where: { id }
    });

    return res.status(200).json({ message: 'Expense deleted successfully.' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @swagger
 * /api/employee/expenses:
 *   get:
 *     summary: Get my submitted expenses
 *     tags: [Attendance and Employee Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, PAID]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of employee expenses
 */
router.get('/expenses', authenticateJWT, async (req, res) => {
  // #swagger.tags = ['Attendance and Employee Management']
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = { employeeId: req.user.id };
    if (status && status !== 'ALL') {
      const validStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'];
      if (!validStatuses.includes(status.toUpperCase())) {
        return res.status(400).json({ message: 'Invalid status filter.' });
      }
      where.status = status.toUpperCase();
    }

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        select: {
          id: true,
          title: true,
          type: true,
          amount: true,
          billUrl: true,
          description: true,
          status: true,
          rejectionReason: true,
          reviewedBy: true,
          reviewedAt: true,
          createdAt: true,
          updatedAt: true,
        }
      }),
      prisma.expense.count({ where })
    ]);

    return res.status(200).json({
      expenses,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching employee expenses:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ================== Employee Performance Report ==================

/**
 * @swagger
 * /api/employee/performance-report:
 *   get:
 *     summary: Get my performance report
 *     tags: [Attendance and Employee Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: range
 *         schema:
 *           type: string
 *           enum: [currentMonth, lastMonth, last3Months, last6Months, custom]
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Performance report with scores, monthly hours, and activity summary
 */
router.get('/performance-report', authenticateJWT, async (req, res) => {
  try {
    const employeeId = req.user.id;

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        employeeName: true,
        employeeEmail: true,
        profilePic: true,
        organizationCode: true,
        organizationId: true,
        shift: { select: { name: true, startTime: true, endTime: true, weekOffs: true } }
      }
    });

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    // ── Date range configuration ───────────────────────────────────────
    const { range, startDate, endDate } = req.query;
    const moment = require('moment-timezone');
    const now = moment().tz('Asia/Kolkata');
    let rangeStart, rangeEnd;

    if (range === 'currentMonth') {
      rangeStart = now.clone().startOf('month').toDate();
      rangeEnd = now.clone().endOf('month').toDate();
    } else if (range === 'lastMonth') {
      rangeStart = now.clone().subtract(1, 'month').startOf('month').toDate();
      rangeEnd = now.clone().subtract(1, 'month').endOf('month').toDate();
    } else if (range === 'last3Months') {
      rangeStart = now.clone().subtract(2, 'months').startOf('month').toDate();
      rangeEnd = now.clone().endOf('month').toDate();
    } else if (range === 'custom' && startDate && endDate) {
      rangeStart = moment(startDate).startOf('day').toDate();
      rangeEnd = moment(endDate).endOf('day').toDate();
    } else {
      // Default: last 6 months
      rangeStart = now.clone().subtract(5, 'months').startOf('month').toDate();
      rangeEnd = now.clone().endOf('month').toDate();
    }

    // ── Fetch all attendance in range ─────────────────────────────────
    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId,
        organizationCode: employee.organizationCode,
        date: { gte: rangeStart, lte: rangeEnd }
      },
      select: { date: true, totalHours: true, extraHours: true, finalRemark: true, sessions: { orderBy: { clockInTime: 'asc' }, select: { clockInTime: true } } },
      orderBy: { date: 'asc' }
    });

    // ── Fetch tasks ────────────────────────────────────────────────────
    const [totalTasks, completedTasks] = await Promise.all([
      prisma.task.count({ where: { employeeId, organizationId: employee.organizationId } }),
      prisma.task.count({ where: { employeeId, organizationId: employee.organizationId, status: 'COMPLETED' } })
    ]);

    // ── Fetch leaves this period ───────────────────────────────────────
    const approvedLeaves = await prisma.leave.count({
      where: { employeeId, organizationCode: employee.organizationCode, status: 'Approved', startDate: { gte: rangeStart } }
    });

    // ── Build monthly hours breakdown ──────────────────────────────────
    const monthlyMap = {};
    let m = moment(rangeStart).startOf('month');
    const mEnd = moment(rangeEnd).endOf('month');
    
    while (m.isSameOrBefore(mEnd)) {
      const key = m.format('YYYY-MM');
      monthlyMap[key] = { month: m.format('MMM'), hours: 0, present: 0, late: 0 };
      m.add(1, 'month');
    }

    const PRESENT_REMARKS = ['Present', 'Half Day', 'Left Early', 'Clocked In', 'Regularized'];
    let totalHoursAll = 0;
    let totalOvertimeAll = 0;
    let lateArrivals = 0;
    let earlyDepartures = 0;
    let presentDays = 0;

    // Determine shift start for punctuality check
    const shiftStartParts = employee.shift?.startTime ? employee.shift.startTime.split(':').map(Number) : null;

    for (const a of attendances) {
      const mKey = moment(a.date).format('YYYY-MM');
      if (!monthlyMap[mKey]) continue;

      const dayHours = Math.max(0, a.totalHours || 0);
      const dayOvertime = Math.max(0, a.extraHours || 0);

      monthlyMap[mKey].hours += dayHours;
      totalHoursAll += dayHours;
      totalOvertimeAll += dayOvertime;

      if (PRESENT_REMARKS.includes(a.finalRemark)) {
        presentDays++;
        monthlyMap[mKey].present++;

        // Punctuality: check if first clock-in was after shift start
        if (shiftStartParts && a.sessions.length > 0) {
          const clockIn = moment(a.sessions[0].clockInTime).tz('Asia/Kolkata');
          const shiftStartMins = shiftStartParts[0] * 60 + shiftStartParts[1];
          const clockInMins = clockIn.hours() * 60 + clockIn.minutes();
          // Grace period: 10 minutes
          if (clockInMins > shiftStartMins + 10) {
            lateArrivals++;
            monthlyMap[mKey].late++;
          }
        }
      }

      if (a.finalRemark === 'Left Early') earlyDepartures++;
    }

    // ── Calculate True Absent Days (Handling missing data) ────────────
    const organization = await prisma.organization.findUnique({
      where: { id: employee.organizationId },
      select: { holidays: { where: { startDate: { lte: rangeEnd }, endDate: { gte: rangeStart } }, select: { startDate: true, endDate: true } } }
    });

    const holidayDates = new Set();
    for (const h of (organization?.holidays || [])) {
      let d = moment(h.startDate);
      const end = moment(h.endDate);
      while (d.isSameOrBefore(end, 'day')) {
        holidayDates.add(d.format('YYYY-MM-DD'));
        d.add(1, 'day');
      }
    }

    const attendanceMap = {};
    for (const a of attendances) {
      attendanceMap[moment(a.date).format('YYYY-MM-DD')] = a.finalRemark;
    }

    let expectedWorkingDays = 0;
    let absentDays = 0;
    const today = now.clone().startOf('day');
    const weekOffNames = employee.shift?.weekOffs
      ? employee.shift.weekOffs.split(',').map(d => d.trim().toLowerCase())
      : [];

    let currentDay = moment(rangeStart);
    const maxDay = moment.min(moment(rangeEnd), today); // Don't count future days

    while (currentDay.isSameOrBefore(maxDay, 'day')) {
      const dateStr = currentDay.format('YYYY-MM-DD');
      const dayName = currentDay.format('dddd').toLowerCase();

      // If not weekoff and not holiday
      if (!weekOffNames.includes(dayName) && !holidayDates.has(dateStr)) {
        expectedWorkingDays++;
        
        const remark = attendanceMap[dateStr];
        // If there's no record, or the record says Absent, it's an absent day
        if (!remark || !PRESENT_REMARKS.includes(remark)) {
          absentDays++;
        }
      }
      currentDay.add(1, 'day');
    }

    // ── Calculate scores ───────────────────────────────────────────────
    const avgDailyHours = presentDays > 0 ? Math.max(0, parseFloat((totalHoursAll / presentDays).toFixed(2))) : 0;
    const overtimeHours = Math.max(0, parseFloat(totalOvertimeAll.toFixed(2)));

    // Punctuality score: (present - late) / present * 100
    const punctualityScore = presentDays > 0
      ? Math.round(((presentDays - lateArrivals) / presentDays) * 100)
      : 0;

    // Task completion score
    const taskScore = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Attendance score (present days out of expected working days)
    const attendanceScore = expectedWorkingDays > 0 
      ? Math.max(0, Math.round(((expectedWorkingDays - absentDays) / expectedWorkingDays) * 100))
      : 0;

    // Overtime score: capped at 100, based on avg overtime vs expected hours (generous scoring)
    const avgOvertimePerDay = presentDays > 0 ? totalOvertimeAll / presentDays : 0;
    const overtimeScore = Math.min(100, Math.round(avgOvertimePerDay * 25)); // 4hr+ overtime = 100

    // Consistency: low late arrivals + low early departures
    const consistencyScore = presentDays > 0
      ? Math.max(0, Math.round(100 - ((lateArrivals + earlyDepartures) / presentDays) * 100))
      : 0;

    // Absenteeism rate (% of working days absent over the range)
    const absenteeismRate = expectedWorkingDays > 0 ? parseFloat(((absentDays / expectedWorkingDays) * 100).toFixed(1)) : 0;

    // Overall score: weighted average
    const overallScore = Math.round(
      punctualityScore * 0.30 +
      attendanceScore  * 0.25 +
      taskScore        * 0.25 +
      consistencyScore * 0.20
    );

    const monthlyHours = Object.values(monthlyMap).map(m => ({
      month: m.month,
      hours: Math.max(0, parseFloat(m.hours.toFixed(1))),
      presentDays: m.present,
      lateDays: m.late
    }));

    return res.status(200).json({
      employee: {
        id: employee.id,
        employeeName: employee.employeeName,
        employeeEmail: employee.employeeEmail,
        profilePic: employee.profilePic,
        shift: employee.shift?.name || null
      },
      scores: {
        overall: overallScore,
        punctuality: punctualityScore,
        attendance: attendanceScore,
        taskCompletion: taskScore,
        overtime: overtimeScore,
        consistency: consistencyScore
      },
      kpis: {
        avgDailyHours,
        overtimeHours,
        absenteeismRate,
        lateArrivals,
        earlyDepartures,
        presentDays,
        absentDays,
        approvedLeaves
      },
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        pending: totalTasks - completedTasks
      },
      monthlyHours
    });
  } catch (error) {
    console.error('Error fetching employee performance report:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;