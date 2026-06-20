const mongoose = require('mongoose');
const moment = require('moment-timezone');

const sessionSchema = new mongoose.Schema({
  clockInTime: { type: Date, required: true },
  clockOutTime: { type: Date,default:null },
  duration: { type: Number, default: 0 },
  clockInRemark: { type: String },
  clockOutRemark: { type: String },
});

const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  employeeName: { type: String, required: true },
  organizationCode: { type: String, required: true },
  date: { type: Date, required: true },
  scannerCode: { type: String, required: true },
  sessions: [sessionSchema],
  totalHours: { type: Number, default: 0 },
  finalRemark: { type: String, default: 'Absent' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// 🔹 Calculate total hours and determine final remark
attendanceSchema.methods.calculateTotalHoursAndRemark = function (organizationInTime, organizationOutTime) {
  this.totalHours = this.sessions.reduce((sum, session) => sum + (parseFloat(session.duration) || 0), 0);

  const lastSession = this.sessions[this.sessions.length - 1];

  if (lastSession && lastSession.clockOutTime) {
    lastSession.clockOutRemark = moment(lastSession.clockOutTime).isBefore(organizationOutTime) ? 'Left Early' : 'Present';
  }

  if (this.totalHours === 0) {
    this.finalRemark = 'Absent';
  } else if (this.totalHours < 4) {
    this.finalRemark = 'Half Day';
  } else if (moment(lastSession.clockOutTime).isBefore(organizationOutTime)) {
    this.finalRemark = 'Left Early';
  } else {
    this.finalRemark = 'Present';
  }
};

module.exports = mongoose.model('Attendance', attendanceSchema);
