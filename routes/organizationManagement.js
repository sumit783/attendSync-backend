const express = require('express');
const authenticateJWT = require('../middleware/authenticateJWT');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const prisma = require('../prisma/client');
const moment = require('moment-timezone');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 2 },
});

// ================== Register Office Wi-Fi ==================
router.post('/office-wifi', authenticateJWT, async (req, res) => {
  try {
    const organizationId = req.user.id;
    const { wifiSSID, wifiBSSID, address, latitude, longitude } = req.body;

    if (!wifiSSID || !wifiBSSID) {
      return res.status(400).send({ message: 'WiFi SSID and BSSID are required.' });
    }

    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        wifiSSID,
        wifiBSSID,
        address,
        latitude: latitude ? parseFloat(latitude) : undefined,
        longitude: longitude ? parseFloat(longitude) : undefined,
      },
    });

    res.status(200).send({
      message: 'Office Wi-Fi registered successfully',
      organization: {
        wifiSSID: organization.wifiSSID,
        wifiBSSID: organization.wifiBSSID,
        address: organization.address,
        latitude: organization.latitude,
        longitude: organization.longitude
      }
    });
  } catch (error) {
    console.error('Error registering Wi-Fi:', error);
    res.status(500).send({ message: 'Internal Server Error', error: error.message });
  }
});

