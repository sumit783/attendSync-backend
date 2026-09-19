const prisma = require('../prisma/client');

exports.createDesignation = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { name, departmentId } = req.body;

        if (!name || !departmentId) {
            return res.status(400).send({ message: 'Designation name and departmentId are required.' });
        }

        // Verify the department belongs to the organization
        const department = await prisma.department.findFirst({
            where: { id: departmentId, organizationId }
        });

        if (!department) {
            return res.status(404).send({ message: 'Department not found in this organization.' });
        }

        const designation = await prisma.designation.create({
            data: {
                name,
                departmentId,
                organizationId
            }
        });

        res.status(201).send({ message: 'Designation created successfully.', designation });
    } catch (error) {
        console.error('Error creating designation:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.getDesignations = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { departmentId } = req.query;

        const whereClause = { organizationId };
        if (departmentId) {
            whereClause.departmentId = departmentId;
        }

        const designations = await prisma.designation.findMany({
            where: whereClause,
            include: {
                department: {
                    select: { id: true, name: true }
                },
                _count: {
                    select: { employees: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).send({ designations });
    } catch (error) {
        console.error('Error fetching designations:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.updateDesignation = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;
        const { name, departmentId } = req.body;

        if (!name) {
            return res.status(400).send({ message: 'Designation name is required.' });
        }

        const existingDesignation = await prisma.designation.findFirst({
            where: { id, organizationId }
        });

        if (!existingDesignation) {
            return res.status(404).send({ message: 'Designation not found in this organization.' });
        }

        if (departmentId && departmentId !== existingDesignation.departmentId) {
            const department = await prisma.department.findFirst({
                where: { id: departmentId, organizationId }
            });
            if (!department) {
                return res.status(404).send({ message: 'Department not found in this organization.' });
            }
        }

        const designation = await prisma.designation.update({
            where: { id },
            data: { 
                name,
                ...(departmentId && { departmentId })
            }
        });

        res.status(200).send({ message: 'Designation updated successfully.', designation });
    } catch (error) {
        console.error('Error updating designation:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.deleteDesignation = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;

        const existingDesignation = await prisma.designation.findFirst({
            where: { id, organizationId },
            include: {
                _count: {
                    select: { employees: true }
                }
            }
        });

        if (!existingDesignation) {
            return res.status(404).send({ message: 'Designation not found in this organization.' });
        }

        if (existingDesignation._count.employees > 0) {
            return res.status(400).send({ 
                message: 'Cannot delete designation because it is assigned to employees. Please re-assign them first.' 
            });
        }

        await prisma.designation.delete({
            where: { id }
        });

        res.status(200).send({ message: 'Designation deleted successfully.' });
    } catch (error) {
        console.error('Error deleting designation:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.assignDesignationToEmployee = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { employeeId } = req.params;
        let { designationIds } = req.body;

        // Support old format `designationId` just in case
        if (req.body.designationId !== undefined && !designationIds) {
            designationIds = req.body.designationId ? [req.body.designationId] : [];
        }

        if (!Array.isArray(designationIds)) {
            designationIds = [];
        }

        const organization = await prisma.organization.findUnique({
            where: { id: organizationId }
        });
        if (!organization) return res.status(404).send({ message: 'Organization not found.' });

        const employee = await prisma.employee.findFirst({
            where: {
                id: employeeId,
                organizationCode: organization.organizationCode
            }
        });

        if (!employee) return res.status(404).send({ message: 'Employee not found.' });

        let departmentId = null;

        if (designationIds.length > 0) {
            const designations = await prisma.designation.findMany({
                where: { 
                    id: { in: designationIds },
                    organizationId 
                }
            });
            
            if (designations.length !== designationIds.length) {
                return res.status(404).send({ message: 'One or more designations not found.' });
            }
            
            // Assign departmentId from the first designation
            departmentId = designations[0].departmentId;
        }

        const updatedEmployee = await prisma.employee.update({
            where: { id: employeeId },
            data: { 
                designations: {
                    set: designationIds.map(id => ({ id }))
                },
                departmentId: departmentId || null
            },
            include: {
                designations: true
            }
        });

        res.status(200).send({ message: 'Designations assigned successfully.', employee: updatedEmployee });
    } catch (error) {
        console.error('Error assigning designation:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};
