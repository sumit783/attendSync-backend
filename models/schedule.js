const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    organizationCode: { type: String, required: true },
    name: { type: String, required: true },
    inTime: { type: String, required: true },
    outTime: { type: String, required: true },
    workingDays: [{ 
        type: String, 
        enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] 
    }],
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Schedule', scheduleSchema);
