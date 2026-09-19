const prisma = require('../prisma/client');

exports.createHoliday = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { name, startDate, endDate, description } = req.body;

        if (!name || !startDate || !endDate) {
            return res.status(400).send({ message: 'Name, startDate, and endDate are required.' });
        }

        const holiday = await prisma.holiday.create({
            data: {
                organizationId,
                name,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                description
            }
        });

        res.status(201).send({ message: 'Holiday created successfully.', holiday });
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
