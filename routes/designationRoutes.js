const express = require('express');
const router = express.Router();
const designationController = require('../controllers/designationController');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const requireOrganizationAccess = require('../middleware/requireOrganizationAccess');

// All routes require an admin and organization context
router.use(authenticateAdmin);
router.use(requireOrganizationAccess);

/**
 * @swagger
 * tags:
 *   name: Designations
 *   description: Designation management
 */

/**
 * @swagger
 * /api/designations:
 *   post:
 *     summary: Create a new designation
 *     tags: [Designations]
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
 *               - departmentId
 *             properties:
 *               name:
 *                 type: string
 *               departmentId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Designation created successfully
 */
router.post('/', designationController.createDesignation);

/**
 * @swagger
 * /api/designations:
 *   get:
 *     summary: Get all designations in the organization
 *     tags: [Designations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: departmentId
 *         schema:
 *           type: string
 *         description: Filter by department ID
 *     responses:
 *       200:
 *         description: List of designations
 */
router.get('/', designationController.getDesignations);

/**
 * @swagger
 * /api/designations/{id}:
 *   put:
 *     summary: Update a designation
 *     tags: [Designations]
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
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               departmentId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Designation updated successfully
 */
router.put('/:id', designationController.updateDesignation);

/**
 * @swagger
 * /api/designations/{id}:
 *   delete:
 *     summary: Delete a designation
 *     tags: [Designations]
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
 *         description: Designation deleted successfully
 *       400:
 *         description: Cannot delete designation because it is assigned to employees
 */
router.delete('/:id', designationController.deleteDesignation);

/**
 * @swagger
 * /api/designations/assign-to-employee/{employeeId}:
 *   post:
 *     summary: Assign designations to an employee
 *     tags: [Designations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
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
 *               designationIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of designation IDs to assign
 *     responses:
 *       200:
 *         description: Designations assigned successfully
 *       404:
 *         description: Employee or one of the designations not found
 *       500:
 *         description: Internal server error
 */
router.post('/assign-to-employee/:employeeId', designationController.assignDesignationToEmployee);


module.exports = router;

