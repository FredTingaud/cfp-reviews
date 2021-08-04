const express = require('express');
const _ = require('lodash');
const marked = require('marked');
const login = require('./login');
const advices = require('./advices');
const octicons = require("@primer/octicons");
const shortid = require('shortid')
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const tagsUtil = require('./tags');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const prepareProposal = (app, db) => {

    const home = (req, res, message) => {
        const hasUser = req.user != null;
        let welcome;
        let hasProposal;
        if (hasUser) {
            const user = db.get('users').find({ userId: req.user }).value();
            welcome = user.firstName + " " + user.lastName;
            hasProposal = !_.isEmpty(db.get('cfps').filter(cfp => cfp.writer.some(u => u.id === req.user)).value());
        }

        res.render('proposal/instructions', {
            alerts: [].concat(message).concat(db.get('alerts').value()),
            hasProposals: hasProposal,
            hasUser: hasUser,
            welcome: welcome
        });
    };

    const requireAuth = login.prepareLogin(app, db, (req, res, message) => home(req, res, message));

    const renderCFP = (proposal, req, res) => {
        const user = db.get('users').find({ userId: req.user }).value();
        let hasProposals = db.get('cfps').filter(cfp => cfp.writer.some(u => u.id === req.user));
        const writer = proposal.writer ? proposal.writer.filter(w => w.checked || w.id === req.user).map(w => Object.assign({current: w.id === req.user}, db.get('users').find({ userId: w.id }).value())) : [Object.assign({current: true}, user)];
        const uncheckedWriters = proposal.writer ? proposal.writer.filter(w => !w.checked && w.id !== req.user).map(w => w.id).join(',') : "";

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
            otherAdvice: advices.other,
            cfpid: proposal.cfpid,
            writer: writer,
            otherSpeaker: uncheckedWriters,
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
            hasProposals: !_.isEmpty(hasProposals.value()),
            possibleTags: tagsUtil.possibleTags(proposal.tags, db)
        });

    };

    app.get('/cfp/:cfpid', requireAuth, (req, res) => {
        const proposals = db.get('cfps');
        let proposal = proposals.filter({ index: req.params.cfpid, changed: false }).find(cfp => cfp.writer.some(u => u.id === req.user)).value();

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
            writer: proposal.writer,
            cfpid: req.params.cfpid,
            finished: proposal.finished
        }, req, res);
    });

    app.get('/cfp', requireAuth, (req, res) => {
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
        const i = [].concat(input.userId).findIndex(id => user === id);
        userDB.assign({
            firstName: input["firstName" + i],
            lastName: input["lastName" +i],
            speakerBio: input["bio" + i],
            affiliation: input["affiliation" + i],
            pastExperience: input["pastExperience" + i]
        }).write();
    };


    const cancelExisting = (existing, allTags) => {
        existing.value().tags.split(',').forEach(t => allTags.find({ value: t }).update('count', n => n - 1).write());
        allTags.remove(t => t.count <= 0 && !t.checked).write();
        existing.assign({ changed: true }).write();
    };

    app.post('/cfp', requireAuth, (req, res) => {
        input = req.body;

        const proposals = db.get('cfps');
        proposals.remove(v => v.index === input.cfpid && !v.finished).write();
        const tags = tagsUtil.cleanTags(input.tags);
        
        const writers = [].concat(input.userId).map(m => ({id: m, checked: true})).concat(input.otherSpeaker ? input.otherSpeaker.split(',').map(o => ({id: o.trim(), checked: false})) : []);

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
                tags: tags,
                isThereAnythingElseYoudLikeToCommunicateToUs: input.anything,
                language: input.language,
                coc: input.coc,
                writer: writers,
                finished: false,
                timestamp: Date.now()
            }).write();

        } else if (input.cancel) {
            const allTags = db.get('tags');
            let existing = proposals.filter({ index: input.cfpid, changed: false, finished: true }).find(cfp => cfp.writer.some(u => u.id === req.user));

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
                tags: tags,
                isThereAnythingElseYoudLikeToCommunicateToUs: input.anything,
                language: input.language,
                coc: input.coc,
                writer: writers,
                finished: false,
                timestamp: Date.now()
            };

            if (!_.isEmpty(existing.value())) {
                cancelExisting(existing, allTags);
            }

            proposals.push(newLocal).write();

            tags.split(',').forEach(t => upsertTag(t, allTags));
        } else {
            if (!input.coc) {
                return;
            }

            const allTags = db.get('tags');
            let existing = proposals.filter({ index: input.cfpid, changed: false, finished: true }).find(cfp => cfp.writer.some(u => u.id === req.user));

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
                tags: tags,
                isThereAnythingElseYoudLikeToCommunicateToUs: input.anything,
                language: input.language,
                coc: input.coc,
                writer: writers,
                finished: !input.otherSpeaker,
                timestamp: Date.now()
            };

            if (!_.isEmpty(existing.value())) {
                cancelExisting(existing, allTags);
            }

            proposals.push(newLocal).write();

            tags.split(',').forEach(t => upsertTag(t, allTags));
        }

        saveUserUpdates(input, req.user);

        res.redirect('/preview/' + input.cfpid);
    });

    app.get('/preview/:cfpid', requireAuth, (req, res) => {
        const proposals = db.get('cfps');
        let proposal = proposals.filter({ index: req.params.cfpid, changed: false }).find(cfp => cfp.writer.some(u => u.id === req.user)).value();

        const checkedWriters = proposal.writer.filter(w => w.checked || w.id === req.user).map(w => db.get('users').find({ userId: w.id }).value());
        const uncheckedWriters = proposal.writer.filter(w => !w.checked && w.id !== req.user).map(w => w.id);

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
            finished: proposal.finished,
            checkedWriter: checkedWriters,
            uncheckedWriters: uncheckedWriters.join()
        });
    });


    app.get('/proposals', requireAuth, (req, res) => {
        const proposals = db.get('cfps').filter(cfp => !cfp.changed && cfp.writer.some(u => u.id === req.user && u.checked)).map(c => Object.assign(c, {waiting: c.writer.some(w => !w.checked)})).sortBy('index').value();
        const unconfirmed = db.get('cfps').filter(cfp => !cfp.changed && cfp.writer.some(u => u.id === req.user && !u.checked)).sortBy('index').value();
        const hasWaiting = proposals.some(p => p.waiting);
        const hasDraft = proposals.some(p => !p.finished);

        res.render("proposal/all", {
            alerts: db.get('alerts').value(),
            proposals: proposals,
            unconfirmed: unconfirmed,
            hasDraft: hasDraft,
            hasWaiting: hasWaiting,
            draftIcon: octicons['issue-draft'].toSVG({ height: "1em", width: "1em", "aria-label": "Draft", fill: "currentColor" }),
            doneIcon: octicons['issue-closed'].toSVG({ height: "1em", width: "1em", "aria-label": "Submitted", fill: "#44BB44" }),
            sharedIcon: octicons['question'].toSVG({ height: "1em", width: "1em", "aria-label": "To confirm", fill: "#BB5500" }), 
            waitingIcon: octicons['clock'].toSVG({ height: "1em", width: "1em", "aria-label": "Waiting for co-authors confirmation", fill: "#BB9900" })
        });
    });
}

exports.prepareProposal = prepareProposal;
