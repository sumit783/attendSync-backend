const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');
const authenticateJWT = require('../middleware/authenticateJWT');
const router = express.Router();

// ================== Fetch Employee Notifications ==================
router.get('/employee/notifications', authenticateJWT, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const employeeId = decoded.id;

        const notifications = await prisma.notification.findMany({
            where: {
                userId: employeeId,
                target: 'Employee',
                isRead: false
            },
            orderBy: { createdAt: 'desc' }
        });

        // Mark the fetched notifications as read
        if (notifications.length > 0) {
            const notificationIds = notifications.map(n => n.id);
            await prisma.notification.updateMany({
                where: { id: { in: notificationIds } },
                data: { isRead: true }
            });
        }

        res.status(200).send({ notifications });
    } catch (error) {
        console.error('Error in /employee/notifications:', error);
        res.status(500).send({ message: 'Server error', error: error.message });
    }
});

// ================== Mark Notification as Read ==================
router.post('/employee/notifications/read', authenticateJWT, async (req, res) => {
    const { notificationId, notificationIds } = req.body;

    try {
        const ids = notificationIds || (notificationId ? [notificationId] : []);
        
        if (ids.length === 0) {
            return res.status(400).send({ message: 'No notification IDs provided' });
        }

        await prisma.notification.updateMany({
            where: { id: { in: ids } },
            data: { isRead: true }
        });

        res.status(200).send({ message: 'Notifications marked as read' });
    } catch (error) {
        console.error('Error in /employee/notifications/read:', error);
        res.status(500).send({ message: 'Server error', error: error.message }); 
    }
});

module.exports = router;