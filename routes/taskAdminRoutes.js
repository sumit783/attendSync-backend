const express = require('express');
const router = express.Router();
const taskAdminController = require('../controllers/taskAdminController');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const requireOrganizationAccess = require('../middleware/requireOrganizationAccess');

// All routes require an admin and organization context
router.use(authenticateAdmin);
router.use(requireOrganizationAccess);

/**
 * @swagger
 * tags:
 *   name: Admin Tasks
 *   description: Task management for Admins
 */

/**
 * @swagger
 * /api/organization/tasks:
 *   post:
 *     summary: Create a new task and assign to employee
 *     tags: [Admin Tasks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - employeeId
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               employeeId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Task created successfully
 */
router.post('/', taskAdminController.createTask);

/**
 * @swagger
 * /api/organization/tasks:
 *   get:
 *     summary: Get all tasks in the organization
 *     tags: [Admin Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema:
 *           type: string
 *         description: Filter by employee ID
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
router.get('/', taskAdminController.getTasks);

/**
 * @swagger
 * /api/organization/tasks/{id}:
 *   put:
 *     summary: Update a task
 *     tags: [Admin Tasks]
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
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [PENDING, IN_PROGRESS, COMPLETED]
 *               employeeId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Task updated successfully
 */
router.put('/:id', taskAdminController.updateTask);

/**
 * @swagger
 * /api/organization/tasks/{id}:
 *   delete:
 *     summary: Delete a task
 *     tags: [Admin Tasks]
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
 *         description: Task deleted successfully
 */
router.delete('/:id', taskAdminController.deleteTask);

module.exports = router;
