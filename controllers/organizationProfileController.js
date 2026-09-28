const prisma = require('../prisma/client');

exports.uploadProfilePic = async (req, res) => {
    const organizationId = req.organizationId || req.body?.organizationId || req.query?.organizationId;

    if (!organizationId) {
        return res.status(400).send({ message: 'Organization ID is required' });
    }

    const file = req.file || (req.files && req.files[0]);
    if (!file || !file.buffer) {
        return res.status(400).send({ message: 'Profile picture file is required' });
    }

    try {
        const base64Image = `data:${file.mimetype || 'image/png'};base64,${file.buffer.toString('base64')}`;

        const organization = await prisma.organization.update({
            where: { id: organizationId },
            data: { organizationProfilePic: base64Image }
        });

        res.status(200).send({
            message: 'Profile picture uploaded successfully',
            profilePic: organization.organizationProfilePic,
            organizationProfilePic: organization.organizationProfilePic,
            organization
        });
    } catch (error) {
        console.error('Error in uploadProfilePic:', error);
        if (error.code === 'P2025') {
            return res.status(404).send({ message: 'Organization not found' });
        }
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
};

exports.setLocation = async (req, res) => {
    const { latitude, longitude, radius } = req.body;
    const organizationId = req.organizationId;

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
    const organizationId = req.organizationId;

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
    const organizationId = req.organizationId; // Or req.params.organizationId, but middleware verified it

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
    const organizationId = req.organizationId || req.body.organizationId;
    const { name, organizationName, address, contactNumber, organizationOwnerName, profilePic } = req.body;
    const orgName = organizationName || name;

    if (!organizationId) {
        return res.status(400).send({ message: 'organizationId is required' });
    }

    try {
        const data = {};
        if (orgName) data.organizationName = orgName;
        if (organizationOwnerName) data.organizationOwnerName = organizationOwnerName;
        if (address !== undefined) data.address = address;
        if (profilePic) data.organizationProfilePic = profilePic;

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
    const organizationId = req.organizationId;

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
