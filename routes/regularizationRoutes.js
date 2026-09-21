const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');
const authenticateJWT = require('../middleware/authenticateJWT');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const requireOrganizationAccess = require('../middleware/requireOrganizationAccess');
const router = express.Router();

// ================== Employee: Submit Regularization Request ==================
router.post('/employee', authenticateJWT, async (req, res) => {
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const { attendanceDate, requestType, requestedCheckIn, requestedCheckOut, requestedCheckInDate, requestedCheckOutDate, reason, attachment } = req.body;

        if (!attendanceDate || !requestType || !reason) {
            return res.status(400).send({ message: 'Attendance date, request type, and reason are required.' });
        }

        const employee = await prisma.employee.findUnique({ where: { id: decoded.id } });
        if (!employee) return res.status(404).send({ message: 'Employee not found.' });

        const dateObj = new Date(attendanceDate);
        if (dateObj > new Date()) {
            return res.status(400).send({ message: 'Cannot regularize future dates.' });
        }

        // Check if there is already a pending request for this date
        const existingRequest = await prisma.attendanceRegularization.findFirst({
            where: {
                employeeId: employee.id,
                attendanceDate: dateObj,
                status: 'Pending'
            }
        });

        if (existingRequest) {
            return res.status(400).send({ message: 'A pending regularization request already exists for this date.' });
        }

        const request = await prisma.attendanceRegularization.create({
            data: {
                employeeId: employee.id,
                organizationCode: employee.organizationCode,
                attendanceDate: dateObj,
                requestType,
                requestedCheckIn,
                requestedCheckOut,
                requestedCheckInDate: requestedCheckInDate ? new Date(requestedCheckInDate) : null,
                requestedCheckOutDate: requestedCheckOutDate ? new Date(requestedCheckOutDate) : null,
                reason,
                attachment
            }
        });

        res.status(201).send({ message: 'Regularization request submitted successfully.', request });
    } catch (error) {
        console.error('Error submitting regularization:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

// ================== Employee: Get My Regularization Requests ==================
router.get('/employee', authenticateJWT, async (req, res) => {
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const requests = await prisma.attendanceRegularization.findMany({
            where: { employeeId: decoded.id },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).send({ requests });
    } catch (error) {
        console.error('Error fetching employee regularizations:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

// ================== Admin: Get All Regularization Requests ==================
router.get('/admin', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        const organization = await prisma.organization.findUnique({ where: { id: req.organizationId } });
        if (!organization) return res.status(404).send({ message: 'Organization not found' });

        const requests = await prisma.attendanceRegularization.findMany({
            where: { organizationCode: organization.organizationCode },
            include: {
                employee: {
                    select: { employeeName: true, profilePic: true, employeeEmail: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).send({ requests });
    } catch (error) {
        console.error('Error fetching org regularizations:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

const moment = require('moment-timezone');

// ================== Admin: Approve Regularization Request ==================
router.put('/admin/:id/approve', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        const organization = await prisma.organization.findUnique({ where: { id: req.organizationId } });
        if (!organization) return res.status(404).send({ message: 'Organization not found' });

        const requestId = req.params.id;
        const { adminRemark } = req.body;

        const request = await prisma.attendanceRegularization.findUnique({ where: { id: requestId } });
        if (!request) return res.status(404).send({ message: 'Request not found' });
        if (request.status !== 'Pending') return res.status(400).send({ message: 'Request is already processed' });

        // Update regularization request
        const updatedRequest = await prisma.attendanceRegularization.update({
            where: { id: requestId },
            data: {
                status: 'Approved',
                adminRemark,
                approvedBy: organization.id,
                approvedAt: new Date()
            }
        });

        // Compute day range in Asia/Kolkata timezone
        const dateStr = moment(request.attendanceDate).tz('Asia/Kolkata').format('YYYY-MM-DD');
        const startOfDay = moment.tz(dateStr, 'YYYY-MM-DD', 'Asia/Kolkata').startOf('day').toDate();
        const endOfDay = moment.tz(dateStr, 'YYYY-MM-DD', 'Asia/Kolkata').endOf('day').toDate();

        let attendance = await prisma.attendance.findFirst({
            where: {
                employeeId: request.employeeId,
                date: { gte: startOfDay, lte: endOfDay }
            },
            include: {
                sessions: { orderBy: { clockInTime: 'asc' } }
            }
        });

        const existingFirstSession = attendance?.sessions?.[0] || null;

        const parseTimeString = (timeStr) => {
            if (!timeStr || typeof timeStr !== 'string') return null;
            const trimmed = timeStr.trim();
            if (!trimmed || trimmed === '-') return null;
            const is12Hour = trimmed.toUpperCase().includes('AM') || trimmed.toUpperCase().includes('PM');
            const format = is12Hour ? 'YYYY-MM-DD hh:mm A' : 'YYYY-MM-DD HH:mm';
            const m = moment.tz(`${dateStr} ${trimmed}`, format, 'Asia/Kolkata');
            return m.isValid() ? m.toDate() : null;
        };

        // Parse requested check-in time or retain existing
        let clockInDate = null;
        if (request.requestedCheckInDate) {
            clockInDate = new Date(request.requestedCheckInDate);
        } else if (request.requestedCheckIn) {
            clockInDate = parseTimeString(request.requestedCheckIn);
        }
        if (!clockInDate && existingFirstSession?.clockInTime) {
            clockInDate = existingFirstSession.clockInTime;
        }

        // Parse requested check-out time or retain existing
        let clockOutDate = null;
        if (request.requestedCheckOutDate) {
            clockOutDate = new Date(request.requestedCheckOutDate);
        } else if (request.requestedCheckOut) {
            clockOutDate = parseTimeString(request.requestedCheckOut);
        }
        if (!clockOutDate && existingFirstSession?.clockOutTime) {
            clockOutDate = existingFirstSession.clockOutTime;
        }

        let duration = 0;
        if (clockInDate && clockOutDate) {
            duration = Math.max(0, parseFloat(((clockOutDate.getTime() - clockInDate.getTime()) / (1000 * 60 * 60)).toFixed(2)));
        }

        if (attendance) {
            // Update existing attendance
            await prisma.attendance.update({
                where: { id: attendance.id },
                data: {
                    regularized: true,
                    regularizationId: request.id,
                    totalHours: duration,
                    finalRemark: "Regularized"
                }
            });

            // Update or create session
            if (existingFirstSession) {
                await prisma.session.update({
                    where: { id: existingFirstSession.id },
                    data: {
                        clockInTime: clockInDate || existingFirstSession.clockInTime,
                        clockOutTime: clockOutDate || existingFirstSession.clockOutTime,
                        duration: duration
                    }
                });
            } else {
                await prisma.session.create({
                    data: {
                        attendanceId: attendance.id,
                        clockInTime: clockInDate || startOfDay,
                        clockOutTime: clockOutDate,
                        duration: duration
                    }
                });
            }
        } else {
            // Create new attendance
            const employee = await prisma.employee.findUnique({ where: { id: request.employeeId } });
            attendance = await prisma.attendance.create({
                data: {
                    employeeId: employee.id,
                    employeeName: employee.employeeName,
                    organizationCode: employee.organizationCode,
                    date: startOfDay,
                    totalHours: duration,
                    regularized: true,
                    regularizationId: request.id,
                    finalRemark: "Regularized",
                    sessions: {
                        create: {
                            clockInTime: clockInDate || startOfDay,
                            clockOutTime: clockOutDate,
                            duration: duration
                        }
                    }
                }
            });
        }

        res.status(200).send({ message: 'Request approved successfully', request: updatedRequest });
    } catch (error) {
        console.error('Error approving regularization:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

// ================== Admin: Reject Regularization Request ==================
router.put('/admin/:id/reject', authenticateAdmin, requireOrganizationAccess, async (req, res) => {
    // #swagger.tags = ['Attendance and Employee Management']

    try {
        const organization = await prisma.organization.findUnique({ where: { id: req.organizationId } });
        if (!organization) return res.status(404).send({ message: 'Organization not found' });

        const requestId = req.params.id;
        const { adminRemark } = req.body;

        const request = await prisma.attendanceRegularization.findUnique({ where: { id: requestId } });
        if (!request) return res.status(404).send({ message: 'Request not found' });
        if (request.status !== 'Pending') return res.status(400).send({ message: 'Request is already processed' });

        const updatedRequest = await prisma.attendanceRegularization.update({
            where: { id: requestId },
            data: {
                status: 'Rejected',
                adminRemark,
                approvedBy: organization.id,
                approvedAt: new Date()
            }
        });

        res.status(200).send({ message: 'Request rejected successfully', request: updatedRequest });
    } catch (error) {
        console.error('Error rejecting regularization:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
