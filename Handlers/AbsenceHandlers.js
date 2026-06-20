const schedule = require('node-schedule');
const Employee = require('../models/employee');
const Attendance = require('../models/attendance');
const moment = require('moment-timezone');

function AbsenceMarker() {
  schedule.scheduleJob('59 23 * * *', async () => {
    try {
      const currentDate = moment().startOf('day').toDate();
      const currentDateStr = moment(currentDate).format('YYYY-MM-DD');

      const employees = await Employee.find();

      for (const employee of employees) {
        const attendance = await Attendance.findOne({
          employee: employee._id,
          date: currentDate,
        });

        if (!attendance) {
          // No attendance => mark Absent
          const absentRecord = new Attendance({
            employee: employee._id,
            employeeName: employee.employeeName,
            organizationCode: employee.organizationCode,
            date: currentDate,
            sessions: [],
            totalHours: 0,
            finalRemark: 'Absent',
          });
          await absentRecord.save();
          console.log(`🔴 ${employee.employeeName} marked Absent (${currentDateStr}) — No attendance found`);
        } else {
          // Attendance exists, check if all sessions are missing clockOutTime
          const hasAnyClockOut = attendance.sessions.some(
            (s) => s.clockOutTime !== null && s.clockOutTime !== undefined
          );

          if (!hasAnyClockOut) {
            // No sessions have clockOut → treat as absent
            attendance.sessions = [];
            attendance.totalHours = 0;
            attendance.finalRemark = 'Absent';
            attendance.updatedAt = new Date();

            await attendance.save();
            console.log(`🟠 ${employee.employeeName} marked Absent (${currentDateStr}) — No clockOut in sessions`);
          } else {
            console.log(`✅ ${employee.employeeName} has clockOut(s) — no action taken`);
          }
        }
      }
    } catch (err) {
      console.error('❌ Error in AbsenceMarker job:', err);
    }
  });
}

module.exports = AbsenceMarker;