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
      where: { organizationCode: organization.organizationCode }
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
        const [hours, minutes] = orgInTimeStr.split(':');
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
        const [hours, minutes] = orgOutTimeStr.split(':');
        expectedOutTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        return clockOutDate < expectedOutTime;
      }).map(a => a.employeeId);
      filteredEmployees = employees.filter(emp => earlyEmpIds.includes(emp.id));
    } else {
      filteredEmployees = employees.map(emp => {
        const isPresent = attendances.some(a => a.employeeId === emp.id);
        return {
          ...emp,
          status: isPresent ? 'Present' : 'Absent'
        };
      });
    }

    res.status(200).send({ filteredEmployees });
  } catch (error) {
    console.error('Error in /employees-status:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});

router.get('/export-attendance', authenticateJWT, async (req, res) => {
    try {
        const { range, startDate, endDate } = req.query;
        const organizationId = req.user.id;

        let start, end;
        const tz = 'Asia/Kolkata';

        switch (range) {
            case 'this_month':
                start = moment().tz(tz).startOf('month');
                end = moment().tz(tz).endOf('month');
                break;
            case 'last_month':
                start = moment().tz(tz).subtract(1, 'month').startOf('month');
                end = moment().tz(tz).subtract(1, 'month').endOf('month');
                break;
            case 'last_3_months':
                start = moment().tz(tz).subtract(3, 'months').startOf('month');
                end = moment().tz(tz).endOf('month');
                break;
            case 'custom':
                if (!startDate || !endDate) {
                    return res.status(400).json({ message: 'startDate and endDate are required for custom range' });
                }
                start = moment.tz(startDate, tz).startOf('day');
                end = moment.tz(endDate, tz).endOf('day');
                break;
            default:
                return res.status(400).json({ message: 'Invalid date range specified' });
        }

        const employees = await Employee.find({ organization: organizationId });
        const employeeIds = employees.map(e => e._id);

        const attendances = await Attendance.find({
            employee: { $in: employeeIds },
            date: { $gte: start.toDate(), $lte: end.toDate() }
        }).populate('employee', 'employeeName employeeEmail');

        const leaves = await Leave.find({
            employee: { $in: employeeIds },
            status: 'Approved',
            startDate: { $lte: end.toDate() },
            endDate: { $gte: start.toDate() }
        }).populate('employee', 'employeeName employeeEmail');

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Attendance Report');

        worksheet.columns = [
            { header: 'Employee Name', key: 'name', width: 25 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Date', key: 'date', width: 15 },
            { header: 'Status', key: 'status', width: 20 },
            { header: 'In Time', key: 'inTime', width: 15 },
            { header: 'Out Time', key: 'outTime', width: 15 },
            { header: 'Working Hours', key: 'hours', width: 20 }
        ];

        // Format header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        const rows = [];

        // Add Attendance Data
        attendances.forEach(att => {
            const firstSession = att.sessions && att.sessions.length > 0 ? att.sessions[0] : null;
            const lastSession = att.sessions && att.sessions.length > 0 ? att.sessions[att.sessions.length - 1] : null;

            rows.push({
                name: att.employee ? att.employee.employeeName : 'Unknown',
                email: att.employee ? att.employee.employeeEmail : 'Unknown',
                date: moment(att.date).tz(tz).format('YYYY-MM-DD'),
                status: att.finalRemark || 'Present',
                inTime: firstSession && firstSession.clockInTime ? moment(firstSession.clockInTime).tz(tz).format('hh:mm A') : '-',
                outTime: lastSession && lastSession.clockOutTime ? moment(lastSession.clockOutTime).tz(tz).format('hh:mm A') : '-',
                hours: att.totalHours ? att.totalHours.toFixed(2) : '-',
                rawDate: moment(att.date).tz(tz).startOf('day').valueOf()
            });
        });

        // Add Leave Data
        leaves.forEach(leave => {
            if (!leave.employee) return;
            // A leave can span multiple days. We need to add a row for each day within the requested range
            let current = moment(leave.startDate).tz(tz).startOf('day');
            const leaveEnd = moment(leave.endDate).tz(tz).endOf('day');
            
            while (current.isSameOrBefore(leaveEnd, 'day')) {
                // Only add if it's within the requested report range
                if (current.isSameOrAfter(start, 'day') && current.isSameOrBefore(end, 'day')) {
                    // Check if there's already an attendance record for this day (e.g. Work From Home)
                    const existingRecord = rows.find(r => r.email === leave.employee.employeeEmail && r.date === current.format('YYYY-MM-DD'));
                    
                    if (existingRecord) {
                        existingRecord.status = `Present (${leave.leaveType})`;
                    } else {
                        rows.push({
                            name: leave.employee.employeeName,
                            email: leave.employee.employeeEmail,
                            date: current.format('YYYY-MM-DD'),
                            status: leave.leaveType, // e.g., 'Sick Leave', 'Vacation Leave'
                            inTime: '-',
                            outTime: '-',
                            hours: '-',
                            rawDate: current.valueOf()
                        });
                    }
                }
                current.add(1, 'day');
            }
        });

        // Sort rows by Date, then Employee Name
        rows.sort((a, b) => {
            if (a.rawDate !== b.rawDate) return a.rawDate - b.rawDate;
            return a.name.localeCompare(b.name);
        });

        // Remove rawDate and add to worksheet
        rows.forEach(r => {
            delete r.rawDate;
            worksheet.addRow(r);
        });

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=Attendance_Report_${start.format('YYYY-MM-DD')}_to_${end.format('YYYY-MM-DD')}.xlsx`
        );

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error generating Excel report:', error);
        res.status(500).json({ message: 'Internal server error.', error: error.message });
    }
});

module.exports = router;
