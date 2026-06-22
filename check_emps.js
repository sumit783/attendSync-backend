const mongoose = require('mongoose');
const Employee = require('./models/employee');
const Organization = require('./models/organization');
require('dotenv').config();

const uri = process.env.MONGO_URI;

mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    const emps = await Employee.find().populate('organization');
    console.log(JSON.stringify(emps, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
