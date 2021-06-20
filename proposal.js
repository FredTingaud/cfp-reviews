const express = require('express');
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

app.listen(3000);

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('db.json');
const db = low(adapter);

login.prepareLogin(app, db);

app.get('/instructions', login.requireAuth, (req, res) => {
    let existing = db.get('cfps').filter({ writer: req.user });

    res.render('proposal/instructions', {
        alerts: db.get('alerts').value(),
        hasProposals: !_.isEmpty(existing.value())
    });
});

app.post('/instructions', login.requireAuth, (req, res) => {
    res.redirect('/cfp');
});

const renderCFP = (proposal, req, res) => {
    const user = db.get('users').find({ userId: req.user }).value();
    let existing = db.get('cfps').filter({ writer: req.user });

    const checkedTags = db.get('tags').filter(t => t.checked).value().map(t => t.value);
    const currentTags = proposal.tags ? proposal.tags.split(',') : [];
    let possibleTags = checkedTags.concat(currentTags);

    res.render('proposal/cfp', {
        alerts: db.get('alerts').value(),
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
        finished: proposal.finished,
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
        cfpid: req.params.cfpid,
        finished: proposal.finished
    }, req, res);
});

app.get('/cfp', login.requireAuth, (req, res) => {
    renderCFP({ cfpid: shortid.generate(), finished: false }, req, res);
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

const saveUserUpdates = (input, user) => {
    const userDB = db.get('users').find({ userId: user });
    userDB.assign({
        firstName: input.firstName,
        lastName: input.lastName,
        speakerBio: input.bio,
        affiliation: input.affiliation,
        pastExperience: input.pastExperience
    }).write();
};

app.post('/cfp', login.requireAuth, (req, res) => {
    input = req.body;

    const proposals = db.get('cfps');
    proposals.remove(v => v.index === input.cfpid && !v.finished).write();

    if (input.save) {
        proposals.push({
            changed: false,
            changeId: -1,
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
            finished: false,
            timestamp: Date.now()
        }).write();

    } else {
        if (!input.coc) {
            return;
        }

        const allTags = db.get('tags');
        let existing = proposals.find({ index: input.cfpid, writer: req.user, changed: false, finished: true });

        const newLocal = {
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
            finished: true,
            timestamp: Date.now()
        };

        if (!_.isEmpty(existing.value())) {
            existing.value().tags.split(',').forEach(t => allTags.find({ value: t }).update('count', n => n - 1).write());
            allTags.remove(t => t.count <= 0 && !t.checked).write();
            existing.assign({ changed: true }).write();
        }

        proposals.push(newLocal).write();

        input.tags.split(',').forEach(t => upsertTag(t, allTags));
    }

    saveUserUpdates(input, req.user);

    res.redirect('/preview/' + input.cfpid);
});

app.get('/preview/:cfpid', login.requireAuth, (req, res) => {
    const proposals = db.get('cfps');
    let proposal = proposals.find({ index: req.params.cfpid, writer: req.user, changed: false }).value();

    const user = db.get('users').find({ userId: req.user }).value();

    res.render('proposal/preview', {
        alerts: db.get('alerts').value(),
        title: proposal.titleOfThePresentation,
        abstract: proposal.abstract,
        outline: proposal.outline,
        track: proposal.track,
        duration: proposal.preferredDuration,
        tags: proposal.tags,
        anything: proposal.isThereAnythingElseYoudLikeToCommunicateToUs,
        language: proposal.language,
        coc: proposal.coc,
        cfpid: req.params.cfpid,
        firstName: user.firstName,
        lastName: user.lastName,
        bio: user.speakerBio,
        affiliation: user.affiliation,
        pastExperience: user.pastExperience,
        finished: proposal.finished
    });
});


app.get('/proposals', login.requireAuth, (req, res) => {
    let proposals = db.get('cfps').filter({ writer: req.user, changed: false }).sortBy('index').value();


    res.render("proposal/all", {
        alerts: db.get('alerts').value(),
        proposals: proposals,
        draftIcon: octicons['issue-draft'].toSVG({ height: "1em", width: "1em", "aria-label": "Hint", fill: "currentColor" }),
        doneIcon: octicons['issue-closed'].toSVG({ height: "1em", width: "1em", "aria-label": "Hint", fill: "currentColor" })
    });
});

const logObject = (obj) => {
    console.log(JSON.stringify(obj, null, 4));
};
