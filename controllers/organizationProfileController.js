const prisma = require('../prisma/client');

exports.uploadProfilePic = async (req, res) => {
    const organizationId = req.user.id;

    if (!req.file) {
        return res.status(400).send({ message: 'Profile picture is required' });
    }

    try {
        const organization = await prisma.organization.update({
            where: { id: organizationId },
            data: { organizationProfilePic: req.file.path.replace(/\\/g, '/') }
        });

        res.status(200).send({
            message: 'Profile picture uploaded successfully',
            profilePic: organization.organizationProfilePic,
        });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).send({ message: 'Organization not found' });
        }
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
};

exports.setLocation = async (req, res) => {
    const { latitude, longitude, radius } = req.body;
    const organizationId = req.user.id;

    if (latitude == null || longitude == null || radius == null) {
        return res.status(400).send({ message: 'All fields (latitude, longitude, radius) are required' });
    }

    try {
        const organization = await prisma.organization.update({
            where: { id: organizationId },
            data: {
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                radius: parseFloat(radius)
            }
        });

        res.status(200).send({ message: 'Location and radius set successfully', organization });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).send({ message: 'Organization not found' });
        }
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
};

exports.setTime = async (req, res) => {
    const { inTime, outTime, workingDays } = req.body;
    const organizationId = req.user.id;

    if (!inTime || !outTime) {
        return res.status(400).send({ message: 'inTime and outTime are required' });
    }

    try {
        const data = { inTime, outTime };
        if (workingDays && Array.isArray(workingDays)) {
            data.workingDays = workingDays;
        }

        const organization = await prisma.organization.update({
            where: { id: organizationId },
            data
        });

        res.status(200).send({ message: 'In-Time and Out-Time set successfully', organization });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).send({ message: 'Organization not found' });
        }
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
};

exports.getDetails = async (req, res) => {
    const { organizationId } = req.params;

    try {
        const organization = await prisma.organization.findUnique({
            where: { id: organizationId }
        });

        if (!organization) {
            return res.status(404).send({ message: 'Organization not found' });
        }

        const employeeCount = await prisma.employee.count({
            where: { organizationCode: organization.organizationCode }
        });

        res.status(200).send({
            organization,
            employeeCount,
        });
    } catch (error) {
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
};

exports.updateLocation = exports.setLocation;
exports.updateTime = exports.setTime;

exports.updateDetails = async (req, res) => {
    const { organizationId, name, address, contactNumber, profilePic } = req.body;

    if (!organizationId || !name || !address || !contactNumber) {
        return res.status(400).send({ message: 'All fields (organizationId, name, address, contactNumber) are required' });
    }

    try {
        const data = { name, address, contactNumber };
        if (profilePic) {
            data.organizationProfilePic = profilePic;
        }

        const organization = await prisma.organization.update({
            where: { id: organizationId },
            data
        });

        res.status(200).send({ message: 'Organization details updated successfully', organization });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).send({ message: 'Organization not found' });
        }
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
};

exports.setWorkingDays = async (req, res) => {
    const { workingDays } = req.body;
    const organizationId = req.user.id;

    if (!workingDays || !Array.isArray(workingDays)) {
        return res.status(400).send({ message: 'workingDays array is required' });
    }

    try {
        const organization = await prisma.organization.update({
            where: { id: organizationId },
            data: { workingDays }
        });
        
        res.status(200).send({ message: 'Working days set successfully', organization });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).send({ message: 'Organization not found' });
        }
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
};

exports.updateWorkingDays = exports.setWorkingDays;
