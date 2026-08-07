const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');
const authenticateJWT = require('../middleware/authenticateJWT');
const router = express.Router();

// ================== Employee: Submit Regularization Request ==================
router.post('/employee', authenticateJWT, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const { attendanceDate, requestType, requestedCheckIn, requestedCheckOut, reason, attachment } = req.body;

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
router.get('/admin', authenticateJWT, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const organization = await prisma.organization.findUnique({ where: { id: decoded.id } });
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

// ================== Admin: Approve Regularization Request ==================
router.put('/admin/:id/approve', authenticateJWT, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const organization = await prisma.organization.findUnique({ where: { id: decoded.id } });
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

        // Find existing attendance for this date
        const startOfDay = new Date(request.attendanceDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);

        let attendance = await prisma.attendance.findFirst({
            where: {
                employeeId: request.employeeId,
                date: { gte: startOfDay, lt: endOfDay }
            }
        });

        // Parse requested check in/out using IST (+05:30) offset
        const clockInDate = request.requestedCheckIn ? new Date(`${startOfDay.toISOString().split('T')[0]}T${request.requestedCheckIn}:00+05:30`) : startOfDay;
        const clockOutDate = request.requestedCheckOut ? new Date(`${startOfDay.toISOString().split('T')[0]}T${request.requestedCheckOut}:00+05:30`) : startOfDay;
        let duration = 0;
        if (request.requestedCheckIn && request.requestedCheckOut) {
             duration = (clockOutDate.getTime() - clockInDate.getTime()) / (1000 * 60 * 60); // hours
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
            // Update or create a session
            const firstSession = await prisma.session.findFirst({ where: { attendanceId: attendance.id }});
            if (firstSession) {
                await prisma.session.update({
                    where: { id: firstSession.id },
                    data: {
                        clockInTime: clockInDate,
                        clockOutTime: clockOutDate,
                        duration: duration
                    }
                });
            } else {
                await prisma.session.create({
                    data: {
                        attendanceId: attendance.id,
                        clockInTime: clockInDate,
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
                            clockInTime: clockInDate,
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
router.put('/admin/:id/reject', authenticateJWT, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const organization = await prisma.organization.findUnique({ where: { id: decoded.id } });
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
