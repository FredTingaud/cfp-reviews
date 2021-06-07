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

const TAGS = ["tooling", "testing", "refactoring", "libraries", "STL", "C++ evolution", "accessibility", "soft skills", "language", "essentials", "performance"];
db.defaults({ cfps: [], users: [], scores: [], tags: TAGS.map(t => ({value: t, count: 0, checked: true})) }).write();


login.prepareLogin(app, db);

app.get('/instructions', login.requireAuth, (req, res) => {
    let existing = db.get('cfps').filter({ writer: req.user });

    res.render('proposal/instructions', {hasProposals: !_.isEmpty(existing.value())});
});

app.post('/instructions', login.requireAuth, (req, res) => {
    res.redirect('/cfp');
});

const renderCFP = (proposal, req, res) => {
    const user = db.get('users').find({ userId: req.user }).value();
    let existing = db.get('cfps').filter({ writer: req.user });

    const checkedTags = db.get('tags').filter(t => t.checked).value().map(t => t.value);
    let possibleTags = checkedTags.concat(proposal.tags.split(','));

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
        tagsAdvice: advices.tags,
        cfpid: proposal.cfpid,
        firstName: user.firstName,
        lastName: user.lastName,
        bio: user.speakerBio,
        affiliation: user.affiliation,
        pastExperience: user.pastExperience,
        title: proposal.title,
        abstract: proposal.abstract,
        outline: proposal.outline,
        track: proposal.track,
        tags: proposal.tags,
        anything: proposal.anything,
        language: proposal.language,
        duration: proposal.duration,
        coc: proposal.coc,
        hasProposals: !_.isEmpty(existing.value()),
        possibleTags: "[" + possibleTags.map(v => `{value: "${v}", text: "${v}"}`).join(',') + "]"
    });

};

app.get('/cfp/:cfpid', login.requireAuth, (req, res) => {
    const proposals = db.get('cfps');
    let proposal = proposals.find({ index: req.params.cfpid, writer: req.user, changed: false }).value();

    renderCFP({
        title: proposal.titleOfThePresentation,
        abstract: proposal.abstract,
        outline: proposal.outline,
        track: proposal.track,
        duration: proposal.preferredDuration,
        tags: proposal.tags,
        anything: proposal.isThereAnythingElseYoudLikeToCommunicateToUs,
        language: proposal.language,
        coc: proposal.coc,
        cfpid: req.params.cfpid
    }, req, res);
});

app.get('/cfp', login.requireAuth, (req, res) => {
    renderCFP({cfpid: shortid.generate()}, req, res);
});

const upsertTag = (tag, allTags) => {
    let existing = allTags.find({ value: tag });
    if (_.isEmpty(existing.value())) {
        allTags.push({
            value: tag,
            count: 1,
            checked: false
        }).write();
    }
    else {
        existing.update('count', n => n + 1).write();
    }
};

app.post('/cfp', login.requireAuth, (req, res) => {
    input = req.body;
    if (!input.coc){
        return;
    }

    const proposals = db.get('cfps');
    const allTags = db.get('tags');
    let existing = proposals.find({ index: input.cfpid, writer: req.user, changed: false });

    const newLocal = {
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
        tags: input.tags,
        isThereAnythingElseYoudLikeToCommunicateToUs: input.anything,
        language: input.language,
        coc: input.coc,
        writer: req.user,
        timestamp: Date.now()
    };

    if (!_.isEmpty(existing.value())) {
        existing.value().tags.split(',').forEach(t => allTags.find({value: t}).update('count', n => n - 1).write());
        allTags.remove(t => t.count <= 0 && !t.checked).write();
        existing.assign({ changed: true }).write();
    }

    proposals.push(newLocal).write();
    input.tags.split(',').forEach(t => upsertTag(t, allTags));

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

app.get('/proposals', login.requireAuth, (req, res) => {
    let proposals = db.get('cfps').filter({ writer: req.user, changed: false }).sortBy('index').value();

    res.render("proposal/all", {proposals: proposals});
});

const logObject = (obj) => {
    console.log(JSON.stringify(obj, null, 4));
};
