const swaggerAutogen = require('swagger-autogen')();

const doc = {
  info: {
    title: 'AttendSync API',
    description: 'API documentation for AttendSync application',
    version: '1.0.0',
  },
  host: 'localhost:5000',
  basePath: '/',
  schemes: ['http'],
  securityDefinitions: {
    bearerAuth: {
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
      description: 'Enter your bearer token in the format **Bearer &lt;token>**'
    }
  },
  security: [ { bearerAuth: [] } ]
};

const outputFile = './swagger_output.json';
const endpointsFiles = ['./app.js']; // or wherever routes are attached

swaggerAutogen(outputFile, endpointsFiles, doc).then(() => {
    console.log("Swagger spec generated successfully!");
});
