const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');
const authenticateJWT = require('../middleware/authenticateJWT');
const router = express.Router();

const formatDate = (date) => {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
};

// ================== GET Leave Requests (Admin) ==================
router.get('/organization/leave-requests', authenticateJWT, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const organization = await prisma.organization.findUnique({
            where: { id: decoded.id }
        });
        if (!organization) {
            return res.status(404).send({ message: 'Organization not found' });
        }

        const statusFilter = req.query.status;

        const whereClause = {
            organizationCode: organization.organizationCode
        };
        if (statusFilter) {
            whereClause.status = statusFilter;
        }

        const leaveRequests = await prisma.leave.findMany({
            where: whereClause,
            include: {
                employee: {
                    select: { profilePic: true, employeeName: true, employeeEmail: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        
        if (leaveRequests.length === 0) {
            return res.status(200).send({ message: 'No leave requests found.', leaveRequests: [] });
        }

        res.status(200).send({ leaveRequests });
    } catch (error) {
        console.error('Error fetching leave requests:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

// ================== Leave Request (Employee) ==================
router.post('/employee/leave-request', authenticateJWT, async (req, res) => {
    const { leaveType, startDate, endDate, reason, employeeId } = req.body;

    try {
        if (!leaveType || !startDate || !endDate || !reason) {
            return res.status(400).send({ message: 'All fields (leaveType, startDate, endDate, reason) are required.' });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).send({ message: 'Invalid startDate or endDate format.' });
        }
        if (end < start) {
            return res.status(400).send({ message: 'End date cannot be earlier than start date.' });
        }

        const employee = await prisma.employee.findUnique({
            where: { id: employeeId || req.user.id }
        });
        if (!employee) {
            return res.status(404).send({ message: 'Employee not found.' });
        }

        const overlappingLeaves = await prisma.leave.findFirst({
            where: {
                employeeId: employee.id,
                status: { not: 'Rejected' },
                startDate: { lte: end },
                endDate: { gte: start }
            }
        });

        if (overlappingLeaves) {
            return res.status(400).send({ message: 'A leave request already exists for the selected dates.' });
        }

        const newLeaveRequest = await prisma.leave.create({
            data: {
                employeeProfilePic: employee.profilePic,
                organizationCode: employee.organizationCode,
                employeeId: employee.id,
                employeeName: employee.employeeName,
                leaveType,
                startDate: start,
                endDate: end,
                reason,
                status: 'Pending'
            }
        });

        await prisma.notification.create({
            data: {
                userId: employee.id,
                organizationId: employee.organizationId,
                message: `${employee.employeeName} has requested ${leaveType} leave starting from ${start.toDateString()}.`,
                type: 'LeaveApproval',
                target: 'Organization',
                isRead: false
            }
        });

        res.status(201).send({
            message: 'Leave request submitted successfully.',
            leaveId: newLeaveRequest.id
        });
    } catch (error) {
        console.error('Error in /employee/leave-request:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

// ================== Leave Approval/Rejection (Admin) ==================
router.post('/organization/leave-approval', authenticateJWT, async (req, res) => {
    const { leaveId, status } = req.body; 

    if (!['Approved', 'Rejected'].includes(status)) {
        return res.status(400).send({ message: 'Invalid status. Allowed values are Approved or Rejected.' });
    }

    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const organization = await prisma.organization.findUnique({
            where: { id: decoded.id }
        });
        if (!organization) {
            return res.status(404).send({ message: 'Organization not found.' });
        }

        if (!leaveId) {
            return res.status(400).send({ message: 'Invalid or missing leaveId.' });
        }

        const leave = await prisma.leave.findFirst({
            where: {
                id: leaveId,
                organizationCode: organization.organizationCode
            },
            include: { employee: true }
        });

        if (!leave) {
            return res.status(404).send({ message: 'Leave request not found.' });
        }

        const updatedLeave = await prisma.leave.update({
            where: { id: leaveId },
            data: { status }
        });

        await prisma.notification.create({
            data: {
                userId: leave.employeeId,
                organizationId: organization.id, 
                message: `Your leave request from ${leave.startDate.toDateString()} to ${leave.endDate.toDateString()} has been ${status.toLowerCase()}.`,
                type: 'LeaveApproval',
                target: 'Employee',
                isRead: false
            }
        });

        res.status(200).send({
            message: `Leave request ${status.toLowerCase()} successfully.`,
            leave: {
                id: updatedLeave.id,
                employeeName: leave.employee.employeeName,
                leaveType: updatedLeave.leaveType,
                startDate: updatedLeave.startDate,
                endDate: updatedLeave.endDate,
                reason: updatedLeave.reason,
                status: updatedLeave.status
            }
        });
    } catch (error) {
        console.error('Error in /organization/leave-approval:', error);
        res.status(500).send({ message: 'Server error.', error: error.message });
    }
});

// ================== GET Employee Leave Requests ==================
router.get('/employee/leave-requests', authenticateJWT, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const employee = await prisma.employee.findUnique({
            where: { id: decoded.id }
        });
        if (!employee) {
            return res.status(404).send({ message: 'Employee not found' });
        }

        const leaveRequests = await prisma.leave.findMany({ 
            where: { employeeId: employee.id },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).send({ leaveRequests });
    } catch (error) {
        console.error('Error fetching employee leave requests:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
