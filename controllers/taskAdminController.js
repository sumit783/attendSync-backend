const prisma = require('../prisma/client');
const createNotification = require('../Helpers/CreateNotification.js');

exports.createTask = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const adminId = req.adminId; // Optional: depending on if available in middleware
        const { title, description, employeeId } = req.body;

        if (!title || !employeeId) {
            return res.status(400).send({ message: 'Title and employeeId are required.' });
        }

        // Verify employee belongs to this organization
        const employee = await prisma.employee.findFirst({
            where: { id: employeeId, organizationId }
        });

        if (!employee) {
            return res.status(404).send({ message: 'Employee not found in this organization.' });
        }

        const task = await prisma.task.create({
            data: {
                title,
                description,
                status: 'PENDING',
                employeeId,
                organizationId,
                assignedById: adminId || null
            }
        });

        // Send notification
        await createNotification(
            employeeId, 
            organizationId, 
            `New task assigned: ${title}`, 
            'TASK_ASSIGNED', 
            null, 
            'Employee'
        );

        res.status(201).send({ message: 'Task created successfully.', task });
    } catch (error) {
        console.error('Error creating task:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.getTasks = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { employeeId, status } = req.query;

        const whereClause = { organizationId };
        if (employeeId) whereClause.employeeId = employeeId;
        if (status) whereClause.status = status;

        const tasks = await prisma.task.findMany({
            where: whereClause,
            include: {
                employee: {
                    select: { id: true, employeeName: true, profilePic: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).send({ tasks });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.updateTask = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;
        const { title, description, status, employeeId } = req.body;

        const existingTask = await prisma.task.findFirst({
            where: { id, organizationId }
        });

        if (!existingTask) {
            return res.status(404).send({ message: 'Task not found in this organization.' });
        }

        if (employeeId && employeeId !== existingTask.employeeId) {
            const employee = await prisma.employee.findFirst({
                where: { id: employeeId, organizationId }
            });
            if (!employee) {
                return res.status(404).send({ message: 'New employee not found in this organization.' });
            }
        }

        const updatedTask = await prisma.task.update({
            where: { id },
            data: { 
                ...(title && { title }),
                ...(description !== undefined && { description }),
                ...(status && { status }),
                ...(employeeId && { employeeId })
            }
        });

        res.status(200).send({ message: 'Task updated successfully.', task: updatedTask });
    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.deleteTask = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;

        const existingTask = await prisma.task.findFirst({
            where: { id, organizationId }
        });

        if (!existingTask) {
            return res.status(404).send({ message: 'Task not found in this organization.' });
        }

        // Option A implemented: Hard delete the task
        await prisma.task.delete({
            where: { id }
        });

        res.status(200).send({ message: 'Task deleted successfully.' });
    } catch (error) {
        console.error('Error deleting task:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};
