const express = require('express');
const router = express.Router();
const customRoleController = require('../controllers/customRoleController');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const requireOrganizationAccess = require('../middleware/requireOrganizationAccess');

router.use(authenticateAdmin);
router.use(requireOrganizationAccess);

/**
 * @swagger
 * tags:
 *   name: Custom Roles
 *   description: Manage custom roles and permissions for employees
 */

/**
 * @swagger
 * /api/organization/custom-roles:
 *   post:
 *     summary: Create a new custom role
 *     tags: [Custom Roles]
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
 *             properties:
 *               name:
 *                 type: string
 *               attendanceAccess:
 *                 type: boolean
 *               financeAccess:
 *                 type: boolean
 *               leaveAccess:
 *                 type: boolean
 *               announcementAccess:
 *                 type: boolean
 *               designationAndWorkAssignAccess:
 *                 type: boolean
 *               roleCreateAccess:
 *                 type: boolean
 *               shiftAndHolidayAccess:
 *                 type: boolean
 *               reportPageAccess:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Role created successfully
 */
router.post('/', customRoleController.createCustomRole);

/**
 * @swagger
 * /api/organization/custom-roles:
 *   get:
 *     summary: Get all custom roles
 *     tags: [Custom Roles]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of roles
 */
router.get('/', customRoleController.getCustomRoles);

/**
 * @swagger
 * /api/organization/custom-roles/{id}:
 *   put:
 *     summary: Update a custom role
 *     tags: [Custom Roles]
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
 *               attendanceAccess:
 *                 type: boolean
 *               financeAccess:
 *                 type: boolean
 *               leaveAccess:
 *                 type: boolean
 *               announcementAccess:
 *                 type: boolean
 *               designationAndWorkAssignAccess:
 *                 type: boolean
 *               roleCreateAccess:
 *                 type: boolean
 *               shiftAndHolidayAccess:
 *                 type: boolean
 *               reportPageAccess:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Role updated successfully
 */
router.put('/:id', customRoleController.updateCustomRole);

/**
 * @swagger
 * /api/organization/custom-roles/{id}:
 *   delete:
 *     summary: Delete a custom role
 *     tags: [Custom Roles]
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
 *         description: Role deleted successfully
 */
router.delete('/:id', customRoleController.deleteCustomRole);

/**
 * @swagger
 * /api/organization/custom-roles/assign-to-employee/{employeeId}:
 *   post:
 *     summary: Assign a custom role to an employee
 *     tags: [Custom Roles]
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
 *               customRoleId:
 *                 type: string
 *                 description: ID of the CustomRole to assign (null to remove)
 *     responses:
 *       200:
 *         description: Role assigned successfully
 */
router.post('/assign-to-employee/:employeeId', customRoleController.assignRoleToEmployee);

module.exports = router;
