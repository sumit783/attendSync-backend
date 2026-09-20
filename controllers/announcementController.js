const prisma = require('../prisma/client');

exports.createAnnouncement = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { title, message, canReply, targetAll, employeeIds } = req.body;

        if (!message) {
            return res.status(400).send({ message: 'Announcement message is required.' });
        }

        const organization = await prisma.organization.findUnique({
            where: { id: organizationId }
        });

        if (!organization) {
            return res.status(404).send({ message: 'Organization not found.' });
        }

        const isTargetAll = targetAll !== false; // Default to true

        // Create the announcement
        const announcement = await prisma.announcement.create({
            data: {
                organizationId,
                title,
                message,
                canReply: canReply || false,
                targetAll: isTargetAll
            }
        });

        let targetedEmployees = [];

        if (isTargetAll) {
            // Fetch all active employees
            targetedEmployees = await prisma.employee.findMany({
                where: { organizationId, status: 'active' },
                select: { id: true }
            });
        } else if (employeeIds && employeeIds.length > 0) {
            // Fetch specific employees
            targetedEmployees = await prisma.employee.findMany({
                where: { id: { in: employeeIds }, organizationId, status: 'active' },
                select: { id: true }
            });

            // Create target relationships
            if (targetedEmployees.length > 0) {
                await prisma.employeeAnnouncement.createMany({
                    data: targetedEmployees.map(emp => ({
                        announcementId: announcement.id,
                        employeeId: emp.id
                    }))
                });
            }
        }

        // Create notifications for targeted employees
        if (targetedEmployees.length > 0) {
            const notificationsData = targetedEmployees.map(emp => ({
                userId: emp.id,
                organizationId,
                message: title ? `Announcement: ${title}` : 'New Announcement',
                type: 'Announcement',
                target: 'Employee',
                announcementId: announcement.id
            }));

            await prisma.notification.createMany({
                data: notificationsData
            });
        }

        res.status(201).send({ message: 'Announcement created successfully.', announcement });
    } catch (error) {
        console.error('Error creating announcement:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.getAnnouncements = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const date = req.query.date; // format YYYY-MM-DD
        const skip = (page - 1) * limit;

        const whereClause = { organizationId };

        if (search) {
            whereClause.OR = [
                { title: { contains: search } },
                { message: { contains: search } }
            ];
        }

        if (date) {
            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);
            
            whereClause.createdAt = {
                gte: startDate,
                lte: endDate
            };
        }

        const announcements = await prisma.announcement.findMany({
            where: whereClause,
            include: {
                _count: {
                    select: { replies: true }
                },
                targetedEmployees: {
                    include: {
                        employee: {
                            select: { id: true, employeeName: true }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit
        });

        const totalAnnouncements = await prisma.announcement.count({ where: whereClause });

        res.status(200).send({
            announcements,
            page,
            totalPages: Math.ceil(totalAnnouncements / limit),
            totalAnnouncements
        });
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.updateAnnouncement = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;
        const { title, message, canReply } = req.body;

        const announcement = await prisma.announcement.findFirst({
            where: { id, organizationId }
        });

        if (!announcement) {
            return res.status(404).send({ message: 'Announcement not found.' });
        }

        const updatedAnnouncement = await prisma.announcement.update({
            where: { id },
            data: {
                ...(title !== undefined && { title }),
                ...(message !== undefined && { message }),
                ...(canReply !== undefined && { canReply })
            }
        });

        // Update existing notifications related to this announcement
        if (title !== undefined) {
            await prisma.notification.updateMany({
                where: { announcementId: id },
                data: { message: title ? `Announcement: ${title}` : 'Updated Announcement' }
            });
        }

        res.status(200).send({ message: 'Announcement updated successfully.', announcement: updatedAnnouncement });
    } catch (error) {
        console.error('Error updating announcement:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.deleteAnnouncement = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;

        const announcement = await prisma.announcement.findFirst({
            where: { id, organizationId }
        });

        if (!announcement) {
            return res.status(404).send({ message: 'Announcement not found.' });
        }

        await prisma.announcement.delete({
            where: { id }
        });

        res.status(200).send({ message: 'Announcement deleted successfully.' });
    } catch (error) {
        console.error('Error deleting announcement:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.getAnnouncementReplies = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;

        const announcement = await prisma.announcement.findFirst({
            where: { id, organizationId }
        });

        if (!announcement) {
            return res.status(404).send({ message: 'Announcement not found.' });
        }

        const replies = await prisma.announcementReply.findMany({
            where: { announcementId: id },
            include: {
                employee: {
                    select: { id: true, employeeName: true, profilePic: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).send({ replies });
    } catch (error) {
        console.error('Error fetching replies:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

// Employee routes below

// Mark the notification linked to an announcement as read (for the logged-in employee)
exports.markAnnouncementAsRead = async (req, res) => {
    try {
        const employeeId = req.user.id;
        const { id } = req.params; // announcement id

        // Check the announcement exists
        const announcement = await prisma.announcement.findUnique({
            where: { id }
        });

        if (!announcement) {
            return res.status(404).send({ message: 'Announcement not found.' });
        }

        // Find the notification for this employee + announcement
        const notification = await prisma.notification.findFirst({
            where: {
                userId: employeeId,
                announcementId: id,
                target: 'Employee'
            }
        });

        // Build updated isReadBy list (deduplicated)
        const currentReadBy = Array.isArray(announcement.isReadBy) ? announcement.isReadBy : [];
        const alreadyRead = currentReadBy.includes(employeeId);

        if (!alreadyRead) {
            await prisma.announcement.update({
                where: { id },
                data: { isReadBy: [...currentReadBy, employeeId] }
            });
        }

        if (notification && !notification.isRead) {
            await prisma.notification.update({
                where: { id: notification.id },
                data: { isRead: true }
            });
        }

        res.status(200).send({ message: alreadyRead ? 'Announcement already marked as read.' : 'Announcement marked as read.' });
    } catch (error) {
        console.error('Error marking announcement as read:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

// Get list of employees who have read / not yet read an announcement (Admin)
exports.getAnnouncementReadBy = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;

        const announcement = await prisma.announcement.findFirst({
            where: { id, organizationId },
            include: {
                targetedEmployees: {
                    include: {
                        employee: {
                            select: { id: true, employeeName: true, profilePic: true }
                        }
                    }
                }
            }
        });

        if (!announcement) {
            return res.status(404).send({ message: 'Announcement not found.' });
        }

        const readByIds = Array.isArray(announcement.isReadBy) ? announcement.isReadBy : [];

        // Determine the target audience
        let targetedEmployees = [];
        if (announcement.targetAll) {
            targetedEmployees = await prisma.employee.findMany({
                where: { organizationId, status: 'active' },
                select: { id: true, employeeName: true, profilePic: true }
            });
        } else {
            targetedEmployees = announcement.targetedEmployees.map(te => te.employee).filter(Boolean);
        }

        const readBy = targetedEmployees.filter(emp => readByIds.includes(emp.id));
        const notReadBy = targetedEmployees.filter(emp => !readByIds.includes(emp.id));

        res.status(200).send({
            readBy,
            notReadBy,
            totalRead: readBy.length,
            totalNotRead: notReadBy.length,
            totalTargeted: targetedEmployees.length
        });
    } catch (error) {
        console.error('Error fetching readBy list:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.replyToAnnouncement = async (req, res) => {
    try {
        const employeeId = req.user.id;
        const { id } = req.params;
        const { message } = req.body;

        if (!message) {
            return res.status(400).send({ message: 'Reply message is required.' });
        }

        const employee = await prisma.employee.findUnique({
            where: { id: employeeId }
        });

        if (!employee) return res.status(404).send({ message: 'Employee not found.' });

        const announcement = await prisma.announcement.findUnique({
            where: { id }
        });

        if (!announcement) {
            return res.status(404).send({ message: 'Announcement not found.' });
        }

        if (announcement.organizationId !== employee.organizationId) {
            return res.status(403).send({ message: 'Forbidden.' });
        }

        if (!announcement.canReply) {
            return res.status(400).send({ message: 'Replies are disabled for this announcement.' });
        }

        if (!announcement.targetAll) {
            const isTargeted = await prisma.employeeAnnouncement.findFirst({
                where: { announcementId: id, employeeId }
            });
            if (!isTargeted) {
                return res.status(403).send({ message: 'You are not authorized to reply to this announcement.' });
            }
        }

        const reply = await prisma.announcementReply.create({
            data: {
                announcementId: id,
                employeeId,
                message,
                isRead: false
            },
            include: {
                employee: {
                    select: { id: true, employeeName: true, profilePic: true }
                }
            }
        });

        res.status(201).send({ message: 'Reply submitted successfully.', reply });
    } catch (error) {
        console.error('Error submitting reply:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.markReplyAsRead = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { replyId } = req.params;

        const reply = await prisma.announcementReply.findUnique({
            where: { id: replyId },
            include: { announcement: true }
        });

        if (!reply || reply.announcement.organizationId !== organizationId) {
            return res.status(404).send({ message: 'Reply not found.' });
        }

        const updatedReply = await prisma.announcementReply.update({
            where: { id: replyId },
            data: { isRead: true },
            include: {
                employee: {
                    select: { id: true, employeeName: true, profilePic: true }
                }
            }
        });

        res.status(200).send({ message: 'Reply marked as read.', reply: updatedReply });
    } catch (error) {
        console.error('Error marking reply as read:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.markAllRepliesAsRead = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params; // announcement id

        const announcement = await prisma.announcement.findFirst({
            where: { id, organizationId }
        });

        if (!announcement) {
            return res.status(404).send({ message: 'Announcement not found.' });
        }

        const result = await prisma.announcementReply.updateMany({
            where: { announcementId: id, isRead: false },
            data: { isRead: true }
        });

        res.status(200).send({ message: 'All replies marked as read.', count: result.count });
    } catch (error) {
        console.error('Error marking all replies as read:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};
