const express = require('express');
const _ = require('lodash');
const login = require('./login');
const tagsUtil = require('./tags');

const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);


const prepareReview = (app, db) => {
    const home = (req, res, message) => {
        const hasUser = req.user != null;
        let welcome;
        if (hasUser) {
            const user = db.get('users').find({ userId: req.user }).value();
            welcome = user.firstName + " " + user.lastName;
        }

        res.render('review/instructions', {
            alerts: [].concat(message).concat(db.get('alerts').value()),
            hasUser: hasUser,
            welcome: welcome
        });
    };

    const requireAuth = login.prepareLogin(app, db, home);

    const nextCfp = (req, res) => {
        const scores = db.get('scores').filter({ reviewer: req.user });
        const cfpdb = db.get('cfps').filter(c => !c.changed && c.finished && _.isEmpty(scores.find({cfpId: c.index}).value()));

        if (_.isEmpty(cfpdb.value())) {
           res.redirect('/overview');
           return;
        }
        
        const next = cfpdb.nth(Math.floor(Math.random() * cfpdb.size().value())).value();
        let index = next.index;
        if (_.isEmpty(next.writer.filter(w => w.id === req.user))) {
            res.redirect('/cfp/' + index);
        } else {
            res.redirect('/refuse/' + index);
        }
    };

    app.get('/cfp', requireAuth, (req, res) => {
        nextCfp(req, res);
    });

    const toReadOnlyReview = (s, cfp) => {
        const user = db.get('users').find({ userId: s.reviewer }).value();

        const t = new Date();
        t.setTime(s.timestamp);
        return {
            reviewer: user.firstName + " " + user.lastName,
            changed: s.changed,
            score: s.score,
            confidence: s.confidence,
            committee: s.committee,
            author: s.author,
            trackReco: s.trackReco !== cfp.track ? s.trackReco : null,
            trackComment: s.trackComment,
            durationReco: s.durationReco !== cfp.preferredDuration ? s.durationReco : null,
            durationComment: s.durationComment,
            tags: s.tags,
            timestamp: t.toLocaleString()
        };
    };

    const canViewBio = (user) => {
        const userValue = db.get('users').find({ userId: user }).value();
        return (userValue.viewBio || userValue.admin);
    }

    app.get('/cfp/:cfpid', requireAuth, (req, res) => {
        const cfpdb = db.get('cfps');
        const cfp = cfpdb.find({index: req.params.cfpid}).value();
        let reviews = [];
        let viewBio = false;
        let speakers;
        const score = db.get('scores').find({
            reviewer: req.user,
            cfpId: req.params.cfpid,
            changed: false,
            refused: false
        }).value();
        if (!_.isEmpty(score)) {
            reviews = db.get('scores').filter({
                cfpId: req.params.cfpid,
                refused: false
            }).map(s => toReadOnlyReview(s, cfp)).value();
            viewBio = canViewBio(req.user);
            if (viewBio) {
                speakers = cfp.writer.map(w => db.get('users').find({ userId: w.id }).value());
            }
        }
        
        res.render('review/cfp', {
            alerts: db.get('alerts').value(),
            index: req.params.cfpid,
            title: cfp.titleOfThePresentation,
            abstract: cfp.abstract,
            outline: cfp.outline,
            track: cfp.track,
            duration: cfp.preferredDuration,
            tags: cfp.tags,
            otherDurations: cfp.otherPossibleDurations,
            score: score && score.score,
            confidence: score && score.confidence,
            committee: score && score.committee,
            author: score && score.author,
            durationReco: score && score.durationReco || cfp.preferredDuration,
            durationComment: score && score.durationComment,
            trackReco: score && score.trackReco || cfp.track,
            trackComment: score && score.trackComment,
            tagsReco: score && score.tags,
            seeSpeakers: viewBio,
            speakers: speakers,
            anything: cfp.isThereAnythingElseYoudLikeToCommunicateToUs,
            reviews: reviews,
            possibleTags: tagsUtil.possibleTags(score ? score.tags : null, db)
        });
    });

    app.get('/refuse/:cfpid', requireAuth, (req, res) => {
        const scores = db.get('scores');
        input = req.body;
        let existing = scores.find({ cfpId: input.cfpId, reviewer: req.user, changed: false });
        const score = {
            refused: true,
            changed: false,
            changeId: _.isEmpty(existing.value()) ? 0 : existing.value().changeId + 1,
            reviewer: req.user,
            cfpId: req.params.cfpid,
            score: 0,
            confidence: 0,
            committee: "",
            author: "",
            durationReco: null,
            durationComment: "",
            tags: "",
            trackReco: null,
            trackComment: "",
            timestamp: Date.now()
        };
        if (!_.isEmpty(existing.value())) {
            existing.assign({ changed: true }).write();
        }
        scores.push(score).write();

        res.redirect('/cfp');
    });

    app.post('/cfp', requireAuth, (req, res) => {
        const scores = db.get('scores');
        input = req.body;
        let existing = scores.find({ cfpId: input.cfpId, reviewer: req.user, changed: false });
        const tags = tagsUtil.cleanTags(input.tagsReco);

        const item = {
            refused: false,
            changed: false,
            changeId: _.isEmpty(existing.value()) ? 0 : existing.value().changeId + 1,
            reviewer: req.user,
            cfpId: input.cfpId,
            score: input.score,
            confidence: input.confidence,
            committee: input.committee,
            author: input.author,
            durationReco: input.durationReco,
            durationComment: input.durationComment,
            trackReco: input.trackReco,
            trackComment: input.trackComment,
            tags: tags,
            timestamp: Date.now()
        };
        if (!_.isEmpty(existing.value())) {
            existing.assign({ changed: true }).write();
        }
        scores.push(item).write();

        nextCfp(req, res);
    });

    app.get('/done', requireAuth, (req, res) => {
        const cfpdb = db.get('cfps');

        const scores = db.get('scores').filter({ reviewer: req.user, changed: false }).value();
        if (scores.length >= 10) {
            res.redirect('/overview');
            return;
        }
        let reviewed = [];
        let refused = [];
        scores.forEach(function (score) {
            const cfp = cfpdb.find({index: score.cfpId}).value();
            if (score.refused) {
                refused.push({
                    cfpId: score.cfpId,
                    title: cfp.titleOfThePresentation
                });
            } else {
                reviewed.push({
                    cfpId: score.cfpId,
                    title: cfp.titleOfThePresentation
                });
            }
        });
        res.render('review/done', {
            alerts: db.get('alerts').value(),
            reviewed: reviewed,
            refused: refused,
        });
    });

    app.get('/overview', requireAuth, (req, res) => {
        const cfpdb = db.get('cfps').filter({ changed: false, finished: true }).value();
        const scores = db.get('scores');

        let reviews = [];
        cfpdb.forEach(function (cfp) {
            const count = scores.filter({ cfpId: cfp.index, changed: false, refused: false }).size().value();
            const mine = scores.find({ cfpId: cfp.index, changed: false, reviewer: req.user }).value();
            reviews.push({
                cfpId: cfp.index,
                title: cfp.titleOfThePresentation,
                count: count,
                reviewed: mine && !mine.refused,
                refused: mine && mine.refused
            });
        });

        reviews.sort((r1, r2) => {
            let state1 = r1.reviewed ? 0 : (r1.refused ? 2 : 1);
            let state2 = r2.reviewed ? 0 : (r2.refused ? 2 : 1);
            if (state1 === state2) {
                if (r1.count === r2.count) {
                    return r1.cfpId - r2.cfpId;
                }
                return r1.count - r2.count;
            }
            return state1 - state2;
        });
        res.render('review/all', {
            alerts: db.get('alerts').value(),
            reviews: reviews
        });
    });

    app.get('/db-fix', requireAuth, (req, res) => {
        res.redirect('/account');
    });
}

const logObject = (obj) => {
    console.log(JSON.stringify(obj, null, 4));
};


exports.prepareReview = prepareReview;