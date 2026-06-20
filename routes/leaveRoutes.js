const express = require('express');
const jwt = require('jsonwebtoken');
const Employee = require('../models/employee');
const Organization = require('../models/organization');
const Leave = require('../models/leave');
const authenticateJWT = require('../middleware/authenticateJWT');
const router = express.Router();
const createNotification = require('../Helpers/CreateNotification.js');
const Notification = require('../models/notification'); // Adjust path if needed
const mongoose = require('mongoose');

// Utility function to format date as dd/mm/yyyy
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

        const organization = await Organization.findById(decoded.id);
        if (!organization) {
            return res.status(404).send({ message: 'Organization not found' });
        }

        //const leaveRequests = await Leave.find({ organizationCode: organization.organizationCode });
        const leaveRequests = await Leave.find({
            organizationCode: organization.organizationCode,
            status: 'Pending' // Only fetch pending requests
        }).populate({
            path: 'employee', // Referencing the employee field
            select: 'profilePic name email' // Fetch only required fields
        });
        
        if (leaveRequests.length === 0) {
            return res.status(200).send({ message: 'No leave requests found.' });
        }

        res.status(200).send({ leaveRequests });
    } catch (error) {
        console.error('Error fetching leave requests:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

// ================== Leave Request (Employee) ==================
router.post('/employee/leave-request', authenticateJWT, async (req, res) => {
   
    const { leaveType, startDate, endDate, reason,employeeId } = req.body;

    try {
        // Input validation
        if (!leaveType || !startDate || !endDate || !reason) {
            return res.status(400).send({ message: 'All fields (leaveType, startDate, endDate, reason) are required.' });
        }

        // Validate date format and logical relationship
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).send({ message: 'Invalid startDate or endDate format.' });
        }
        if (end < start) {
            return res.status(400).send({ message: 'End date cannot be earlier than start date.' });
        }
        console.log(employeeId) 
        // Fetch employee details using the ID from params
        const employee = await Employee.findById(employeeId);
        if (!employee) {
            return res.status(404).send({ message: 'Employee not found.' });
        }

        const overlappingLeaves = await Leave.findOne({
            employee: employee._id,
            status: { $ne: 'Rejected' }, // Exclude rejected leaves
            $or: [
                { startDate: { $lte: end }, endDate: { $gte: start } }
            ]
        });
        

        if (overlappingLeaves) {
            return res.status(400).send({ message: 'A leave request already exists for the selected dates.' });
        }

        // Create new leave request
        const newLeaveRequest = new Leave({
            employeeProfilePic: employee.profilePic,
            organizationCode: employee.organizationCode,
            employee: employee._id,
            employeeName: employee.employeeName,
            leaveType,
            startDate,
            endDate,
            reason
        });

        await newLeaveRequest.save();

        // ============ Create Notification for Organization ============
        
        const notification = new Notification({
            user: employee._id, // The employee who triggered the notification
            organization: employee.organization, // Must be ObjectId of the organization
            message: `${employee.employeeName} has requested ${leaveType} leave starting from ${new Date(startDate).toDateString()}.`,
            type: 'LeaveApproval',
            target: 'Organization'
        });
        

        await notification.save();

        res.status(201).send({
            message: 'Leave request submitted successfully.',
            leaveId: newLeaveRequest._id
        });
    } catch (error) {
        console.error('Error in /employee/:employeeId/leave-request:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});


// ================== Leave Approval/Rejection (Admin) ==================
router.post('/organization/leave-approval', authenticateJWT, async (req, res) => {
    const { leaveId, status } = req.body; // Status: 'Approved' or 'Rejected'

    // Validate status
    if (!['Approved', 'Rejected'].includes(status)) {
        return res.status(400).send({ message: 'Invalid status. Allowed values are Approved or Rejected.' });
    }

    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch the admin's organization details
        const organization = await Organization.findById(decoded.id);
        if (!organization) {
            return res.status(404).send({ message: 'Organization not found.' });
        }

        // Validate leaveId
        if (!leaveId || !mongoose.isValidObjectId(leaveId)) {
            return res.status(400).send({ message: 'Invalid or missing leaveId.' });
        }

        // Find the leave request and populate related employee details
        const leave = await Leave.findOne({
            _id: leaveId,
            organizationCode: organization.organizationCode
        }).populate('employee', 'employeeName email'); // Populate only necessary fields

        if (!leave) {
            return res.status(404).send({ message: 'Leave request not found.' });
        }

        // Update leave status
        leave.status = status;
        leave.updatedAt = new Date();
        await leave.save();

        const employeeNotification = new Notification({
            user: leave.employee._id, // Notify the specific employee
            organization: organization._id, // Still associated with the org but filtered by user
            message: `Your leave request from ${leave.startDate.toDateString()} to ${leave.endDate.toDateString()} has been ${status.toLowerCase()}.`,
            type: 'LeaveApproval',
            target: 'Employee'
        });
        
        await employeeNotification.save();

        res.status(200).send({
            message: `Leave request ${status.toLowerCase()} successfully.`,
            leave: {
                id: leave._id,
                employeeName: leave.employee.employeeName,
                leaveType: leave.leaveType,
                startDate: leave.startDate,
                endDate: leave.endDate,
                reason: leave.reason,
                status: leave.status
            }
        });
    } catch (error) {
        console.error('Error in /organization/leave-approval:', error);
        res.status(500).send({ message: 'Server error.', error: error.message });
    }
});


// ================== GET Leave Requests (Admin) ==================
router.get('/organization/leave-requests', authenticateJWT, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const organization = await Organization.findById(decoded.id);
        if (!organization) {
            return res.status(404).send({ message: 'Organization not found' });
        }

        const leaveRequests = await Leave.find({ organizationCode: organization.organizationCode })
            .populate('employee', 'profilePic name email');

        res.status(200).send({ leaveRequests });
    } catch (error) {
        console.error('Error fetching leave requests:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

// ================== GET Employee Leave Requests ==================
router.get('/employee/leave-requests', authenticateJWT, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const employee = await Employee.findById(decoded.id);
        if (!employee) {
            return res.status(404).send({ message: 'Employee not found' });
        }

        const leaveRequests = await Leave.find({ employee: employee._id });

        res.status(200).send({ leaveRequests });
    } catch (error) {
        console.error('Error fetching employee leave requests:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
