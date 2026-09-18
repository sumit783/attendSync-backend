const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client'); // Add prisma client

const authenticateAdmin = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Ensure the token is provided and in the correct format
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(403).send({ message: 'Access denied. No token provided or improperly formatted.' });
  }

  // Extract the token from the "Bearer <token>" format
  const token = authHeader.split(' ')[1];

  try {
    // Verify the token using the secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user is an admin
    const admin = await prisma.admin.findUnique({ 
        where: { id: decoded.id },
        include: { roles: true }
    });
    
    if (!admin) {
      return res.status(401).send({ message: 'Unauthorized. Admin not found.' });
    }
    
    req.user = decoded; // Attach decoded user info to the request
    req.adminId = admin.id;
    req.adminRoles = admin.roles;
    next();
  } catch (error) {
    return res.status(401).send({ message: 'Invalid token.' });
  }
};

module.exports = authenticateAdmin;
