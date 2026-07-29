'use strict';

const crypto = require('crypto');
const { createRepository } = require('./src/repository');
const { createApp } = require('./src/app');

const port = process.env.PORT || 3000;
const adminToken = process.env.ADMIN_TOKEN || crypto.randomBytes(16).toString('hex');

const repository = createRepository({ file: process.env.DATABASE_FILE });
const app = createApp({
  repository,
  adminToken,
  frameAncestors: process.env.FRAME_ANCESTORS || null
});

app.listen(port, () => {
  console.log(`1X2-omröstning: http://localhost:${port}`);
  console.log(`Skribentvy:     http://localhost:${port}/skribent.html`);
  if (!process.env.ADMIN_TOKEN) {
    console.log(`\nADMIN_TOKEN är inte satt. Tillfällig token för den här sessionen:\n  ${adminToken}`);
  }
});
