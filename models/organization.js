const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
    organizationProfilePic: { type: String },
    organizationName: { type: String, required: true },
    organizationEmail: { type: String, unique: true, required: true },
    organizationOwnerName: { type: String, required: true },
    password: { type: String, required: true }, // Store hashed password
    organizationCode: { type: String, unique: true, required: true },
    isVerified: { type: Boolean, default: false },
    otp: { type: String },

    // QR Code Details
    qrCode: { type: String, unique: true, sparse: true },
    qrCodeImage: { type: String },
    qrCodeExpires: { type: Date, index: true }, // Index for quick lookup

    // Timing
    inTime: { type: String }, 
    outTime: { type: String }, 

    // Geolocation
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: undefined ,default: [0, 0]}, // [longitude, latitude]
    },
    radius: { type: Number, default: undefined },

    // Miscellaneous
    scannerCode: { type: String },
    createdAt: { type: Date, default: Date.now },
    workingDays: [{ 
        type: String, 
        enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] 
    }],
    employeeCount: { type: Number, default: 0 },
});

// Geospatial index for location
organizationSchema.index({ location: '2dsphere' });

// Middleware to remove expired QR codes
organizationSchema.pre('save', function (next) {
    if (this.qrCodeExpires && this.qrCodeExpires < new Date()) {
        this.qrCode = undefined;
        this.qrCodeImage = undefined;
        this.qrCodeExpires = undefined;
    }
    next();
});

module.exports = mongoose.model('Organization', organizationSchema);
