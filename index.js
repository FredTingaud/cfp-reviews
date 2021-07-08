const express = require('express');
const _ = require('lodash');
const proposal = require('./lib/proposal');
const review = require('./lib/review');

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('db.json');
const db = low(adapter);

const proposeApp = express();
proposeApp.listen(3000);
proposal.prepareProposal(proposeApp, db);

const reviewApp = express();
reviewApp.listen(3010);
review.prepareReview(reviewApp, db);
