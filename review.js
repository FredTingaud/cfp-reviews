const express = require('express');
const exphbs = require('express-handlebars');
const path = require('path');
const _ = require('lodash');
const marked = require('marked');
const login = require('./lib/login');

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

const nextCfp = (req, res) => {
    const cfpdb = db.get('cfps');
    const scores = db.get('scores').filter({ reviewer: req.user });
    const scoreCount = scores.size().value();
    let index = Math.floor(Math.random() * cfpdb.size().value());

    while (scoreCount < cfpdb.size().value() && !_.isEmpty(scores.find({ cfpId: index.toString() }).value())) {
        index = Math.floor(Math.random() * cfpdb.size().value());
    }
    res.redirect('/cfp/' + index);
};

app.get('/cfp', login.requireAuth, (req, res) => {
    nextCfp(req, res);
});

const toReadOnlyReview = (s, cfp) => {
    const user = db.get('users').find({ email: s.reviewer }).value();

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
        timestamp: t.toLocaleString()
    };
};

const enoughReviews = (user, count) => {
    return db.get('scores').filter({
        reviewer: user,
        changed: false,
        refused: false
    }).size().value() >= count;
}

app.get('/cfp/:cfpid', login.requireAuth, (req, res) => {
    const cfpdb = db.get('cfps');
    const cfp = cfpdb.nth(parseInt(req.params.cfpid)).value();
    let reviews = [];
    const viewBio = enoughReviews(req.user, 10);
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
    }

    res.render('review/cfp', {
        index: req.params.cfpid,
        title: cfp.titleOfThePresentation,
        abstract: cfp.abstract,
        outline: cfp.outline,
        track: cfp.track,
        duration: cfp.preferredDuration,
        otherDurations: cfp.otherPossibleDurations,
        score: score && score.score,
        confidence: score && score.confidence,
        committee: score && score.committee,
        author: score && score.author,
        durationReco: score && score.durationReco || cfp.preferredDuration,
        durationComment: score && score.durationComment,
        trackReco: score && score.trackReco || cfp.track,
        trackComment: score && score.trackComment,
        seeSpeakers: viewBio,
        speakerName: cfp.speakerName,
        speakerAffiliation: cfp.affiliation,
        speakerBio: cfp.speakerBio,
        speakerName2: cfp.speakerName2,
        speakerBio2: cfp.speakerBio2,
        speakerAffiliation2: cfp.affiliation2,
        pastExperience: cfp.pastExperience,
        anything: cfp.isThereAnythingElseYoudLikeToCommunicateToUs,
        reviews: reviews
    });
});

app.get('/instructions', login.requireAuth, (req, res) => {
    res.render('review/instructions');
});

app.post('/instructions', login.requireAuth, (req, res) => {
    res.redirect('/cfp');
});

app.get('/refuse/:cfpid', login.requireAuth, (req, res) => {
    const scores = db.get('scores');
    input = req.body;
    let existing = scores.find({ cfpId: input.cfpId, reviewer: req.user, changed: false });
    if (!_.isEmpty(existing.value())) {
        existing.assign({ changed: true }).write();
    }
    scores.push({
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
        trackReco: null,
        trackComment: "",
        timestamp: Date.now()
    }).write();

    res.redirect('/cfp');
});

app.post('/cfp', login.requireAuth, (req, res) => {
    const scores = db.get('scores');
    input = req.body;
    let existing = scores.find({ cfpId: input.cfpId, reviewer: req.user, changed: false });
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
        timestamp: Date.now()
    };
    if (!_.isEmpty(existing.value())) {
        existing.assign({ changed: true }).write();
    }
    scores.push(item).write();

    nextCfp(req, res);
});

app.get('/done', login.requireAuth, (req, res) => {
    const cfpdb = db.get('cfps');

    const scores = db.get('scores').filter({ reviewer: req.user, changed: false }).sortBy('cfpId').value();
    if (scores.length >= 10) {
        res.redirect('/overview');
        return;
    }
    let reviewed = [];
    let refused = [];
    scores.forEach(function (score) {
        const cfp = cfpdb.nth(parseInt(score.cfpId)).value();
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
        reviewed: reviewed,
        refused: refused,
    });
});

app.get('/overview', login.requireAuth, (req, res) => {
    const cfpdb = db.get('cfps').value();
    const scores = db.get('scores');

    let reviews = [];
    cfpdb.forEach(function (cfp, id) {
        const count = scores.filter({ cfpId: id.toString(), changed: false, refused: false }).size().value();
        const mine = scores.find({cfpId: id.toString(), changed: false, reviewer: req.user}).value();
        reviews.push({
            cfpId: id.toString(),
            title: cfp.titleOfThePresentation,
            count: count,
            reviewed: mine && !mine.refused,
            refused: mine &&  mine.refused
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
        reviews: reviews
    });
});

app.get('/account', login.requireAuth, (req, res) => {
    const user = db.get('users').find({ email: req.user }).value();

    res.render('login/account', {
        admin: user.admin,
        mail: req.user,
        firstName: user.firstName,
        lastName: user.lastName
    });
});

app.post('/account', login.requireAuth, (req, res) => {
    const { firstName, lastName, password, confirmPassword } = req.body;
    const user = db.get('users').find({ email: req.user });

    if (password && password === confirmPassword) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hashedPassword = getHashedPassword(password, salt);

        user.assign({
            salt: salt,
            password: hashedPassword
        }).write;

    }
    user.assign({
        firstName: firstName,
        lastName: lastName
    }).write();

    res.redirect('/account');
});

app.get('/db-fix', login.requireAuth, (req, res) => {
    res.redirect('/account');
});

const logObject = (obj) => {
    console.log(JSON.stringify(obj, null, 4));
};
