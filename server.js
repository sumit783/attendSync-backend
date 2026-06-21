require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('./middleware/mongoSanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const compression = require('compression');
const morgan = require('morgan');
const logger = require('./config/logger');
const errorHandler = require('./middleware/errorHandler');
const path = require('path');
const connectDB = require('./config/db');
const organizationManagement = require('./routes/organizationManagement');
const organizationProfile = require('./routes/organizationProfile');
const organizationAuth = require('./routes/organizationAuth');
const employeeManagement = require('./routes/employeeManagement');
const employeeAuth = require('./routes/employeeAuth');
const leavesRoutes = require('./routes/leaveRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const orgNotificationRoutes = require('./routes/organizationNotification');
const AbsenceMarker = require('./Handlers/AbsenceHandlers');
// Import the cron jobs so they start running
require('./Handlers/cronJobs'); // ✅ This will execute and schedule your cron jobs

process.env.TZ = "Asia/Kolkata";

const app = express();
connectDB();

// Set security HTTP headers
app.use(helmet());

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  // Use combined format in production
  app.use(morgan('combined', {
    stream: { write: message => logger.http(message.trim()) }
  }));
}

// CORS handling
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()) : ['http://localhost:3000', 'http://localhost:8000', 'http://localhost:8081'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o)) || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again in 15 minutes.'
});
// Apply limiter to all requests. We could be more specific (e.g. /api/)
app.use('/api/', limiter);


// Middleware for parsing JSON requests
app.use(express.json({
  limit: '10kb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      return res.status(400).json({ message: 'Invalid JSON input' });
    }
  }
}));

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use(xss());

// Prevent parameter pollution
app.use(hpp());

// Compress responses
app.use(compression());

AbsenceMarker();

// Routes
app.use('/api/organization', organizationAuth);
app.use('/api/organization', organizationProfile);
app.use('/api/organization', organizationManagement);
app.use('/api/employee', employeeManagement);
app.use('/api/employee', employeeAuth);
app.use('/api/leave', leavesRoutes);
app.use('/api/notification', notificationRoutes);
app.use('/api/notification', orgNotificationRoutes);

app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.send('Maybe You are not meant to be here..');
});

// Handle invalid routes (404)
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Global error handling middleware
app.use(errorHandler);

module.exports = app;
