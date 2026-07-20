const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true }, 
    employeeName: { type: String, required: true },
    employeeEmail: { type: String, unique: true, required: true },
    password: { type: String, required: true }, // Store hashed password
    profilePic: { type: String },
    organizationCode: { type: String },
    role: { type: String, enum: ['Employee', 'Manager', 'Admin'], default: 'Employee' },
    isVerified: { type: Boolean, default: false },
    otp: { type: String },
    otpExpires: { type: Date },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    lastLogin: { type: Date }, // Added field
    attendanceRecords: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Attendance' }], // Attendance tracking
  });
  
  module.exports = mongoose.model('Employee', employeeSchema);
  