const prisma = require('../prisma/client');

exports.getAllQueries = async (req, res) => {
    try {
        const queries = await prisma.supportQuery.findMany({
            include: {
                organization: {
                    select: {
                        organizationName: true,
                        organizationCode: true,
                        organizationEmail: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).send({ queries });
    } catch (error) {
        console.error('Error fetching all support queries:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.updateQueryStatus = async (req, res) => {
    try {
        const { queryId } = req.params;
        const { status } = req.body;

        const validStatuses = ['PENDING', 'IN_PROCESS', 'RESOLVED', 'CANCELLED'];
        if (!validStatuses.includes(status)) {
            return res.status(400).send({ message: 'Invalid status. Must be one of: ' + validStatuses.join(', ') });
        }

        const query = await prisma.supportQuery.findUnique({
            where: { id: queryId }
        });

        if (!query) {
            return res.status(404).send({ message: 'Query not found.' });
        }

        const updatedQuery = await prisma.supportQuery.update({
            where: { id: queryId },
            data: { status }
        });

        res.status(200).send({ message: `Query status updated to ${status}.`, query: updatedQuery });
    } catch (error) {
        console.error('Error updating query status:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};
