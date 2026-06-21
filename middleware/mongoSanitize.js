const mongoSanitize = require('express-mongo-sanitize');

const sanitizeMiddleware = (options = {}) => {
  return (req, res, next) => {
    ['body', 'params', 'headers', 'query'].forEach((key) => {
      if (req[key]) {
        // Sanitize returns the sanitized object. We then redefine the property on req
        // to bypass the getter-only issue in Express 5.
        const target = mongoSanitize.sanitize(req[key], options);
        Object.defineProperty(req, key, {
          value: target,
          configurable: true,
          writable: true,
          enumerable: true
        });
      }
    });
    next();
  };
};

module.exports = sanitizeMiddleware;
