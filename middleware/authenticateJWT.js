const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client'); // Add prisma client

const authenticateJWT = async (req, res, next) => {
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
    
    // Check if user is an employee and if they are inactive
    // We only want to log out inactive employees.
    const employee = await prisma.employee.findUnique({ where: { id: decoded.id } });
    
    if (employee) {
      if (employee.status === 'inactive') {
        return res.status(401).send({ message: 'Account is inactive. Please log in again.' });
      }
    }

    req.user = decoded; // Attach decoded user info to the request
    next();
  } catch (error) {
    return res.status(401).send({ message: 'Invalid token.' });
  }
};

module.exports = authenticateJWT;
