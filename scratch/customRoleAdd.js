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
