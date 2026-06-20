const express = require('express');
const jwt = require('jsonwebtoken');
const Notification = require('../models/notification');
const authenticateJWT = require('../middleware/authenticateJWT');
const router = express.Router();

// ================== Fetch Employee Notifications ==================
router.get('/employee/notifications', authenticateJWT, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const employeeId = decoded.id;

        const notifications = await Notification.find({
            user: employeeId,
            target: 'Employee', // ✅ Ensures it's meant for the employee
            isRead: false
        })
        .sort({ createdAt: -1 });

        res.status(200).send({ notifications });
    } catch (error) {
        console.error('Error in /employee/notifications:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});


// ================== Mark Notification as Read ==================
router.post('/employee/notifications/read', authenticateJWT, async (req, res) => {
    const { notificationId } = req.body;

    try {
        const notification = await Notification.findById(notificationId);
        if (!notification) {
            return res.status(404).send({ message: 'Notification not found' });
        }

        notification.isRead = true;
        await notification.save();

        res.status(200).send({ message: 'Notification marked as read' });
    } catch (error) {
        console.error('Error in /employee/notifications/read:', error);
        res.status(500).send({ message: 'Server error', error: error.message }); 
    }
});

module.exports = router;