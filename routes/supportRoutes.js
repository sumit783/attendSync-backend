const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const requireOrganizationAccess = require('../middleware/requireOrganizationAccess');

// #swagger.tags = ['Support']

/**
 * @swagger
 * /api/organization/support:
 *   post:
 *     summary: Create a support query (Organization Admin)
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *               attachment:
 *                 type: string
 *                 description: Base64 encoded image or video
 *     responses:
 *       201:
 *         description: Support query created successfully
 */
router.post('/support', authenticateAdmin, requireOrganizationAccess, supportController.createSupportQuery);

/**
 * @swagger
 * /api/organization/support:
 *   get:
 *     summary: Get all queries for the organization
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search queries by message
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter queries by status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: List of queries with pagination
 */
router.get('/support', authenticateAdmin, requireOrganizationAccess, supportController.getMyQueries);

/**
 * @swagger
 * /api/organization/support/{queryId}:
 *   put:
 *     summary: Edit a pending support query
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: queryId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *               attachment:
 *                 type: string
 *     responses:
 *       200:
 *         description: Query updated successfully
 */
router.put('/support/:queryId', authenticateAdmin, requireOrganizationAccess, supportController.updateQuery);

/**
 * @swagger
 * /api/organization/support/{queryId}/cancel:
 *   patch:
 *     summary: Cancel a pending support query
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: queryId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Query cancelled successfully
 */
router.patch('/support/:queryId/cancel', authenticateAdmin, requireOrganizationAccess, supportController.cancelQuery);

module.exports = router;
