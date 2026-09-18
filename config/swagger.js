const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const path = require('path');

const setupSwagger = (app) => {
  try {
    // Read the auto-generated swagger spec
    const swaggerDocument = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../swagger_output.json'), 'utf8')
    );
    
    // Remove host and basePath to use the current server URL automatically
    delete swaggerDocument.host;
    delete swaggerDocument.basePath;

    // Update securityDefinitions to use API Key auth via x-organization-id header
    if (swaggerDocument.securityDefinitions) {
        swaggerDocument.securityDefinitions.organization_auth = {
            "type": "apiKey",
            "name": "x-organization-id",
            "in": "header"
        };
    }
``
    // Add x-organization-id requirement to global security
    if (swaggerDocument.security) {
        swaggerDocument.security.push({ organization_auth: [] });
    } else {
        swaggerDocument.security = [{ organization_auth: [] }];
    }

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  } catch (error) {
    console.warn("Swagger output file not found. Please run 'node swagger.autogen.js' to generate API docs.");
  }
};

module.exports = setupSwagger;
