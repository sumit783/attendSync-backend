const prisma = require('../prisma/client');

exports.createHoliday = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { name, startDate, endDate, description } = req.body;

        if (!name || !startDate || !endDate) {
            return res.status(400).send({ message: 'Name, startDate, and endDate are required.' });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        const holiday = await prisma.holiday.create({
            data: {
                organizationId,
                name,
                startDate: start,
                endDate: end,
                description
            }
        });

        // Notify all active employees in this organization
        const activeEmployees = await prisma.employee.findMany({
            where: { organizationId, status: 'active' },
            select: { id: true }
        });

        if (activeEmployees.length > 0) {
            const isSameDay = start.toDateString() === end.toDateString();
            const dateText = isSameDay
                ? start.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
                : `${start.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`;

            const notificationMessage = `🌴 Holiday Announcement: ${name} (${dateText})${description ? ` - ${description}` : ''}`;

            const notificationsData = activeEmployees.map(emp => ({
                userId: emp.id,
                organizationId,
                message: notificationMessage,
                type: 'Reminder',
                target: 'Employee',
                isRead: false
            }));

            await prisma.notification.createMany({
                data: notificationsData
            });
        }

        res.status(201).send({ message: 'Holiday created successfully and employees notified.', holiday });
    } catch (error) {
        console.error('Error creating holiday:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.getHolidays = async (req, res) => {
    try {
        const organizationId = req.organizationId;

        const holidays = await prisma.holiday.findMany({
            where: { organizationId },
            orderBy: { startDate: 'asc' }
        });

        res.status(200).send({ holidays });
    } catch (error) {
        console.error('Error fetching holidays:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.updateHoliday = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;
        const { name, startDate, endDate, description } = req.body;

        const existingHoliday = await prisma.holiday.findFirst({
            where: { id, organizationId }
        });

        if (!existingHoliday) {
            return res.status(404).send({ message: 'Holiday not found.' });
        }

        const updatedHoliday = await prisma.holiday.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(startDate && { startDate: new Date(startDate) }),
                ...(endDate && { endDate: new Date(endDate) }),
                ...(description !== undefined && { description })
            }
        });

        // Notify employees if name or date changed
        if (name || startDate || endDate) {
            const activeEmployees = await prisma.employee.findMany({
                where: { organizationId, status: 'active' },
                select: { id: true }
            });

            if (activeEmployees.length > 0) {
                const finalStart = startDate ? new Date(startDate) : existingHoliday.startDate;
                const finalEnd = endDate ? new Date(endDate) : existingHoliday.endDate;
                const finalName = name || existingHoliday.name;

                const isSameDay = new Date(finalStart).toDateString() === new Date(finalEnd).toDateString();
                const dateText = isSameDay
                    ? new Date(finalStart).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
                    : `${new Date(finalStart).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} - ${new Date(finalEnd).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`;

                const notificationMessage = `🌴 Holiday Updated: ${finalName} (${dateText})`;

                await prisma.notification.createMany({
                    data: activeEmployees.map(emp => ({
                        userId: emp.id,
                        organizationId,
                        message: notificationMessage,
                        type: 'Reminder',
                        target: 'Employee',
                        isRead: false
                    }))
                });
            }
        }

        res.status(200).send({ message: 'Holiday updated successfully.', holiday: updatedHoliday });
    } catch (error) {
        console.error('Error updating holiday:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.deleteHoliday = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;

        const existingHoliday = await prisma.holiday.findFirst({
            where: { id, organizationId }
        });

        if (!existingHoliday) {
            return res.status(404).send({ message: 'Holiday not found.' });
        }

        await prisma.holiday.delete({
            where: { id }
        });

        res.status(200).send({ message: 'Holiday deleted successfully.' });
    } catch (error) {
        console.error('Error deleting holiday:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};
