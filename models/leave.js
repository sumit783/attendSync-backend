const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  employeeName: { type: String, required: true }, // Reference to the employee
  organizationCode: { type: String, required: true },
  leaveType: { 
    type: String, 
    enum: ['Sick Leave', 'Vacation Leave', 'Paid Leave', 'Unpaid Leave', 'Work From Home'], // Define valid enum values
    required: true 
  }, // Leave types
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' }, // Approval status
  reason: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Leave', leaveSchema);