// ================== Get All Employees for an Organization ==================
router.get('/employees', authenticateJWT, async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user.id }
    });

    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }

    const employees = await prisma.employee.findMany({
      where: { organizationCode: organization.organizationCode }
    });

    if (!employees || employees.length === 0) {
      return res.status(404).send({ message: 'No employees found for this organization' });
    }

    res.status(200).send({ employees });
  } catch (error) {
    console.error('Error in /organization/employees:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Present Employees in the Organization ==================
router.get('/present-employees', authenticateJWT, async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user.id }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const presentEmployees = await prisma.attendance.findMany({
      where: {
        organizationCode: organization.organizationCode,
        date: { gte: currentDate, lt: nextDate },
        sessions: {
          some: {
            clockOutTime: null
          }
        }
      },
      select: {
        employeeName: true,
        sessions: {
          take: 1,
          orderBy: { clockInTime: 'asc' },
          select: { clockInTime: true }
        }
      },
      skip,
      take: limit
    });

    const totalPresent = await prisma.attendance.count({
      where: {
        organizationCode: organization.organizationCode,
        date: { gte: currentDate, lt: nextDate },
        sessions: {
          some: {
            clockOutTime: null
          }
        }
      }
    });

    if (presentEmployees.length === 0) {
      return res.status(200).send({ message: 'No employees are currently present.' });
    }

    const formattedEmployees = presentEmployees.map(emp => ({
      employeeName: emp.employeeName,
      clockInTime: emp.sessions[0]?.clockInTime
    }));

    res.status(200).send({
      message: 'Present employees retrieved successfully.',
      totalPresent,
      page,
      totalPages: Math.ceil(totalPresent / limit),
      presentEmployees: formattedEmployees
    });
  } catch (error) {
    console.error('Error in /present-employees:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Reset Employee Device ==================
router.post('/employees/:employeeId/reset-device', authenticateJWT, async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user.id }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const employeeId = req.params.employeeId;

    const employee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationCode: organization.organizationCode
      }
    });

    if (!employee) return res.status(404).send({ message: 'Employee not found' });

    await prisma.employeeDevice.updateMany({
      where: {
        employeeId: employee.id,
        status: 'ACTIVE'
      },
      data: {
        status: 'REVOKED'
      }
    });

    res.status(200).send({ message: 'Employee devices reset successfully.' });
  } catch (error) {
    console.error('Error in /reset-device:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Delete an Employee ==================
router.delete('/employee/:employeeId', authenticateJWT, async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user.id }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const { employeeId } = req.params;

    const employee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationCode: organization.organizationCode,
      }
    });

    if (!employee) return res.status(404).send({ message: 'Employee not found in your organization' });

    await prisma.employee.update({
      where: { id: employeeId },
      data: { status: 'inactive' }
    });

    res.status(200).send({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Error in /employee/:employeeId DELETE:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Get Employees Status (Present, Late, Early Leavers) ==================
router.get('/employees-status', authenticateJWT, async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user.id }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const employees = await prisma.employee.findMany({
      where: { organizationCode: organization.organizationCode },
      include: { shift: true }
    });

    const attendances = await prisma.attendance.findMany({
      where: {
        organizationCode: organization.organizationCode,
        date: { gte: currentDate, lt: nextDate }
      },
      include: { sessions: true }
    });

    const orgInTimeStr = organization.inTime || '09:00';
    const orgOutTimeStr = organization.outTime || '18:00';

    let filteredEmployees = [];
    const filter = req.query.filter ? req.query.filter.toLowerCase() : '';

    if (filter === 'present') {
      const presentEmpIds = attendances.map(a => a.employeeId);
      filteredEmployees = employees.filter(emp => presentEmpIds.includes(emp.id));
    } else if (filter === 'late') {
      const lateEmpIds = attendances.filter(a => {
        if (!a.sessions || a.sessions.length === 0) return false;
        const firstSession = [...a.sessions].sort((s1, s2) => s1.clockInTime - s2.clockInTime)[0];
        const clockInDate = new Date(firstSession.clockInTime);
        const expectedInTime = new Date(currentDate);
        const emp = employees.find(e => e.id === a.employeeId);
        const inTimeStr = emp?.shift?.startTime || orgInTimeStr;
        const [hours, minutes] = inTimeStr.split(':');
        expectedInTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        return clockInDate > expectedInTime;
      }).map(a => a.employeeId);
      filteredEmployees = employees.filter(emp => lateEmpIds.includes(emp.id));
    } else if (filter === 'earlyleavers') {
      const earlyEmpIds = attendances.filter(a => {
        if (!a.sessions || a.sessions.length === 0) return false;
        const lastSession = [...a.sessions].sort((s1, s2) => s2.clockInTime - s1.clockInTime)[0];
        if (!lastSession.clockOutTime) return false;
        const clockOutDate = new Date(lastSession.clockOutTime);
        const expectedOutTime = new Date(currentDate);
        const emp = employees.find(e => e.id === a.employeeId);
        const outTimeStr = emp?.shift?.endTime || orgOutTimeStr;
        const [hours, minutes] = outTimeStr.split(':');
        expectedOutTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        return clockOutDate < expectedOutTime;
      }).map(a => a.employeeId);
      filteredEmployees = employees.filter(emp => earlyEmpIds.includes(emp.id));
    } else {
      const currentDayName = currentDate.toLocaleDateString('en-US', { weekday: 'long' });
      filteredEmployees = employees.map(emp => {
        const isPresent = attendances.some(a => a.employeeId === emp.id);
        let status = isPresent ? 'Present' : 'Absent';
        if (!isPresent && emp.shift && emp.shift.weekOffs && emp.shift.weekOffs.includes(currentDayName)) {
            status = 'Week Off';
        }
        return {
          ...emp,
          status
        };
      });
    }

    res.status(200).send({ filteredEmployees });
  } catch (error) {
    console.error('Error in /employees-status:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

// ================== Get Employee Details ==================
router.get('/employee-details/:employeeId', authenticateJWT, async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user.id }
    });
    if (!organization) {
      return res.status(404).send({ message: 'Organization not found' });
    }

    const { employeeId } = req.params;

    const employeeDetails = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationCode: organization.organizationCode,
      },
      select: {
        employeeName: true,
        profilePic: true,
        shift: true,
      }
    });

    if (!employeeDetails) {
      return res.status(404).send({ message: 'Employee not found' });
    }

    const totalLeaves = await prisma.leave.count({
      where: {
        employeeId: employeeId,
        organizationCode: organization.organizationCode,
      }
    });

    const approvedLeaves = await prisma.leave.count({
      where: {
        employeeId: employeeId,
        organizationCode: organization.organizationCode,
        status: 'Approved',
      }
    });

    const rejectedLeaves = await prisma.leave.count({
      where: {
        employeeId: employeeId,
        organizationCode: organization.organizationCode,
        status: 'Rejected',
      }
    });

    const attendanceRecords = await prisma.attendance.findMany({
      where: {
        employeeId: employeeId,
        organizationCode: organization.organizationCode,
      },
      select: {
        date: true,
        totalHours: true,
        finalRemark: true,
        sessions: {
          orderBy: { clockInTime: 'asc' },
          select: { clockInTime: true, clockOutTime: true }
        }
      }
    });

    const approvedLeaveRecords = await prisma.leave.findMany({
      where: {
        employeeId: employeeId,
        organizationCode: organization.organizationCode,
        status: 'Approved',
      },
      select: {
        startDate: true,
        endDate: true,
        leaveType: true,
      }
    });

    const calendar = {};

    attendanceRecords.forEach(record => {
      const dateStr = record.date.toISOString().split('T')[0];
      const firstSession = record.sessions.length > 0 ? record.sessions[0] : null;
      const lastSession = record.sessions.length > 0 ? record.sessions[record.sessions.length - 1] : null;

      calendar[dateStr] = {
        status: record.finalRemark,
        clockInTime: firstSession ? firstSession.clockInTime : null,
        clockOutTime: lastSession ? lastSession.clockOutTime : null,
        totalHours: record.totalHours,
      };
    });

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

    const response = {
      employeeDetails: {
        name: employeeDetails.employeeName,
        profilePic: employeeDetails.profilePic,
        shift: employeeDetails.shift,
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

// ================== Export Attendance Data ==================
router.get('/export-attendance', authenticateJWT, async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user.id }
    });
    if (!organization) return res.status(404).send({ message: 'Organization not found' });

    const attendances = await prisma.attendance.findMany({
      where: {
        organizationCode: organization.organizationCode
      },
      include: {
        sessions: {
          orderBy: { clockInTime: 'asc' }
        },
        employee: {
          select: { employeeName: true, employeeEmail: true }
        }
      },
      orderBy: { date: 'desc' }
    });

    const exportData = attendances.map(a => {
      const firstSession = a.sessions.length > 0 ? a.sessions[0] : null;
      const lastSession = a.sessions.length > 0 ? a.sessions[a.sessions.length - 1] : null;

      return {
        EmployeeName: a.employeeName,
        Email: a.employee ? a.employee.employeeEmail : '',
        Date: moment(a.date).format('YYYY-MM-DD'),
        LoginTime: firstSession ? moment(firstSession.clockInTime).format('hh:mm A') : 'N/A',
        LogoutTime: (lastSession && lastSession.clockOutTime) ? moment(lastSession.clockOutTime).format('hh:mm A') : 'N/A',
        TotalHours: a.totalHours.toFixed(2),
        ExtraHours: a.extraHours.toFixed(2),
        Status: a.finalRemark
      };
    });

    res.status(200).send({ exportData });
  } catch (error) {
    console.error('Error exporting attendance:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
