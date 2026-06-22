const express = require('express');
const QRCode = require('qrcode');
const Organization = require('../models/organization');
const Employee = require('../models/employee');
const authenticateJWT = require('../middleware/authenticateJWT');
const crypto = require('crypto');
const cron = require('node-cron');
const Leave = require('../models/leave');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const Attendance = require('../models/attendance');

const router = express.Router();

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

/**
 * Generate Today's QR Code (Always Generates a New One)
 */
router.post('/generate-qr', authenticateJWT, async (req, res) => {
  try {
    const organizationId = req.user.id; // Get organization ID from token
    const organization = await Organization.findById(organizationId);

    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }
    // ✅ Check if inTime and outTime are set
    if (!organization.inTime || !organization.outTime) {
      return res.status(400).send({ message: 'In time and Out time must be set before accessing the QR code.' });
    }

    // ✅ Check if location is set properly (not empty and not default [0, 0])
    const coords = organization.location?.coordinates;
    if (!coords || coords.length !== 2 || (coords[0] === 0 && coords[1] === 0)) {
      return res.status(400).send({ message: 'Location must be set before accessing the QR code.' });
    }
    // Always generate a new QR code
    const baseUrl = process.env.FRONTEND_URL;
    const qrCode = `${baseUrl}/qr?code=${crypto.randomBytes(16).toString('hex')}`;
    const qrCodeExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // Expires in 24 hours
    const qrCodeImage = await QRCode.toDataURL(qrCode); // Generate QR code image

    // Update organization with new QR code details
    await Organization.findByIdAndUpdate(organizationId, {
      qrCode,
      qrCodeImage,
      qrCodeExpires,
    });

    res.status(200).send({
      message: 'New QR code generated successfully',
      qrCode,
      qrCodeImage,
      qrCodeExpires,
    });

  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).send({ message: 'Internal Server Error', error });
  }
});


/**
 * Get Today's QR Code
 */
router.get('/qr-code', authenticateJWT, async (req, res) => {
  try {
    const organizationId = req.user.id; // Get organization ID from token
    const organization = await Organization.findById(organizationId);

    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }

    // ✅ Check if inTime and outTime are set
    if (!organization.inTime || !organization.outTime) {
      return res.status(400).send({ message: 'In time and Out time must be set before accessing the QR code.' });
    }

    // ✅ Check if location is set properly (not empty and not default [0, 0])
    const coords = organization.location?.coordinates;
    if (!coords || coords.length !== 2 || (coords[0] === 0 && coords[1] === 0)) {
      return res.status(400).send({ message: 'Location must be set before accessing the QR code.' });
    }

    // Check if QR code exists and is still valid
    if (!organization.qrCode || organization.qrCodeExpires < new Date()) {
      return res.status(400).send({ message: 'No valid QR code found. Please generate a new one.' });
    }

    res.status(200).send({
      message: 'QR code retrieved successfully',
      qrCode: organization.qrCode,
      organizationName:organization.organizationName,
      qrCodeImage: organization.qrCodeImage,
      qrCodeExpires: organization.qrCodeExpires,
    });

  } catch (error) {
    res.status(500).send({ message: 'Internal Server Error', error });
  }
});


