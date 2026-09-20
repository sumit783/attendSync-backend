const express = require('express');
const router = express.Router();
const superAdminController = require('../controllers/superAdminController');

// Middleware to protect super admin routes with the "2492" passcode
const requireSuperAdmin = (req, res, next) => {
    const passcode = req.headers['x-superadmin-key'] || req.query.key;
    if (passcode !== '2492') {
        return res.status(403).send({ message: 'Forbidden. Invalid Super Admin passcode.' });
    }
    next();
};

// #swagger.tags = ['Super Admin']

/**
 * @swagger
 * /api/superadmin/queries:
 *   get:
 *     summary: Get all support queries across all organizations (Super Admin)
 *     tags: [Super Admin]
 *     parameters:
 *       - in: header
 *         name: x-superadmin-key
 *         required: true
 *         schema:
 *           type: string
 *         description: Passcode (e.g. 2492)
 *     responses:
 *       200:
 *         description: List of all queries
 */
router.get('/queries', requireSuperAdmin, superAdminController.getAllQueries);

/**
 * @swagger
 * /api/superadmin/queries/{queryId}/status:
 *   patch:
 *     summary: Update a support query status (Super Admin)
 *     tags: [Super Admin]
 *     parameters:
 *       - in: header
 *         name: x-superadmin-key
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: queryId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PENDING, IN_PROCESS, RESOLVED, CANCELLED]
 *     responses:
 *       200:
 *         description: Status updated successfully
 */
router.patch('/queries/:queryId/status', requireSuperAdmin, superAdminController.updateQueryStatus);

module.exports = router;
