const Organization = require('../models/organization');
const Employee = require('../models/employee');

exports.uploadProfilePic = async (req, res) => {
    const organizationId = req.user.id;

    if (!req.file) {
        return res.status(400).send({ message: 'Profile picture is required' });
    }

    try {
        const organization = await Organization.findById(organizationId);
        if (!organization) {
            return res.status(404).send({ message: 'Organization not found' });
        }

        organization.organizationProfilePic = req.file.path; // Save path to DB
        await organization.save();

        res.status(200).send({
            message: 'Profile picture uploaded successfully',
            profilePic: organization.organizationProfilePic,
        });
    } catch (error) {
        res.status(500).send({ message: 'Internal Server Error', error });
    }
};

exports.setLocation = async (req, res) => {
    const { latitude, longitude, radius } = req.body;
    const organizationId = req.user.id; // Extracting organization ID from auth token

    if (latitude == null || longitude == null || radius == null) {
        return res.status(400).send({ message: 'All fields (latitude, longitude, radius) are required' });
    }

    try {
        const organization = await Organization.findById(organizationId);
        if (!organization) {
            return res.status(404).send({ message: 'Organization not found' });
        }

        organization.location = {
            type: 'Point',
            coordinates: [longitude, latitude], // GeoJSON format
        };
        organization.radius = radius;

        await organization.save();
        res.status(200).send({ message: 'Location and radius set successfully', organization });
    } catch (error) {
        res.status(500).send({ message: 'Internal Server Error', error });
    }
};

exports.setTime = async (req, res) => {
    const { inTime, outTime } = req.body;
    const organizationId = req.user.id;

    if (!organizationId || !inTime || !outTime) {
        return res.status(400).send({ message: 'All fields (organizationId, inTime, outTime) are required' });
    }

    try {
        const organization = await Organization.findById(organizationId);
        if (!organization) {
            return res.status(404).send({ message: 'Organization not found' });
        }

        organization.inTime = inTime;
        organization.outTime = outTime;

        await organization.save();
        res.status(200).send({ message: 'In-Time and Out-Time set successfully', organization });
    } catch (error) {
        res.status(500).send({ message: 'Internal Server Error', error });
    }
};

exports.getDetails = async (req, res) => {
    const { organizationId } = req.params;

    try {
        const organization = await Organization.findById(organizationId);
        if (!organization) {
            return res.status(404).send({ message: 'Organization not found' });
        }

        // Count employees linked to this organization
        const employeeCount = await Employee.countDocuments({ organizationCode: organization.organizationCode });

        res.status(200).send({
            organization,
            employeeCount, // Include employee count in response
        });
    } catch (error) {
        res.status(500).send({ message: 'Internal Server Error', error });
    }
};

exports.updateLocation = async (req, res) => {
    const { latitude, longitude, radius } = req.body;
    const organizationId = req.user.id; // Extracting organization ID from auth token

    if (latitude == null || longitude == null || radius == null) {
        return res.status(400).send({ message: 'All fields (latitude, longitude, radius) are required' });
    }

    try {
        const organization = await Organization.findById(organizationId);
        if (!organization) {
            return res.status(404).send({ message: 'Organization not found' });
        }

        organization.location = {
            type: 'Point',
            coordinates: [longitude, latitude], // GeoJSON format
        };
        organization.radius = radius;

        await organization.save();
        res.status(200).send({ message: 'Location and radius updated successfully', organization });
    } catch (error) {
        res.status(500).send({ message: 'Internal Server Error', error });
    }
};

exports.updateTime = async (req, res) => {
    const { inTime, outTime } = req.body;
    const organizationId = req.user.id;

    if (!organizationId || !inTime || !outTime) {
        return res.status(400).send({ message: 'All fields (organizationId, inTime, outTime) are required' });
    }

    try {
        const organization = await Organization.findById(organizationId);
        if (!organization) {
            return res.status(404).send({ message: 'Organization not found' });
        }

        organization.inTime = inTime;
        organization.outTime = outTime;

        await organization.save();
        res.status(200).send({ message: 'In-Time and Out-Time updated successfully', organization });
    } catch (error) {
        res.status(500).send({ message: 'Internal Server Error', error });
    }
};

exports.updateDetails = async (req, res) => {
    const { organizationId, name, address, contactNumber, profilePic } = req.body;

    if (!organizationId || !name || !address || !contactNumber) {
        return res.status(400).send({ message: 'All fields (organizationId, name, address, contactNumber) are required' });
    }

    try {
        const organization = await Organization.findById(organizationId);
        if (!organization) {
            return res.status(404).send({ message: 'Organization not found' });
        }

        organization.name = name;
        organization.address = address;
        organization.contactNumber = contactNumber;

        if (profilePic) {
            organization.organizationProfilePic = profilePic; // Optional: only update if provided
        }

        await organization.save();
        res.status(200).send({ message: 'Organization details updated successfully', organization });
    } catch (error) {
        res.status(500).send({ message: 'Internal Server Error', error });
    }
};
