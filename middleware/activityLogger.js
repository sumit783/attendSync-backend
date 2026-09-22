const jwt = require('jsonwebtoken');
const activityLoggerService = require('../services/activityLoggerService');

const MODIFIABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const activityLoggerMiddleware = (req, res, next) => {
    // Only capture modifying methods (POST, PUT, PATCH, DELETE)
    if (!MODIFIABLE_METHODS.has(req.method)) {
        return next();
    }

    // Skip static assets or documentation endpoints
    const url = req.originalUrl || req.url;
    if (url.startsWith('/api/uploads') || url.startsWith('/swagger') || url.startsWith('/api-docs')) {
        return next();
    }

    const startTime = Date.now();
    const reqBodyCopy = req.body;

    // Listen for response completion
    res.on('finish', () => {
        try {
            const responseTimeMs = Date.now() - startTime;
            
            // Extract user from token if available
            let userId = req.user?.id || req.adminId || null;
            let userEmail = req.user?.email || req.user?.employeeEmail || null;
            let userName = req.user?.name || req.user?.employeeName || req.user?.organizationOwnerName || null;
            let role = req.user?.role || null;
            let organizationCode = req.organizationCode || req.user?.organizationCode || null;
            let organizationId = req.organizationId || req.user?.organizationId || null;

            if (!userId && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
                try {
                    const token = req.headers.authorization.split(' ')[1];
                    const decoded = jwt.decode(token);
                    if (decoded) {
                        userId = userId || decoded.id;
                        userEmail = userEmail || decoded.email || decoded.employeeEmail;
                        userName = userName || decoded.name || decoded.employeeName || decoded.organizationOwnerName;
                        role = role || decoded.role;
                        organizationCode = organizationCode || decoded.organizationCode;
                        organizationId = organizationId || decoded.organizationId;
                    }
                } catch (e) {
                    // Ignore token decode error
                }
            }

            if (req.headers['x-superadmin-key'] === '2492') {
                role = role || 'SUPER_ADMIN';
            }

            if (!organizationId && req.headers['x-organization-id']) {
                organizationId = req.headers['x-organization-id'];
            }

            const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || req.ip || null;
            const userAgent = req.headers['user-agent'] || null;

            activityLoggerService.logActivity({
                method: req.method,
                url: url,
                route: req.baseUrl ? `${req.baseUrl}${req.path}` : req.path,
                statusCode: res.statusCode,
                ipAddress,
                userAgent,
                userId,
                userName,
                userEmail,
                role,
                organizationCode,
                organizationId,
                requestBody: reqBodyCopy,
                responseTimeMs
            });
        } catch (err) {
            console.error('Error in activityLoggerMiddleware finish event:', err.message);
        }
    });

    next();
};

module.exports = activityLoggerMiddleware;
