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
        let admin;
        if (hasUser) {
            const user = db.get('users').find({ userId: req.user }).value();
            welcome = user.firstName + " " + user.lastName;
            admin = user.admin;
        }

        res.render('review/instructions', {
            alerts: [].concat(message).concat(db.get('alerts').value()),
            hasUser: hasUser,
            welcome: welcome,
            admin: admin
        });
    };

    const { requireAuth, requireAdmin } = login.prepareLogin(app, db, home);

    const nextCfp = (req, res) => {
        const scores = db.get('scores').filter({ reviewer: req.user });
        const cfpdb = db.get('cfps').filter(c => !c.changed && c.finished && _.isEmpty(scores.find({ cfpId: c.index }).value()));

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
            version: s.version,
            timestamp: t.toLocaleString()
        };
    };

    const canViewBio = (user) => {
        const userValue = db.get('users').find({ userId: user }).value();
        return (userValue.viewBio || userValue.admin);
    }

    app.get('/cfp/:cfpid', requireAuth, (req, res) => {
        const cfpdb = db.get('cfps');
        const cfp = cfpdb.find({ index: req.params.cfpid, changed: false, finished: true }).value();
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
            version: cfp.changeId,
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
            possibleTags: tagsUtil.possibleTags(score ? score.tags : null, db),
            admin: db.get('users').find({ userId: req.user }).value().admin
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
        input = req.body;
        if (db.get('cfps').find({ index: input.cfpId }).value().writer.some(w => w.id === req.user)) {
            home(req, res, {
                message: 'You can\'t review your own talks',
                class: 'danger'
            });
            return;
        }
        const scores = db.get('scores');
        let existing = scores.find({ cfpId: input.cfpId, reviewer: req.user, changed: false });
        const tags = tagsUtil.cleanTags(input.tagsReco);

        const item = {
            refused: false,
            changed: false,
            changeId: _.isEmpty(existing.value()) ? 0 : existing.value().changeId + 1,
            version: parseInt(input.changeId, 10),
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

        if (canViewBio(req.user))
            res.redirect('/cfp/' + input.cfpId);
        else
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
            const cfp = cfpdb.find({ index: score.cfpId, changed: false, finished: true }).value();
            if (score.refused) {
                refused.push({
                    cfpId: score.cfpId,
                    title: cfp.titleOfThePresentation
                });
            } else {
                reviewed.push({
                    cfpId: score.cfpId,
                    title: cfp.titleOfThePresentation,
                    uptodate: cfp.changeId === score.version
                });
            }
        });
        res.render('review/done', {
            alerts: db.get('alerts').value(),
            reviewed: reviewed,
            refused: refused,
            admin: db.get('users').find({ userId: req.user }).value().admin
        });
    });

    app.get('/overview', requireAuth, (req, res) => {
        const cfpdb = db.get('cfps').filter({ changed: false, finished: true }).value();
        const scores = db.get('scores');
        const bio = canViewBio(req.user);

        let reviews = [];
        cfpdb.forEach(function (cfp) {
            const count = scores.filter({ cfpId: cfp.index, changed: false, refused: false }).size().value();
            const mine = scores.find({ cfpId: cfp.index, changed: false, reviewer: req.user }).value();
            const author = mine && bio ? cfp.writer.map(w => {
                const a = db.get('users').find({ userId: w.id }).value();
                return a.firstName + ' ' + a.lastName;
            }).join(', ') : '?';
            reviews.push({
                cfpId: cfp.index,
                title: cfp.titleOfThePresentation,
                author: author,
                count: count,
                reviewed: mine && !mine.refused,
                refused: mine && mine.refused,
                uptodate: !mine || mine.refused || mine.version === cfp.changeId
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

        const reviewed = reviews.filter(r => r.reviewed).length;
        const total = reviews.filter(r => !r.refused).length;
        res.render('review/all', {
            alerts: db.get('alerts').value(),
            reviews: reviews,
            reviewed: reviewed,
            total: total,
            percent: reviewed / total * 100,
            admin: db.get('users').find({ userId: req.user }).value().admin
        });
    });

    app.get('/db-fix', requireAuth, (req, res) => {
        res.redirect('/account');
    });

    function median(numbers) {
        if (numbers.length === 0)
            return 0;

        const sorted = numbers.slice().sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);

        if (sorted.length % 2 === 0) {
            return (sorted[middle - 1] + sorted[middle]) / 2;
        }

        return sorted[middle];
    }

    app.get('/stats', requireAdmin, (req, res) => {
        const cfps = db.get('cfps').filter({ changed: false, finished: true }).value();
        const total = cfps.length;
        const produce = cfps.filter(c => c.track === 'Produce').length;
        const progress = cfps.filter(c => c.track === 'Progress').length;
        const push = cfps.filter(c => c.track === 'Push Forward').length;
        const english = cfps.filter(c => c.language === 'English').length;
        const french = cfps.filter(c => c.language === 'French').length;
        const both = cfps.filter(c => c.language === 'Either').length;
        const shortTalk = cfps.filter(c => c.preferredDuration === '30 minutes').length;
        const longTalk = cfps.filter(c => c.preferredDuration === '60 minutes').length;
        const reviewCounts = cfps.map(c => db.get('scores').filter({ changed: false, refused: false, cfpId: c.index }).value().length);
        const reviewAvg = reviewCounts.reduce((p, c) => p + c) / cfps.length;
        const reviewMed = median(reviewCounts);
        const reviewMin = reviewCounts.reduce((p, c) => Math.min(p, c));
        res.render('review/statistics', {
            alerts: db.get('alerts').value(),
            total: total,
            progress: progress,
            produce: produce,
            push: push,
            english: english,
            french: french,
            both: both,
            shortTalk: shortTalk,
            longTalk: longTalk,
            reviewAvg: reviewAvg,
            reviewMed: reviewMed,
            reviewMin: reviewMin,
            admin: db.get('users').find({ userId: req.user }).value().admin
        })
    });

    const trackStats = (req, track) => {
        let cfpdb = db.get('cfps').filter({ changed: false, finished: true, track: track }).value();
        const proposed = db.get('scores').filter({ changed: false, trackReco: track}).map('cfpId').value();
        cfpdb.push(...proposed.map(p => db.get('cfps').find({ changed: false, finished: true, index: p }).value()).filter(p => p.track !== track));
        const scores = db.get('scores');
        const bio = canViewBio(req.user);

        let reviews = [];
        cfpdb.forEach(function (cfp) {
            const s = scores.filter({ cfpId: cfp.index, changed: false, refused: false }).value();
            const avg = s.map(a => parseInt(a.score)).reduce((p, c) => p + c, 0) / s.length;
            const med = median(s.map(a => parseInt(a.score)));
            const conf = s.map(a => parseInt(a.confidence)).reduce((p, c) => p + c, 0) / s.length;
            const w = s.reduce((p, c) => ({ s: p.s + parseInt(c.score) * parseInt(c.confidence), c: p.c + parseInt(c.confidence) }), { s: 0, c: 0 });
            const weighted = w.s / w.c;
            const count = s.length;
            const trackChange = s.some(s => s.trackReco && s.trackReco !== cfp.track && cfp.track === track);
            const fromTrackChange = s.some(s => s.trackReco && s.trackReco !== cfp.track && cfp.track !== track);
            const timeChange = s.some(s => s.durationReco && s.durationReco !== cfp.preferredDuration);

            const mine = scores.find({ cfpId: cfp.index, changed: false, reviewer: req.user }).value();
            const author = mine && bio ? cfp.writer.map(w => {
                const a = db.get('users').find({ userId: w.id }).value();
                return a.firstName + ' ' + a.lastName;
            }).join(', ') : '?';
            reviews.push({
                cfpId: cfp.index,
                title: cfp.titleOfThePresentation,
                language: cfp.language,
                isShort: cfp.preferredDuration === '30 minutes',
                author: author,
                count: count,
                average: avg,
                median: med,
                confidence: conf,
                weighted: weighted,
                trackChange: trackChange,
                timeChange: timeChange,
                fromTrackChange: fromTrackChange
            });
        });
        reviews.sort((a, b) => b.weighted - a.weighted);
        return reviews;
    }

    app.get('/progress', requireAdmin, (req, res) => {
        res.render('review/track', {
            alerts: db.get('alerts').value(),
            reviews: trackStats(req, 'Progress'),
            admin: db.get('users').find({ userId: req.user }).value().admin
        });
    });
    
    app.get('/push', requireAdmin, (req, res) => {
        res.render('review/track', {
            alerts: db.get('alerts').value(),
            reviews: trackStats(req, 'Push Forward'),
            admin: db.get('users').find({ userId: req.user }).value().admin
        });
    });
    
    app.get('/produce', requireAdmin, (req, res) => {
        res.render('review/track', {
            alerts: db.get('alerts').value(),
            reviews: trackStats(req, 'Produce'),
            admin: db.get('users').find({ userId: req.user }).value().admin
        });
    });
}

const logObject = (obj) => {
};


exports.prepareReview = prepareReview;