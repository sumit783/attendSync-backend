const express = require('express');
const router = express.Router();
const authenticateAdmin = require('../middleware/authenticateAdmin');
const requireOrganizationAccess = require('../middleware/requireOrganizationAccess');
const dashboardController = require('../controllers/dashboardController');

router.use(authenticateAdmin);
router.use(requireOrganizationAccess);

// Dashboard routes
router.get('/stats', dashboardController.getOverviewStats);
router.get('/payroll', dashboardController.getPayrollDistribution);
router.get('/expenses', dashboardController.getExpenseDistribution);

module.exports = router;
