const prisma = require('../prisma/client');

const requireOrganizationAccess = async (req, res, next) => {
    // Determine the target organization ID.
    // Order of preference: Headers -> Query -> Body -> Params
    const targetOrganizationId = req.headers['x-organization-id'] || req.query?.organizationId || req.body?.organizationId || req.params?.organizationId;

    if (!targetOrganizationId) {
        return res.status(400).send({ message: 'Missing organization ID context (x-organization-id header or organizationId parameter).' });
    }

    if (!req.adminId) {
        return res.status(401).send({ message: 'Unauthorized. Admin context missing.' });
    }

    try {
        // 1. Direct Access Check
        let hasAccess = req.adminRoles && req.adminRoles.some(role => role.organizationId === targetOrganizationId);

        // 2. Hierarchical (Super Admin) Access Check
        if (!hasAccess && req.adminRoles) {
            // Find all organizations where this admin is a SUPER_ADMIN
            const superAdminOrgs = req.adminRoles
                .filter(role => role.role === 'SUPER_ADMIN')
                .map(role => role.organizationId);

            if (superAdminOrgs.length > 0) {
                // Check if the target organization's parentId is in superAdminOrgs
                const targetOrg = await prisma.organization.findUnique({ where: { id: targetOrganizationId } });
                if (targetOrg && targetOrg.parentId && superAdminOrgs.includes(targetOrg.parentId)) {
                    hasAccess = true;
                }
            }
        }

        if (!hasAccess) {
             // Let's do a fallback check just in case req.adminRoles wasn't populated fully.
             const role = await prisma.adminRole.findFirst({
                 where: {
                     adminId: req.adminId,
                     organizationId: targetOrganizationId
                 },
                 include: { organization: true }
             });

             if (!role) {
                 // Fallback check for parentId
                 const targetOrg = await prisma.organization.findUnique({ where: { id: targetOrganizationId } });
                 if (targetOrg && targetOrg.parentId) {
                     const superRole = await prisma.adminRole.findFirst({
                         where: {
                             adminId: req.adminId,
                             organizationId: targetOrg.parentId,
                             role: 'SUPER_ADMIN'
                         }
                     });
                     if (superRole) {
                         req.organizationId = targetOrganizationId;
                         req.organizationCode = targetOrg.organizationCode;
                         return next();
                     }
                 }
                 return res.status(403).send({ message: 'Forbidden. You do not have access to this organization.' });
             }
             
             req.organizationId = targetOrganizationId;
             req.organizationCode = role.organization.organizationCode;
        } else {
             // We have access either directly or hierarchically
             const org = await prisma.organization.findUnique({ where: { id: targetOrganizationId }});
             if (!org) return res.status(404).send({ message: 'Organization not found.' });
             req.organizationCode = org.organizationCode;
             req.organizationId = targetOrganizationId;
        }

        next();
    } catch (error) {
        console.error('Error in requireOrganizationAccess middleware:', error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
};

module.exports = requireOrganizationAccess;
