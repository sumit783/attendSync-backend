const express = require('express');
const router = express.Router();
const holidayController = require('../controllers/holidayController');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const requireOrganizationAccess = require('../middleware/requireOrganizationAccess');

router.use(authenticateAdmin);
router.use(requireOrganizationAccess);

/**
 * @swagger
 * tags:
 *   name: Holidays
 *   description: Holiday management for the organization
 */

/**
 * @swagger
 * /api/organization/holidays:
 *   post:
 *     summary: Create a new holiday
 *     tags: [Holidays]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - startDate
 *               - endDate
 *             properties:
 *               name:
 *                 type: string
 *               startDate:
 *                 type: string
 *                 format: date-time
 *               endDate:
 *                 type: string
 *                 format: date-time
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Holiday created successfully
 */
router.post('/', holidayController.createHoliday);

/**
 * @swagger
 * /api/organization/holidays:
 *   get:
 *     summary: Get all holidays
 *     tags: [Holidays]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of holidays
 */
router.get('/', holidayController.getHolidays);

/**
 * @swagger
 * /api/organization/holidays/{id}:
 *   put:
 *     summary: Update a holiday
 *     tags: [Holidays]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               startDate:
 *                 type: string
 *                 format: date-time
 *               endDate:
 *                 type: string
 *                 format: date-time
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Holiday updated successfully
 */
router.put('/:id', holidayController.updateHoliday);

/**
 * @swagger
 * /api/organization/holidays/{id}:
 *   delete:
 *     summary: Delete a holiday
 *     tags: [Holidays]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Holiday deleted successfully
 */
router.delete('/:id', holidayController.deleteHoliday);

module.exports = router;
