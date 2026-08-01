const express = require('express');
const authenticateJWT = require('../middleware/authenticateJWT');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { upload } = require('../config/cloudinary');
const prisma = require('../prisma/client');
const moment = require('moment-timezone');

const router = express.Router();

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

    const [employees, attendances, approvedLeaves] = await Promise.all([
      prisma.employee.findMany({
        where: { organizationCode: organization.organizationCode },
        include: { shift: true }
      }),
      prisma.attendance.findMany({
        where: {
          organizationCode: organization.organizationCode,
          date: { gte: currentDate, lt: nextDate }
        },
        include: { sessions: true }
      }),
      prisma.leave.findMany({
        where: {
          organizationCode: organization.organizationCode,
          status: 'Approved',
          startDate: { lt: nextDate },
          endDate: { gte: currentDate }
        }
      })
    ]);

    const onLeaveEmpIds = approvedLeaves.map(l => l.employeeId);

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
        const isOnLeave = onLeaveEmpIds.includes(emp.id);
        
        let status = isPresent ? 'Present' : 'Absent';
        if (!isPresent) {
          if (isOnLeave) {
            status = 'On Leave';
          } else if (emp.shift && emp.shift.weekOffs && emp.shift.weekOffs.includes(currentDayName)) {
            status = 'Week Off';
          }
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

    const { startDate, endDate } = req.query;
    
    const start = startDate ? moment(startDate).startOf('day') : moment().startOf('month');
    const end = endDate ? moment(endDate).endOf('day') : moment().endOf('month');
    const today = moment().endOf('day');
    const actualEnd = end.isAfter(today) ? today : end;

    const [employees, attendances, approvedLeaves] = await Promise.all([
      prisma.employee.findMany({
        where: { organizationCode: organization.organizationCode, status: { not: 'inactive' } },
        include: { shift: true }
      }),
      prisma.attendance.findMany({
        where: {
          organizationCode: organization.organizationCode,
          date: { gte: start.toDate(), lte: actualEnd.toDate() }
        },
        include: {
          sessions: { orderBy: { clockInTime: 'asc' } }
        }
      }),
      prisma.leave.findMany({
        where: {
          organizationCode: organization.organizationCode,
          status: 'Approved',
          startDate: { lte: actualEnd.toDate() },
          endDate: { gte: start.toDate() }
        }
      })
    ]);

    const formatHoursToHHMM = (decimalHours) => {
      if (!decimalHours) return '00:00';
      const isNegative = decimalHours < 0;
      const absHours = Math.abs(decimalHours);
      const hours = Math.floor(absHours);
      const minutes = Math.round((absHours - hours) * 60);
      let adjustedHours = hours;
      let adjustedMinutes = minutes;
      if (minutes === 60) {
        adjustedHours += 1;
        adjustedMinutes = 0;
      }
      const formattedHours = adjustedHours < 10 ? `0${adjustedHours}` : adjustedHours;
      const formattedMins = adjustedMinutes < 10 ? `0${adjustedMinutes}` : adjustedMinutes;
      return `${isNegative ? '-' : ''}${formattedHours}:${formattedMins}`;
    };

    const exportData = [];
    const employeeSummary = {};

    const orgInTimeStr = organization.inTime || '09:00';
    const orgOutTimeStr = organization.outTime || '18:00';

    for (let m = moment(start); m.isSameOrBefore(actualEnd); m.add(1, 'days')) {
      const currentDayName = m.format('dddd');
      const currentDateStr = m.format('YYYY-MM-DD');
      
      employees.forEach(emp => {
        const email = emp.employeeEmail || 'unknown';
        if (!employeeSummary[email]) {
          employeeSummary[email] = {
            EmployeeName: emp.employeeName,
            Email: email,
            TotalDecimalHours: 0
          };
        }

        const attendance = attendances.find(a => a.employeeId === emp.id && moment(a.date).format('YYYY-MM-DD') === currentDateStr);
        const isOnLeave = approvedLeaves.some(l => l.employeeId === emp.id && moment(l.startDate).startOf('day').isSameOrBefore(m) && moment(l.endDate).endOf('day').isSameOrAfter(m));
        const isWeekOff = emp.shift && emp.shift.weekOffs && emp.shift.weekOffs.includes(currentDayName);

        let status = '';
        let loginTime = 'N/A';
        let logoutTime = 'N/A';
        let totalHours = 0;
        let extraHours = 0;

        if (attendance && attendance.sessions && attendance.sessions.length > 0) {
          const firstSession = attendance.sessions[0];
          const lastSession = attendance.sessions[attendance.sessions.length - 1];
          loginTime = moment(firstSession.clockInTime).format('hh:mm A');
          logoutTime = lastSession.clockOutTime ? moment(lastSession.clockOutTime).format('hh:mm A') : 'N/A';
          totalHours = attendance.totalHours || 0;
          extraHours = attendance.extraHours || 0;
          employeeSummary[email].TotalDecimalHours += totalHours;

          let expectedInTime = moment(m);
          let expectedOutTime = moment(m);
          const inTimeParts = (emp.shift?.startTime || orgInTimeStr).split(':');
          const outTimeParts = (emp.shift?.endTime || orgOutTimeStr).split(':');
          expectedInTime.set({ hour: parseInt(inTimeParts[0]), minute: parseInt(inTimeParts[1]), second: 0 });
          expectedOutTime.set({ hour: parseInt(outTimeParts[0]), minute: parseInt(outTimeParts[1]), second: 0 });

          const isLate = moment(firstSession.clockInTime).isAfter(expectedInTime);
          const isEarlyLeave = lastSession.clockOutTime && moment(lastSession.clockOutTime).isBefore(expectedOutTime);

          if (isLate && isEarlyLeave) status = 'Late Login & Early Leave';
          else if (isLate) status = 'Late Login';
          else if (isEarlyLeave) status = 'Early Leave';
          else status = 'On Time';

        } else {
          if (isOnLeave) status = 'On Leave';
          else if (isWeekOff) status = 'Week Off';
          else status = 'Absent';
        }

        exportData.push({
          EmployeeName: emp.employeeName,
          Email: email,
          Date: currentDateStr,
          LoginTime: loginTime,
          LogoutTime: logoutTime,
          TotalHours: formatHoursToHHMM(totalHours),
          ExtraHours: formatHoursToHHMM(extraHours),
          Status: status
        });
      });
    }

    exportData.sort((a, b) => new Date(b.Date) - new Date(a.Date)); // sort by date descending

    const summaryData = Object.values(employeeSummary).map(emp => ({
      EmployeeName: emp.EmployeeName,
      Email: emp.Email,
      TotalMonthlyHours: formatHoursToHHMM(emp.TotalDecimalHours)
    }));

    res.status(200).send({ exportData, summaryData });
  } catch (error) {
    console.error('Error exporting attendance:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