// ================== Get All Employees for an Organization ==================
router.get('/employees', authenticateJWT, async (req, res) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const organization = await Organization.findById(decoded.id);
    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }

    const employees = await Employee.find({ organizationCode: organization.organizationCode });
    if (!employees || employees.length === 0) {
      return res.status(404).send({ message: 'No employees found for this organization' });
    }

    res.status(200).send({ employees });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).send({ message: 'Invalid or expired token' });
    }
    console.error('Error in /organization/employees:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Present Employees in the Organization ==================
router.get('/present-employees', authenticateJWT, async (req, res) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch organization details
    const organization = await Organization.findById(decoded.id);
    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }

    // Get the current date in YYYY-MM-DD format
    const currentDate = new Date().toISOString().slice(0, 10);

    // Pagination query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Fetch present employees for today
    const presentEmployees = await Attendance.find({
      organizationCode: organization.organizationCode,
      date: currentDate,
      isClockedIn: true,
      isClockedOut: false // Currently clocked in but not clocked out
    })
      .select('employeeName clockInTime') // Select only necessary fields
      .skip(skip) // Pagination offset
      .limit(limit); // Pagination limit

    // Count total present employees
    const totalPresent = await Attendance.countDocuments({
      organizationCode: organization.organizationCode,
      date: currentDate,
      isClockedIn: true,
      isClockedOut: false
    });

    // If no present employees found
    if (presentEmployees.length === 0) {
      return res.status(200).send({ message: 'No employees are currently present.' });
    }

    res.status(200).send({
      message: 'Present employees retrieved successfully.',
      totalPresent,
      page,
      totalPages: Math.ceil(totalPresent / limit),
      presentEmployees
    });
  } catch (error) {
    console.error('Error in /present-employees:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

router.get('/employees-status', authenticateJWT, async (req, res) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const organization = await Organization.findById(decoded.id);
    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }

    const currentDate = new Date().toISOString().slice(0, 10);

    const employeesStatus = await Attendance.find({
      organizationCode: organization.organizationCode,
      date: currentDate,
    })
      .populate('employee', 'employeeName employeeEmail profilePic')
      .select('employee sessions totalHours finalRemark');

    const presentEmployees = [];
    const lateEmployees = [];
    const earlyLeaversEmployees = [];

    employeesStatus.forEach((employeeStatus) => {
      const { employee, sessions, totalHours, finalRemark } = employeeStatus;

      if (sessions.length === 0) return; // Skip if no sessions (Absent)

      const firstSession = sessions[0];
      const lastSession = sessions[sessions.length - 1];

      const employeeData = {
        _id: employeeStatus._id,
        employeeId: employee._id,
        employeeName: employee.employeeName,
        employeeEmail: employee.employeeEmail,
        profilePic: employee.profilePic,
        firstClockIn: firstSession.clockInTime,
        lastClockOut: lastSession.clockOutTime,
        totalHours,
        finalRemark,
      };

      // Always add to Present Employees
      presentEmployees.push(employeeData);

      // Add to Late Employees if first session remark is "Late"
      if (firstSession.clockInRemark === 'Late') {
        lateEmployees.push(employeeData);
      }

      // Add to Early Leavers if last session remark is "Left Early"
      if (lastSession.clockOutRemark === 'Left Early') {
        earlyLeaversEmployees.push(employeeData);
      }
    });

    const organizationEmployees = await Employee.find({ organizationCode: organization.organizationCode })
      .select('_id employeeName employeeEmail profilePic');

    const employeesOnLeave = await Leave.find({
      organizationCode: organization.organizationCode,
      status: 'Approved',
      startDate: { $lte: currentDate },
      endDate: { $gte: currentDate },
    }).populate('employee', 'employeeName employeeEmail profilePic');

    const absentEmployees = organizationEmployees
      .filter(
        (orgEmployee) =>
          !employeesStatus.some((status) => status.employee._id.toString() === orgEmployee._id.toString()) &&
          !employeesOnLeave.some((leaveEmployee) => leaveEmployee.employee._id.toString() === orgEmployee._id.toString())
      )
      .map((employee) => ({
        _id: employee._id,
        employeeName: employee.employeeName,
        employeeEmail: employee.employeeEmail,
        profilePic: employee.profilePic,
      }));

    // Combine all employees in a single array
    const allEmployees = organizationEmployees.map((employee) => ({
      _id: employee._id,
      employeeName: employee.employeeName,
      employeeEmail: employee.employeeEmail,
      profilePic: employee.profilePic,
      status: presentEmployees.some((emp) => emp.employeeId.toString() === employee._id.toString())
        ? 'Present'
        : employeesOnLeave.some((emp) => emp.employee._id.toString() === employee._id.toString())
          ? 'On Leave'
          : 'Absent',
    }));

    // Apply filtering if query parameters exist
    let filteredEmployees = allEmployees;
    if (req.query.filter) {
      const filter = req.query.filter.toLowerCase();
      switch (filter) {
        case 'present':
          filteredEmployees = presentEmployees;
          break;
        case 'absent':
          filteredEmployees = absentEmployees;
          break;
        case 'late':
          filteredEmployees = lateEmployees;
          break;
        case 'earlyleavers':
          filteredEmployees = earlyLeaversEmployees;
          break;
        case 'onleave':
          filteredEmployees = employeesOnLeave.map((leave) => leave.employee);
          break;
      }
    }

    res.status(200).send({
      allEmployees, // Always return all employees
      filteredEmployees, // Return filtered data if query params exist
    });
  } catch (error) {
    console.error('Error in /employees-status:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ==================  employees data in the organization==================
router.get('/employees-data', authenticateJWT, async (req, res) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);


    const organization = await Organization.findById(decoded.id);
    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }

    // const {employeeId} = req.params()

    // Get the current date (without time)
    const currentDate = new Date().toISOString().slice(0, 10);

    // Find all attendance records for today where the employee is clocked in and not clocked out
    const employees = (await employee.find({ organizationCode: organization.organizationCode, }))

    // employees.forEach(async employee => {
    //   employeeLeaves[employee._id] = await leave.find({
    //     organizationCode: organization.organizationCode,
    //     employee:employee._id,
    //   })
    // });

    // Create an array of promises for fetching approved leaves for each employee
    const employeeLeavesPromises = employees.map(async (employee) => {
      const leaves = await leave.find({
        organizationCode: organization.organizationCode,
        employee: employee._id,
      });
      return { employeeId: employee._id, leaves };
    });

    // Wait for all promises to resolve
    const employeeLeaves = await Promise.all(employeeLeavesPromises);

    // Transform the result into an object if needed
    const LeavesObject = {};
    employeeLeaves.forEach(({ employeeId, leaves }) => {
      LeavesObject[employeeId] = leaves;
    });

    // console.log(LeavesObject);

    // If no present employees found
    if (employees.length === 0) {
      return res.status(200).send({ message: 'No employees are currently present.' });
    }
    res.status(200).send({ LeavesObject });
  } catch (error) {
    console.error('Error in /organization/employees-status:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});
// Endpoint to upload/update profile picture
router.post('/profile/upload-pic', authenticateJWT, upload.single('profilePic'), async (req, res) => {
  try {
    const organizationId = req.user.id; // Assuming JWT contains organization ID

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const profilePicPath = `/uploads/${req.file.filename}`;

    const organization = await Organization.findByIdAndUpdate(
      organizationId,
      { organizationProfilePic: profilePicPath },
      { new: true }
    );

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.status(200).json({
      message: 'Profile picture updated successfully',
      profilePic: profilePicPath
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/employee-details/:employeeId', authenticateJWT, async (req, res) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { employeeId } = req.params;

    // Fetch the organization using the token's decoded ID
    const organization = await Organization.findById(decoded.id);
    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }

    // Fetch the specific employee by ID
    const employeeDetails = await Employee.findOne({
      _id: employeeId,
      organizationCode: organization.organizationCode,
    }).select('employeeName profilePic');

    if (!employeeDetails) {
      return res.status(404).send({ message: 'Employee not found' });
    }

    // Fetch leave statistics
    const totalLeaves = await Leave.countDocuments({
      organizationCode: organization.organizationCode,
      employee: employeeId,
    });

    const approvedLeaves = await Leave.countDocuments({
      organizationCode: organization.organizationCode,
      employee: employeeId,
      status: 'Approved',
    });

    const rejectedLeaves = await Leave.countDocuments({
      organizationCode: organization.organizationCode,
      employee: employeeId,
      status: 'Rejected',
    });

    // Fetch attendance records
    const attendanceRecords = await Attendance.find({
      organizationCode: organization.organizationCode,
      employee: employeeId,
    }).select('date sessions totalHours finalRemark'); // Select relevant fields

    // Fetch approved leave records with date range
    const approvedLeaveRecords = await Leave.find({
      organizationCode: organization.organizationCode,
      employee: employeeId,
      status: 'Approved',
    }).select('startDate endDate leaveType');

    // Organize attendance into a calendar format
    const calendar = {};

    attendanceRecords.forEach(record => {
      const dateStr = record.date.toISOString().split('T')[0]; // Format as YYYY-MM-DD

      // Ensure we get first and last session correctly
      const firstSession = record.sessions.length > 0 ? record.sessions[0] : null;
      const lastSession = record.sessions.length > 0 ? record.sessions[record.sessions.length - 1] : null;

      calendar[dateStr] = {
        status: record.finalRemark, // 'Present', 'Absent', etc.
        clockInTime: firstSession ? firstSession.clockInTime : null,
        clockOutTime: lastSession ? lastSession.clockOutTime : null,
        totalHours: record.totalHours,
      };
    });

    // Add approved leave dates to the calendar
    approvedLeaveRecords.forEach(leaveRecord => {
      const currentDate = new Date(leaveRecord.startDate);
      const endDate = new Date(leaveRecord.endDate);

      while (currentDate <= endDate) {
        const dateString = currentDate.toISOString().split('T')[0];
        calendar[dateString] = {
          status: 'Leave',
          leaveType: leaveRecord.leaveType,
          clockInTime: null,
          clockOutTime: null,
          totalHours: null,
        };
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    // Construct the response
    const response = {
      employeeDetails: {
        name: employeeDetails.employeeName,
        profilePic: employeeDetails.profilePic,
      },
      leaveStatistics: {
        totalLeaves,
        approvedLeaves,
        rejectedLeaves,
      },
      attendanceCalendar: calendar,
    };

    res.status(200).send(response);
  } catch (error) {
    console.error('Error in /employee-details:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Delete an Employee ==================
router.delete('/employee/:employeeId', authenticateJWT, async (req, res) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const organization = await Organization.findById(decoded.id);
    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }

    const { employeeId } = req.params;

    // Verify that the employee belongs to this organization
    const employee = await Employee.findOne({
      _id: employeeId,
      organizationCode: organization.organizationCode,
    });

    if (!employee) {
      return res.status(404).send({ message: 'Employee not found in your organization' });
    }

    // Soft delete: keep the records but mark employee as inactive
    employee.status = 'inactive';
    await employee.save();

    res.status(200).send({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Error in /employee/:employeeId DELETE:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
