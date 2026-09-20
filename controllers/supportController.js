const prisma = require('../prisma/client');

exports.createSupportQuery = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { message, attachment } = req.body;

        if (!message) {
            return res.status(400).send({ message: 'Message is required to create a support query.' });
        }

        const query = await prisma.supportQuery.create({
            data: {
                organizationId,
                message,
                attachment: attachment || null
            }
        });

        res.status(201).send({ message: 'Support query created successfully.', query });
    } catch (error) {
        console.error('Error creating support query:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.getMyQueries = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { search, status, page = 1, limit = 10 } = req.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        let whereClause = { organizationId };

        if (status) {
            whereClause.status = status;
        }

        if (search) {
            whereClause.message = {
                contains: search
            };
        }

        const [queries, total] = await prisma.$transaction([
            prisma.supportQuery.findMany({
                where: whereClause,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum
            }),
            prisma.supportQuery.count({ where: whereClause })
        ]);

        res.status(200).send({ 
            queries,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Error fetching support queries:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.updateQuery = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { queryId } = req.params;
        const { message, attachment } = req.body;

        const query = await prisma.supportQuery.findFirst({
            where: { id: queryId, organizationId }
        });

        if (!query) {
            return res.status(404).send({ message: 'Query not found.' });
        }

        if (query.status !== 'PENDING') {
            return res.status(400).send({ message: 'You can only edit PENDING queries.' });
        }

        const updatedQuery = await prisma.supportQuery.update({
            where: { id: queryId },
            data: {
                message: message || query.message,
                attachment: attachment !== undefined ? attachment : query.attachment
            }
        });

        res.status(200).send({ message: 'Query updated successfully.', query: updatedQuery });
    } catch (error) {
        console.error('Error updating support query:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.cancelQuery = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { queryId } = req.params;

        const query = await prisma.supportQuery.findFirst({
            where: { id: queryId, organizationId }
        });

        if (!query) {
            return res.status(404).send({ message: 'Query not found.' });
        }

        if (query.status !== 'PENDING' && query.status !== 'IN_PROCESS') {
            return res.status(400).send({ message: 'Query cannot be cancelled at this stage.' });
        }

        const updatedQuery = await prisma.supportQuery.update({
            where: { id: queryId },
            data: { status: 'CANCELLED' }
        });

        res.status(200).send({ message: 'Query cancelled successfully.', query: updatedQuery });
    } catch (error) {
        console.error('Error cancelling support query:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};
