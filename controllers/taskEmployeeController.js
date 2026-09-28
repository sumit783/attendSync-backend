const prisma = require('../prisma/client');
const createNotification = require('../Helpers/CreateNotification.js');

exports.getMyTasks = async (req, res) => {
    try {
        const employeeId = req.employeeId || req.user?.id; // Depends on how authenticateJWT assigns it, usually req.user.id
        
        // Fetch organization id to ensure we get tasks for the correct context
        const employee = await prisma.employee.findUnique({
            where: { id: employeeId }
        });

        if (!employee) {
            return res.status(404).send({ message: 'Employee not found.' });
        }

        const { status } = req.query;
        const whereClause = { 
            employeeId: employeeId,
            organizationId: employee.organizationId
        };
        
        if (status) {
            whereClause.status = status;
        }

        const tasks = await prisma.task.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).send({ tasks });
    } catch (error) {
        console.error('Error fetching employee tasks:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.updateTaskStatus = async (req, res) => {
    try {
        const employeeId = req.employeeId || req.user?.id;
        const { id } = req.params;
        const { status } = req.body;

        if (!status || !['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(status)) {
            return res.status(400).send({ message: 'Valid status is required (PENDING, IN_PROGRESS, COMPLETED).' });
        }

        const existingTask = await prisma.task.findFirst({
            where: { id, employeeId }
        });

        if (!existingTask) {
            return res.status(404).send({ message: 'Task not found or not assigned to you.' });
        }

        const updatedTask = await prisma.task.update({
            where: { id },
            data: { status }
        });

        res.status(200).send({ message: 'Task status updated successfully.', task: updatedTask });
    } catch (error) {
        console.error('Error updating task status:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};
