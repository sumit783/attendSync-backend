const prisma = require('../prisma/client');

exports.createCustomRole = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { 
            name, 
            attendanceAccess, 
            financeAccess, 
            leaveAccess, 
            announcementAccess, 
            designationAndWorkAssignAccess, 
            roleCreateAccess, 
            shiftAndHolidayAccess, 
            reportPageAccess 
        } = req.body;

        if (!name) {
            return res.status(400).send({ message: 'Role name is required.' });
        }

        const customRole = await prisma.customRole.create({
            data: {
                organizationId,
                name,
                attendanceAccess: attendanceAccess || false,
                financeAccess: financeAccess || false,
                leaveAccess: leaveAccess || false,
                announcementAccess: announcementAccess || false,
                designationAndWorkAssignAccess: designationAndWorkAssignAccess || false,
                roleCreateAccess: roleCreateAccess || false,
                shiftAndHolidayAccess: shiftAndHolidayAccess || false,
                reportPageAccess: reportPageAccess || false,
            }
        });

        res.status(201).send({ message: 'Custom role created successfully.', customRole });
    } catch (error) {
        console.error('Error creating custom role:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.getCustomRoles = async (req, res) => {
    try {
        const organizationId = req.organizationId;

        const customRoles = await prisma.customRole.findMany({
            where: { organizationId },
            include: {
                _count: {
                    select: { employees: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).send({ customRoles });
    } catch (error) {
        console.error('Error fetching custom roles:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.updateCustomRole = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;
        const updateData = req.body;

        const existingRole = await prisma.customRole.findFirst({
            where: { id, organizationId }
        });

        if (!existingRole) {
            return res.status(404).send({ message: 'Custom role not found.' });
        }

        const updatedRole = await prisma.customRole.update({
            where: { id },
            data: updateData
        });

        res.status(200).send({ message: 'Custom role updated successfully.', customRole: updatedRole });
    } catch (error) {
        console.error('Error updating custom role:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.deleteCustomRole = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;

        const existingRole = await prisma.customRole.findFirst({
            where: { id, organizationId },
            include: {
                _count: {
                    select: { employees: true }
                }
            }
        });

        if (!existingRole) {
            return res.status(404).send({ message: 'Custom role not found.' });
        }

        if (existingRole._count.employees > 0) {
            return res.status(400).send({ message: 'Cannot delete custom role because it is assigned to employees. Please re-assign them first.' });
        }

        await prisma.customRole.delete({
            where: { id }
        });

        res.status(200).send({ message: 'Custom role deleted successfully.' });
    } catch (error) {
        console.error('Error deleting custom role:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.assignRoleToEmployee = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { employeeId } = req.params;
        const { customRoleId } = req.body; // Pass null to remove role

        const employee = await prisma.employee.findFirst({
            where: { id: employeeId, organizationId }
        });

        if (!employee) {
            return res.status(404).send({ message: 'Employee not found.' });
        }

        if (customRoleId) {
            const role = await prisma.customRole.findFirst({
                where: { id: customRoleId, organizationId }
            });
            if (!role) {
                return res.status(404).send({ message: 'Custom role not found.' });
            }
        }

        const updatedEmployee = await prisma.employee.update({
            where: { id: employeeId },
            data: { customRoleId: customRoleId || null },
            include: {
                customRole: true
            }
        });

        res.status(200).send({ message: 'Custom role assigned successfully.', employee: updatedEmployee });
    } catch (error) {
        console.error('Error assigning custom role:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};


exports.getEmployeesByCustomRole = async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { id } = req.params;

        const role = await prisma.customRole.findFirst({
            where: { id, organizationId }
        });

        if (!role) {
            return res.status(404).send({ message: 'Custom role not found.' });
        }

        const employees = await prisma.employee.findMany({
            where: { customRoleId: id, organizationId },
            select: {
                id: true,
                employeeName: true,
                employeeEmail: true,
                profilePic: true,
                department: { select: { name: true } },
                designations: { select: { name: true } }
            }
        });

        res.status(200).send({ role: role.name, employees });
    } catch (error) {
        console.error('Error fetching employees by custom role:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};

exports.getAllCustomRolesWithEmployees = async (req, res) => {
    try {
        const organizationId = req.organizationId;

        const customRoles = await prisma.customRole.findMany({
            where: { organizationId },
            include: {
                employees: {
                    select: {
                        id: true,
                        employeeName: true,
                        employeeEmail: true,
                        profilePic: true
                    }
                }
            }
        });

        res.status(200).send({ customRoles });
    } catch (error) {
        console.error('Error fetching custom roles with employees:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};
