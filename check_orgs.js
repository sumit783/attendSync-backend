const mongoose = require('mongoose');
const Organization = require('./models/organization');
require('dotenv').config();

const uri = process.env.MONGO_URI;

mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    const orgs = await Organization.find();
    console.log(JSON.stringify(orgs, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
