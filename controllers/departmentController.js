const prisma = require('../prisma/client');

exports.createDepartment = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { name } = req.body;

        if (!name) {
            return res.status(400).send({ message: 'Department name is required.' });
        }

        const department = await prisma.department.create({
            data: {
                name,
                organizationId
            }
        });

        res.status(201).send({ message: 'Department created successfully.', department });
    } catch (error) {
        console.error('Error creating department:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.getDepartments = async (req, res) => {
    try {
        const organizationId = req.organizationId;

        const departments = await prisma.department.findMany({
            where: { organizationId },
            include: {
                _count: {
                    select: { designations: true, employees: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).send({ departments });
    } catch (error) {
        console.error('Error fetching departments:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.updateDepartment = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;
        const { name } = req.body;

        if (!name) {
            return res.status(400).send({ message: 'Department name is required.' });
        }

        const existingDepartment = await prisma.department.findFirst({
            where: { id, organizationId }
        });

        if (!existingDepartment) {
            return res.status(404).send({ message: 'Department not found in this organization.' });
        }

        const department = await prisma.department.update({
            where: { id },
            data: { name }
        });

        res.status(200).send({ message: 'Department updated successfully.', department });
    } catch (error) {
        console.error('Error updating department:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.deleteDepartment = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;

        const existingDepartment = await prisma.department.findFirst({
            where: { id, organizationId },
            include: {
                _count: {
                    select: { designations: true, employees: true }
                }
            }
        });

        if (!existingDepartment) {
            return res.status(404).send({ message: 'Department not found in this organization.' });
        }

        // Option A implemented: Prevent deletion if there are associated designations or employees
        if (existingDepartment._count.designations > 0 || existingDepartment._count.employees > 0) {
            return res.status(400).send({ 
                message: 'Cannot delete department because it has associated designations or employees. Please re-assign them first.' 
            });
        }

        await prisma.department.delete({
            where: { id }
        });

        res.status(200).send({ message: 'Department deleted successfully.' });
    } catch (error) {
        console.error('Error deleting department:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};
