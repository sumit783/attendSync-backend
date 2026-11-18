const cron = require('node-cron');
const prisma = require('../prisma/client');
const moment = require('moment-timezone');
const crypto = require('crypto');

function parseMomTime(dateStr, timeStr) {
  if (!timeStr) return null;
  const formats = [
    'YYYY-MM-DD hh:mm A',
    'YYYY-MM-DD h:mm A',
    'YYYY-MM-DD HH:mm',
    'YYYY-MM-DD H:mm',
    'YYYY-MM-DD hh:mm:ss A',
    'YYYY-MM-DD HH:mm:ss'
  ];
  return moment.tz(dateStr + ' ' + timeStr, formats, 'Asia/Kolkata');
}

/**
 * Generates a deterministic pseudo-random offset in seconds for an employee on a given date.
 * Using employeeId + date ensures:
 * 1. The time is different for each employee.
 * 2. The time is different each day.
 * 3. The time remains stable across repeated cron checks on the same day.
 *
 * @param {string} seedString - Unique seed (e.g. employeeId + '_' + dateStr + '_login')
 * @param {number} minMinutes - Minimum offset in minutes (default: 5)
 * @param {number} maxMinutes - Maximum offset in minutes (default: 18)
 * @returns {number} Offset in seconds (between minMinutes*60 and maxMinutes*60)
 */
function getShuffledOffsetSeconds(seedString, minMinutes = 5, maxMinutes = 18) {
  const hash = crypto.createHash('md5').update(seedString).digest('hex');
  const num = parseInt(hash.substring(0, 8), 16);
  const minSec = minMinutes * 60;
  const maxSec = maxMinutes * 60;
  return minSec + (num % (maxSec - minSec + 1));
}

