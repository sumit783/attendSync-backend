const cron = require('node-cron');
const prisma = require('../prisma/client');

// Run daily at midnight to delete old notifications
cron.schedule('0 0 * * *', async () => {
  try {
    console.log('Checking for old notifications to delete...');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 45); // 1.5 months ≈ 45 days

    const result = await prisma.notification.deleteMany({
        where: {
            createdAt: { lt: cutoffDate }
        }
    });

    console.log(`Deleted ${result.count} old notifications.`);
  } catch (error) {
    console.error('Error while deleting old notifications:', error);
  }
});

const moment = require('moment-timezone');

// Run every 15 minutes to check for auto-logout
cron.schedule('*/15 * * * *', async () => {
  try {
    console.log('Checking for sessions to auto-logout...');
    
    // Find organizations with autoLogout enabled
    const organizations = await prisma.organization.findMany({
      where: { autoLogout: true },
      select: { id: true, inTime: true, outTime: true, organizationCode: true }
    });
    
    if (organizations.length === 0) return;
    
    const orgCodes = organizations.map(o => o.organizationCode);
    
    // Find all unclosed sessions for employees in these organizations
    const openSessions = await prisma.session.findMany({
      where: {
        clockOutTime: null,
        attendance: {
          organizationCode: { in: orgCodes }
        }
      },
      include: {
        attendance: {
          include: {
            employee: {
              include: { shift: true, organization: true }
            }
          }
        }
      }
    });

    const currentMom = moment().tz('Asia/Kolkata');
    const currentDate = currentMom.format('YYYY-MM-DD');
    let autoLogoutCount = 0;

    for (const session of openSessions) {
      const employee = session.attendance.employee;
      const organization = employee.organization;
      if (!organization.autoLogout) continue;

      const inTimeStr = (employee.shift && employee.shift.startTime) ? employee.shift.startTime : organization.inTime;
      const outTimeStr = (employee.shift && employee.shift.endTime) ? employee.shift.endTime : organization.outTime;
      if (!outTimeStr || !inTimeStr) continue;

      const orgInFormat = inTimeStr.includes('AM') || inTimeStr.includes('PM') ? 'hh:mm A' : 'HH:mm';
      const orgOutFormat = outTimeStr.includes('AM') || outTimeStr.includes('PM') ? 'hh:mm A' : 'HH:mm';

      let shiftStart = moment.tz(`${currentDate} ${inTimeStr}`, `YYYY-MM-DD ${orgInFormat}`, 'Asia/Kolkata');
      let shiftEnd = moment.tz(`${currentDate} ${outTimeStr}`, `YYYY-MM-DD ${orgOutFormat}`, 'Asia/Kolkata');

      let isOvernight = false;
      if (shiftEnd.isBefore(shiftStart)) {
          isOvernight = true;
          shiftEnd.add(1, 'day');
      }

      if (isOvernight && currentMom.isBefore(moment.tz(`${currentDate} ${inTimeStr}`, `YYYY-MM-DD ${orgInFormat}`, 'Asia/Kolkata'))) {
          shiftStart.subtract(1, 'day');
          shiftEnd.subtract(1, 'day');
      }

      // If current time is past the shift end time
      if (currentMom.isAfter(shiftEnd)) {
        const organizationOutTime = shiftEnd.utc().toDate();
        const clockInTime = session.clockInTime;
        
        // Calculate duration based on shift end time instead of current time
        const duration = Math.max(0.01, ((organizationOutTime - clockInTime) / (1000 * 60 * 60)).toFixed(2));
        
        await prisma.session.update({
          where: { id: session.id },
          data: {
            clockOutTime: organizationOutTime,
            duration,
            clockOutRemark: 'On Time (Auto)'
          }
        });

        const updatedSessions = await prisma.session.findMany({ where: { attendanceId: session.attendance.id } });
        const totalHours = updatedSessions.reduce((acc, s) => acc + (s.duration || 0), 0);
        
        const expectedDurationMs = shiftEnd.diff(shiftStart);
        const expectedHours = expectedDurationMs > 0 ? expectedDurationMs / (1000 * 60 * 60) : 0;
        let extraHours = 0;
        if (expectedHours > 0 && totalHours > expectedHours) {
            extraHours = parseFloat((totalHours - expectedHours).toFixed(2));
        }

        const halfShiftHours = expectedHours > 0 ? (expectedHours / 2) : 4;

        let finalRemark = 'Present';
        if (totalHours < halfShiftHours) finalRemark = 'Half Day';

        await prisma.attendance.update({
          where: { id: session.attendance.id },
          data: { totalHours, extraHours, finalRemark }
        });
        
        autoLogoutCount++;
      }
    }
    
    if (autoLogoutCount > 0) {
      console.log(`Auto-logged out ${autoLogoutCount} sessions.`);
    }
  } catch (error) {
    console.error('Error during auto-logout cron job:', error);
  }
});

