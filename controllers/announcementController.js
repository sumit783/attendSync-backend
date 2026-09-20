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
        const skip = (page - 1) * limit;

        const announcements = await prisma.announcement.findMany({
            where: { organizationId },
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

        const totalAnnouncements = await prisma.announcement.count({ where: { organizationId } });

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
                message
            }
        });

        res.status(201).send({ message: 'Reply submitted successfully.', reply });
    } catch (error) {
        console.error('Error submitting reply:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};