async function processAutoAttendance() {
  try {
    const currentMom = moment().tz('Asia/Kolkata');
    const todayDateStr = currentMom.format('YYYY-MM-DD');

    const autoEmployees = await prisma.employee.findMany({
      where: {
        autoAttendance: true,
        status: 'active'
      },
      include: {
        shift: true,
        organization: true
      }
    });

    if (autoEmployees.length === 0) return { loginCount: 0, logoutCount: 0 };

    let loginCount = 0;
    let logoutCount = 0;

    for (const employee of autoEmployees) {
      const organization = employee.organization;
      if (!organization) continue;

      const inTimeStr = employee.autoLoginTime || employee.shift?.startTime || organization.inTime || '10:00 AM';
      const outTimeStr = employee.autoLogoutTime || employee.shift?.endTime || organization.outTime || '01:00 AM';

      let shiftStartToday = parseMomTime(todayDateStr, inTimeStr);
      let shiftEndToday = parseMomTime(todayDateStr, outTimeStr);

      if (!shiftStartToday || !shiftEndToday) continue;

      const isOvernight = employee.autoLogoutNextDay || shiftEndToday.isSameOrBefore(shiftStartToday);
      if (isOvernight) {
        shiftEndToday.add(1, 'day');
      }

      // Shuffled Login: 5 to 18 minutes earlier than shiftStartToday (e.g., 9:50, 9:45, 9:43 for 10:00 AM)
      const loginOffsetSec = getShuffledOffsetSeconds(`${employee.id}_${todayDateStr}_login`, 5, 18);
      let shuffledLoginTime = shiftStartToday.clone().subtract(loginOffsetSec, 'seconds');
      // Prevent rolling into previous calendar day if shift starts near midnight
      if (!shuffledLoginTime.isSame(shiftStartToday, 'day')) {
        shuffledLoginTime = shiftStartToday.clone().startOf('day');
      }

      // Shuffled Logout for today's shift window: 5 to 18 minutes after shiftEndToday
      const logoutOffsetSec = getShuffledOffsetSeconds(`${employee.id}_${todayDateStr}_logout`, 5, 18);
      const shuffledLogoutTime = shiftEndToday.clone().add(logoutOffsetSec, 'seconds');

      // 1. AUTO LOGIN CHECK (For Today's shift window):
      if (currentMom.isSameOrAfter(shuffledLoginTime) && currentMom.isBefore(shuffledLogoutTime)) {
        const startOfDay = moment.tz(todayDateStr + ' 00:00:00', 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata').utc().toDate();
        const endOfDay = moment.tz(todayDateStr + ' 23:59:59', 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata').utc().toDate();

        const existingAttendance = await prisma.attendance.findFirst({
          where: {
            employeeId: employee.id,
            date: { gte: startOfDay, lte: endOfDay }
          },
          include: { sessions: true }
        });

        if (!existingAttendance) {
          const loginTimeDate = shuffledLoginTime.utc().toDate();
          await prisma.attendance.create({
            data: {
              employeeId: employee.id,
              employeeName: employee.employeeName,
              organizationCode: employee.organizationCode || organization.organizationCode,
              date: startOfDay,
              finalRemark: 'Clocked In',
              totalHours: 0,
              extraHours: 0,
              sessions: {
                create: {
                  clockInTime: loginTimeDate,
                  clockInRemark: 'On Time (Auto)'
                }
              }
            }
          });
          loginCount++;
          console.log(`[AutoAttendance] Auto-logged in employee ${employee.employeeName} at ${shuffledLoginTime.format('hh:mm:ss A')} (scheduled: ${inTimeStr}) for ${todayDateStr}`);
        }
      }

      // 2. AUTO LOGOUT CHECK:
      const openSessions = await prisma.session.findMany({
        where: {
          clockOutTime: null,
          attendance: {
            employeeId: employee.id
          }
        },
        include: {
          attendance: true
        }
      });

      for (const session of openSessions) {
        const attDateMom = moment(session.attendance.date).tz('Asia/Kolkata');
        const attDateStr = attDateMom.format('YYYY-MM-DD');

        let sessionShiftStart = parseMomTime(attDateStr, inTimeStr);
        let sessionShiftEnd = parseMomTime(attDateStr, outTimeStr);

        if (!sessionShiftStart || !sessionShiftEnd) continue;

        if (isOvernight) {
          sessionShiftEnd.add(1, 'day');
        }

        // Shuffled Logout: 5 to 18 minutes after sessionShiftEnd (e.g., 7:05, 7:12, 7:17 for 7:00 PM)
        const sessionLogoutOffsetSec = getShuffledOffsetSeconds(`${employee.id}_${attDateStr}_logout`, 5, 18);
        const shuffledSessionLogout = sessionShiftEnd.clone().add(sessionLogoutOffsetSec, 'seconds');

        if (currentMom.isSameOrAfter(shuffledSessionLogout)) {
          const scheduledOutDate = shuffledSessionLogout.utc().toDate();
          const clockInTime = new Date(session.clockInTime);
          const duration = Math.max(0.01, parseFloat(((scheduledOutDate - clockInTime) / (1000 * 60 * 60)).toFixed(2)));

          await prisma.session.update({
            where: { id: session.id },
            data: {
              clockOutTime: scheduledOutDate,
              duration,
              clockOutRemark: 'On Time (Auto)'
            }
          });

          const updatedSessions = await prisma.session.findMany({ where: { attendanceId: session.attendance.id } });
          const totalHours = parseFloat(updatedSessions.reduce((acc, s) => acc + (s.duration || 0), 0).toFixed(2));

          const expectedDurationMs = sessionShiftEnd.diff(sessionShiftStart);
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

          logoutCount++;
          console.log(`[AutoAttendance] Auto-logged out employee ${employee.employeeName} at ${shuffledSessionLogout.format('hh:mm:ss A')} (scheduled: ${outTimeStr})`);
        }
      }
    }

    if (loginCount > 0 || logoutCount > 0) {
      console.log('[AutoAttendance] Auto attendance processed: ' + loginCount + ' logins, ' + logoutCount + ' logouts.');
    }
    return { loginCount, logoutCount };
  } catch (error) {
    console.error('Error in processAutoAttendance:', error);
  }
}

// Delete old notifications daily
cron.schedule('0 0 * * *', async () => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 45);
    const result = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoffDate } } });
    console.log('Deleted old notifications: ' + result.count);
  } catch (err) {
    console.error('Error deleting old notifications:', err);
  }
});

