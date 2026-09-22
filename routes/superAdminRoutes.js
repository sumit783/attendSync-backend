const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');
const superAdminController = require('../controllers/superAdminController');
const activityLogController = require('../controllers/activityLogController');

// Middleware to protect super admin routes with the "2492" passcode or SUPER_ADMIN JWT
const requireSuperAdmin = async (req, res, next) => {
    const passcode = req.headers['x-superadmin-key'] || req.query.key;
    if (passcode === '2492') {
        return next();
    }

    // Check JWT Bearer Token if present
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded) {
                const normRole = (decoded.role || '').toUpperCase();
                if (normRole === 'SUPER_ADMIN' || normRole === 'SUPERADMIN' || decoded.organizationCode === '2492') {
                    req.user = decoded;
                    return next();
                }

                // Check Admin table in Prisma
                if (decoded.id) {
                    const admin = await prisma.admin.findUnique({
                        where: { id: decoded.id },
                        include: { roles: true }
                    });
                    if (admin && admin.roles && admin.roles.some(r => r.role === 'SUPER_ADMIN')) {
                        req.user = decoded;
                        req.adminId = admin.id;
                        req.adminRoles = admin.roles;
                        return next();
                    }
                }
            }
        } catch (e) {
            // Token invalid
        }
    }

    return res.status(403).send({ message: 'Forbidden. Super Admin access required.' });
};

// #swagger.tags = ['Super Admin']

/**
 * @swagger
 * /api/superadmin/queries:
 *   get:
 *     summary: Get all support queries across all organizations (Super Admin)
 *     tags: [Super Admin]
 */
router.get('/queries', requireSuperAdmin, superAdminController.getAllQueries);

/**
 * @swagger
 * /api/superadmin/queries/{queryId}/status:
 *   patch:
 *     summary: Update a support query status (Super Admin)
 *     tags: [Super Admin]
 */
router.patch('/queries/:queryId/status', requireSuperAdmin, superAdminController.updateQueryStatus);

/**
 * @swagger
 * /api/superadmin/activity-logs:
 *   get:
 *     summary: Get saved POST/PUT/PATCH/DELETE activity logs (Super Admin)
 *     tags: [Super Admin]
 */
router.get('/activity-logs', requireSuperAdmin, activityLogController.getActivityLogs);

/**
 * @swagger
 * /api/superadmin/activity-logs/clear:
 *   delete:
 *     summary: Clear activity logs (Super Admin)
 *     tags: [Super Admin]
 */
router.delete('/activity-logs/clear', requireSuperAdmin, activityLogController.clearActivityLogs);

module.exports = router;

