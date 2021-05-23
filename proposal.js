const express = require('express');
const exphbs = require('express-handlebars');
const path = require('path');
const _ = require('lodash');
const marked = require('marked');
const login = require('./lib/login');
const advices = require('./lib/advices');
const octicons = require("@primer/octicons");
const shortid = require('shortid')

const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const app = express();

// To support URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, '/public')));

app.engine('hbs', exphbs({
    extname: '.hbs',
    helpers: {
        input_long: function (str) {
            return DOMPurify.sanitize(marked(str || ""));
        },
        input_short: function (str) {
            return DOMPurify.sanitize(marked.parseInline(str || ""));
        },
        checked: function (value, test) {
            if (value === undefined) return '';
            return value === test ? 'checked' : '';
        }
    }
}));

app.set('view engine', 'hbs');

app.listen(3000);

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('db.json');
const db = low(adapter);

db.defaults({ cfps: [], users: [], scores: [] }).write();

login.prepareLogin(app, db);

app.get('/instructions', login.requireAuth, (req, res) => {
    res.render('proposal/instructions');
});

app.post('/instructions', login.requireAuth, (req, res) => {
    res.redirect('/cfp');
});

app.get('/cfp', login.requireAuth, (req, res) => {
    const user = db.get('users').find({ userId: req.user }).value();

    res.render('proposal/cfp', {
        adviceIcon: octicons['light-bulb'].toSVG({ height: "1em", width: "1em", "aria-label": "Hint", fill: "currentColor" }),
        titleAdvice: DOMPurify.sanitize(marked(advices.title)),
        trackAdvice: advices.track,
        languageAdvice: advices.language,
        abstractAdvice: marked(advices.abstract),
        outlineAdvice: marked(advices.outline),
        nameAdvice: marked(advices.name),
        bioAdvice: marked(advices.bio),
        affiliationAdvice: marked(advices.affiliation),
        durationAdvice: marked(advices.duration),
        experienceAdvice: advices.experience,
        cfpid: shortid.generate(),
        firstName: user.firstName,
        lastName: user.lastName,
        bio: user.speakerBio,
        affiliation: user.affiliation,
        pastExperience: user.pastExperience
    });
});

app.post('/cfp', login.requireAuth, (req, res) => {
    input = req.body;

    const proposals = db.get('cfps');
    let existing = proposals.find({ cfpId: input.cfpId, changed: false });
    if (!_.isEmpty(existing.value())) {
        existing.assign({ changed: true }).write();
    }
    proposals.push({
        timestamp: Date.now,
        changed: false,
        changeId: _.isEmpty(existing.value()) ? 0 : existing.value().changeId + 1,
        index: input.cfpid,
        titleOfThePresentation: input.title,
        abstract: input.abstract,
        outline: input.outline,
        track: input.track,
        preferredDuration: input.duration,
        otherPossibleDurations: input.otherDurations,
        isThereAnythingElseYoudLikeToCommunicateToUs: input.anything,
        language: input.language,
        writer: req.user
        }).write();

    const user = db.get('users').find({ userId: req.user });
    user.assign({
        firstName: input.firstName,
        lastName: input.lastName,
        speakerBio: input.bio,
        affiliation: input.affiliation,
        pastExperience: input.pastExperience
        }).write();

    res.render("proposal/done");
});

const logObject = (obj) => {
    console.log(JSON.stringify(obj, null, 4));
};