// Run every 2 minutes for employee auto-attendance (Auto Login + Auto Logout)
cron.schedule('*/2 * * * *', async () => {
  try {
    await processAutoAttendance();
  } catch (error) {
    console.error('Error during auto-attendance cron job:', error);
  }
});

// Organization-level auto-logout
cron.schedule('*/15 * * * *', async () => {
  try {
    const organizations = await prisma.organization.findMany({
      where: { autoLogout: true },
      select: { id: true, inTime: true, outTime: true, organizationCode: true }
    });
    if (organizations.length === 0) return;
    const orgCodes = organizations.map(o => o.organizationCode);
    const openSessions = await prisma.session.findMany({
      where: { clockOutTime: null, attendance: { organizationCode: { in: orgCodes } } },
      include: { attendance: { include: { employee: { include: { shift: true, organization: true } } } } }
    });
    const currentMom = moment().tz('Asia/Kolkata');
    for (const session of openSessions) {
      const employee = session.attendance.employee;
      const organization = employee.organization;
      if (!organization.autoLogout) continue;
      const inTimeStr = (employee.shift && employee.shift.startTime) ? employee.shift.startTime : organization.inTime;
      const outTimeStr = (employee.shift && employee.shift.endTime) ? employee.shift.endTime : organization.outTime;
      if (!outTimeStr || !inTimeStr) continue;

      const attDateMom = moment(session.attendance.date).tz('Asia/Kolkata');
      const attDateStr = attDateMom.format('YYYY-MM-DD');

      let sessionShiftStart = parseMomTime(attDateStr, inTimeStr);
      let sessionShiftEnd = parseMomTime(attDateStr, outTimeStr);
      if (!sessionShiftStart || !sessionShiftEnd) continue;

      let isOvernight = sessionShiftEnd.isSameOrBefore(sessionShiftStart);
      if (isOvernight) {
        sessionShiftEnd.add(1, 'day');
      }

      const logoutOffsetSec = getShuffledOffsetSeconds(`${employee.id}_${attDateStr}_org_logout`, 5, 18);
      const shuffledShiftEnd = sessionShiftEnd.clone().add(logoutOffsetSec, 'seconds');

      if (currentMom.isSameOrAfter(shuffledShiftEnd)) {
        const organizationOutTime = shuffledShiftEnd.utc().toDate();
        const clockInTime = session.clockInTime;
        const duration = Math.max(0.01, parseFloat(((organizationOutTime - clockInTime) / (1000 * 60 * 60)).toFixed(2)));
        await prisma.session.update({ where: { id: session.id }, data: { clockOutTime: organizationOutTime, duration, clockOutRemark: 'On Time (Auto)' } });
        const updatedSessions = await prisma.session.findMany({ where: { attendanceId: session.attendance.id } });
        const totalHours = parseFloat(updatedSessions.reduce((acc, s) => acc + (s.duration || 0), 0).toFixed(2));
        const expectedDurationMs = sessionShiftEnd.diff(sessionShiftStart);
        const expectedHours = expectedDurationMs > 0 ? expectedDurationMs / (1000 * 60 * 60) : 0;
        let extraHours = 0;
        if (expectedHours > 0 && totalHours > expectedHours) extraHours = parseFloat((totalHours - expectedHours).toFixed(2));
        const halfShiftHours = expectedHours > 0 ? (expectedHours / 2) : 4;
        let finalRemark = totalHours < halfShiftHours ? 'Half Day' : 'Present';
        await prisma.attendance.update({ where: { id: session.attendance.id }, data: { totalHours, extraHours, finalRemark } });
      }
    }
  } catch (err) {
    console.error('Error in org auto-logout:', err);
  }
});

module.exports = { processAutoAttendance };