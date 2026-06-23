const express = require('express');
const router = express.Router();
const {createSchedule,getSchedules,updateSchedule,deleteSchedule,assignScheduleToEmployee} = require('../controllers/scheduleController');
const authenticateJWT = require('../middleware/authenticateJWT');

// Apply authentication middleware to all schedule routes
router.use(authenticateJWT);

router.post('/',createSchedule);
router.get('/',getSchedules);
router.put('/:scheduleId',updateSchedule);
router.delete('/:scheduleId',deleteSchedule);
router.post('/assign',assignScheduleToEmployee);

module.exports = router;
