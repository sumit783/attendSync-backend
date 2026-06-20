const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true }, // Employee receiving the notification
  organization :{type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required:true},
  message: { type: String, required: true }, // Notification content
  type: { type: String, enum: ['Reminder', 'LeaveApproval', 'Absent', 'ClockIn', 'ClockOut','Join'], required: true }, // Type of notification
  createdAt: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false } ,// If the notification has been read
  target: { type: String, enum: ['Employee', 'Organization'], required: true }

});

module.exports = mongoose.model('Notification', notificationSchema);
