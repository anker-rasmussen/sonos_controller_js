const axios = require('axios');
const fs = require('fs');
const open = require('open');
const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

const sonosHomeController = require('./sonos_home_controller')({
  axios,
  fs,
  open,
  express,
  path,
  dotenv,
});

sonosHomeController.main();
