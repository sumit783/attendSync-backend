const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../prisma/client');
const sendOTPEmail = require('../Handlers/sendEmail');

const generateOTP = () => {
    if (process.env.NODE_ENV === 'development') return '1234';
    return Math.floor(1000 + Math.random() * 9000).toString();
};

const generateUniqueOrganizationCode = async () => {
    let code;
    let exists = true;
    while (exists) {
        // We probably want random codes even in dev, otherwise '1234' will always collide on the 2nd org
        code = Math.floor(1000 + Math.random() * 9000).toString();
        const org = await prisma.organization.findUnique({ where: { organizationCode: code } });
        if (!org) exists = false;
    }
    return code;
};

exports.signup = async (req, res) => {
    // Treat organizationEmail as the Super Admin email for now
    const { organizationName, organizationEmail, organizationOwnerName, password, confirmPassword } = req.body;
  
    if (!organizationEmail || !password || !confirmPassword) {
      return res.status(400).send({ message: 'Please enter all required data' });
    }
  
    if (password !== confirmPassword) {
      return res.status(400).send({ message: 'Passwords do not match' });
    }
  
    const existingAdmin = await prisma.admin.findUnique({ where: { email: organizationEmail } });
    if (existingAdmin) {
      return res.status(400).send({ message: 'Organization already exists with this email' });
    }
  
    const otp = generateOTP();
    const hashedPassword = await bcrypt.hash(password, 10);
    const adminId = crypto.randomUUID();
    const orgId = crypto.randomUUID();
    const adminRoleId = crypto.randomUUID();

    try {
        await prisma.$transaction(async (tx) => {
            const admin = await tx.admin.create({
                data: {
                    id: adminId,
                    email: organizationEmail,
                    password: hashedPassword,
                    otp,
                    otpExpires: new Date(Date.now() + 2 * 60 * 1000),
                    updatedAt: new Date()
                }
            });

            const org = await tx.organization.create({
                data: {
                    id: orgId,
                    organizationName,
                    organizationOwnerName,
                    organizationCode,
                }
            });

            await tx.adminRole.create({
                data: {
                    id: adminRoleId,
                    adminId: admin.id,
                    organizationId: org.id,
                    role: 'ADMIN'
                }
            });
        });
      
        if (process.env.NODE_ENV !== 'development') {
            sendOTPEmail(organizationEmail, otp, 'Verify your Organization Email');
        }
      
        res.status(201).send({ message: 'Organization created. Please verify your email.' });
    } catch (error) {
        console.error('Error in organization signup:', error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
};

exports.login = async (req, res) => {
  try {
      const { email, organizationEmail, password } = req.body;
      const loginEmail = email || organizationEmail;
      const admin = await prisma.admin.findUnique({
          where: { email: loginEmail },
          include: { AdminRole: { include: { Organization: true } } }
      });
      
      if (!admin || !await bcrypt.compare(password, admin.password)) {
        return res.status(400).send({ message: 'Invalid email or password' });
      }
      
      if (!admin.isVerified) {
        return res.status(400).send({ message: 'Email not verified. Please verify your email to log in.' });
      }
      
      const organization = admin.AdminRole?.[0]?.Organization || null;
      const token = jwt.sign({ id: organization ? organization.id : admin.id, adminId: admin.id, email: admin.email }, process.env.JWT_SECRET);
      res.status(200).send({
          message: 'Organization login successful',
          token,
          id: organization ? organization.id : admin.id,
          adminId: admin.id,
          organization: organization || admin
      });
  } catch (error) {
      console.error('Error in organization login:', error);
      res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
      const { email, otp, action } = req.body;

      const admin = await prisma.admin.findUnique({ where: { email } });
      if (!admin) {
          return res.status(400).send({ message: 'Organization not found.' });
      }

      if (admin.otp !== otp || !admin.otpExpires || admin.otpExpires < new Date()) {
          return res.status(400).send({ message: 'Invalid or expired OTP.' });
      }

      const updateData = {
          otp: null,
          otpExpires: null
      };

      if (action === 'verify-email') {
          updateData.isVerified = true;
      } else if (action === 'forgot-password') {
          await prisma.admin.update({
              where: { id: admin.id },
              data: updateData
          });
          return res.status(200).send({ message: 'Email verified successfully.' });
      } else if (action === 'forgot-password') {
          // For forgot-password, verify OTP validity here but do not erase OTP yet
          // It will be erased once reset-password successfully executes
          return res.status(200).send({ message: 'OTP verified. You can now reset your password.' });
      } else {
          return res.status(400).send({ message: 'Invalid action specified.' });
      }

      await prisma.admin.update({
          where: { id: admin.id },
          data: updateData
      });

      res.status(200).send({ message: 'Email verified successfully.' });

  } catch (error) {
      console.error('Error in /admin/verify-otp:', error);
      res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const admin = await prisma.admin.findUnique({ where: { email } });
      
        if (!admin) return res.status(400).send({ message: 'User not found' });
      
        const otp = generateOTP();
        await prisma.admin.update({
            where: { id: admin.id },
            data: {
                otp,
                otpExpires: new Date(Date.now() + 2 * 60 * 1000)
            }
        });
      
        if (process.env.NODE_ENV !== 'development') {
            sendOTPEmail(email, otp, 'Password Reset OTP');
        }
        res.status(200).send({ message: 'Password reset OTP sent to email.' });
    } catch (error) {
        console.error('Error in forgotPassword:', error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
};
  
exports.resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword, confirmNewPassword } = req.body;

        if (!email || !otp || !newPassword || !confirmNewPassword) {
            return res.status(400).send({ message: 'Please enter all required fields.' });
        }

        if (newPassword !== confirmNewPassword) {
            return res.status(400).send({ message: 'New passwords do not match.' });
        }

        const admin = await prisma.admin.findUnique({ where: { email } });

        if (!admin || admin.otp !== otp || !admin.otpExpires || admin.otpExpires < new Date()) {
            return res.status(400).send({ message: 'Invalid or expired OTP.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await prisma.admin.update({
            where: { id: admin.id },
            data: {
                password: hashedPassword,
                otp: null,
                otpExpires: null
            }
        });

        res.status(200).send({ message: 'Password reset successfully.' });
    } catch (error) {
        console.error('Error in resetPassword:', error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
};

// NEW: Endpoint to create a new organization (for SUPER_ADMIN)
exports.createOrganization = async (req, res) => {
    const { organizationName, organizationOwnerName, parentId, autoLogout } = req.body;
    
    const adminId = req.adminId; // Need middleware to set this

    if (!organizationName || !organizationOwnerName) {
        return res.status(400).send({ message: 'Please enter organization details' });
    }
    
    if (!adminId) {
        return res.status(401).send({ message: 'Unauthorized. Admin ID missing.' });
    }

    let finalParentId = parentId;

    if (!finalParentId) {
        // Automatically determine parentId based on Super Admin's main super organization
        const superOrgRole = await prisma.adminRole.findFirst({
            where: {
                adminId: adminId,
                role: 'SUPER_ADMIN',
                organization: {
                    parentId: null
                }
            }
        });
        
        if (superOrgRole) {
            finalParentId = superOrgRole.organizationId;
        }
    } else {
        // Verify admin has access to the explicitly provided parent organization
        const hasAccessToParent = req.adminRoles && req.adminRoles.some(role => role.organizationId === finalParentId && role.role === 'SUPER_ADMIN');
        if (!hasAccessToParent) {
            return res.status(403).send({ message: 'Forbidden. You do not have Super Admin access to the specified parent organization.' });
        }
    }

    const organizationCode = await generateUniqueOrganizationCode();
    
    const newOrg = await prisma.organization.create({
        data: {
            organizationName,
            organizationOwnerName,
            organizationCode,
            parentId: finalParentId || null,
            autoLogout: autoLogout !== undefined ? autoLogout : true
        }
    });

    // Link the Super Admin to this new organization
    await prisma.adminRole.create({
        data: {
            adminId: adminId,
            organizationId: newOrg.id,
            role: 'SUPER_ADMIN'
        }
    });

    res.status(201).send({ message: 'Organization created successfully.', organization: newOrg });
};

// NEW: Endpoint to create an ADMIN for a specific organization
exports.createAdminForOrganization = async (req, res) => {
    const { organizationId, email, password } = req.body;

    // Again, assuming req.adminId exists and they are SUPER_ADMIN
    const adminId = req.adminId;

    if (!organizationId || !email || !password) {
        return res.status(400).send({ message: 'Please enter organization ID, email, and password.' });
    }

    // Optional: check if current admin has permission to do this (must be SUPER_ADMIN for this org)
    
    const existingAdmin = await prisma.admin.findUnique({ where: { email } });
    if (existingAdmin) {
        return res.status(400).send({ message: 'Admin with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOTP();

    const newAdmin = await prisma.admin.create({
        data: {
            email,
            password: hashedPassword,
            otp,
            otpExpires: new Date(Date.now() + 2 * 60 * 1000),
            isVerified: true // Maybe auto-verify if created by Super Admin? or send OTP.
        }
    });

    await prisma.adminRole.create({
        data: {
            adminId: newAdmin.id,
            organizationId: organizationId,
            role: 'ADMIN'
        }
    });

    res.status(201).send({ message: 'Admin created successfully for the organization.' });
};

// NEW: Endpoint to get a list of all companies under a Super Admin
exports.getSuperAdminOrganizations = async (req, res) => {
    try {
        const adminId = req.adminId;
        if (!adminId) {
            return res.status(401).send({ message: 'Unauthorized. Admin ID missing.' });
        }

        // Find all roles where this admin is a SUPER_ADMIN
        const superAdminRoles = await prisma.adminRole.findMany({
            where: {
                adminId: adminId,
                role: 'SUPER_ADMIN'
            }
        });

        if (superAdminRoles.length === 0) {
            return res.status(200).send({ organizations: [] });
        }

        // Check if the user has a global SUPER_ADMIN role (organizationId is null)
        const isGlobalSuperAdmin = superAdminRoles.some(role => !role.organizationId);
        const superAdminOrgIds = superAdminRoles
            .map(role => role.organizationId)
            .filter(Boolean);

        let organizations;
        if (isGlobalSuperAdmin) {
            // Global Super Admin has access to all organizations
            organizations = await prisma.organization.findMany({
                orderBy: {
                    createdAt: 'desc'
                }
            });
        } else if (superAdminOrgIds.length > 0) {
            // Fetch all organizations that are either directly the super admin orgs, or have one of them as a parent
            organizations = await prisma.organization.findMany({
                where: {
                    OR: [
                        { id: { in: superAdminOrgIds } },
                        { parentId: { in: superAdminOrgIds } }
                    ]
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });
        } else {
            organizations = [];
        }
        
        res.status(200).send({ organizations });
    } catch (error) {
        console.error('Error fetching super admin organizations:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
    }
};
