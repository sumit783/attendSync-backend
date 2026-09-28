const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');

const adminCache = new Map();

const authenticateAdmin = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Ensure the token is provided and in the correct format
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(403).send({ message: 'Access denied. No token provided or improperly formatted.' });
  }

  // Extract the token from the Bearer header
  const token = authHeader.split(' ')[1];

  try {
    // Check in-memory cache first for repeated requests
    const cached = adminCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      req.user = cached.decoded;
      req.adminId = cached.admin.id;
      req.adminRoles = cached.admin.roles;
      return next();
    }

    // Verify the token using the secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user is an admin, including roles and organization
    let admin = null;
    const targetId = decoded.adminId || decoded.id;
    if (targetId) {
      admin = await prisma.admin.findUnique({
        where: { id: targetId },
        include: { AdminRole: { include: { Organization: true } } }
      });
    }

    if (!admin && decoded.email) {
      admin = await prisma.admin.findUnique({
        where: { email: decoded.email },
        include: { AdminRole: { include: { Organization: true } } }
      });
    }

    if (!admin && decoded.id) {
      const adminRole = await prisma.adminRole.findFirst({
        where: { organizationId: decoded.id },
        include: { Admin: { include: { AdminRole: { include: { Organization: true } } } } }
      });
      if (adminRole?.Admin) {
        admin = adminRole.Admin;
      }
    }

    if (!admin) {
      return res.status(401).send({ message: 'Unauthorized. Admin not found.' });
    }

    // Normalize roles to support both camelCase and PascalCase
    const roles = (admin.AdminRole || admin.adminRoles || []).map(r => ({
      ...r,
      organization: r.Organization || r.organization,
      Organization: r.Organization || r.organization
    }));
    admin.roles = roles;
    admin.adminRoles = roles;
    admin.AdminRole = roles;

    // Cache valid admin for 30 seconds
    if (adminCache.size > 200) adminCache.clear();
    adminCache.set(token, {
      admin,
      decoded,
      expiresAt: Date.now() + 30 * 1000
    });

    req.user = decoded; // Attach decoded user info to the request
    req.adminId = admin.id;
    req.adminRoles = roles;
    next();
  } catch (error) {
    console.error('authenticateAdmin error:', error);
    return res.status(401).send({ message: 'Invalid token.' });
  }
};

module.exports = authenticateAdmin;
