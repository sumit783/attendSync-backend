const express = require('express');
const router = express.Router();
const taskEmployeeController = require('../controllers/taskEmployeeController');
const authenticateJWT = require('../middleware/authenticateJWT');

// All routes require an authenticated employee
router.use(authenticateJWT);

/**
 * @swagger
 * tags:
 *   name: Employee Tasks
 *   description: Task management for Employees
 */

/**
 * @swagger
 * /api/employee/tasks:
 *   get:
 *     summary: Get all tasks assigned to the employee
 *     tags: [Employee Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, IN_PROGRESS, COMPLETED]
 *         description: Filter by task status
 *     responses:
 *       200:
 *         description: List of tasks
 */
router.get('/', taskEmployeeController.getMyTasks);

/**
 * @swagger
 * /api/employee/tasks/{id}/status:
 *   patch:
 *     summary: Update the status of a task
 *     tags: [Employee Tasks]
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
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PENDING, IN_PROGRESS, COMPLETED]
 *     responses:
 *       200:
 *         description: Task status updated successfully
 */
router.patch('/:id/status', taskEmployeeController.updateTaskStatus);

module.exports = router;
