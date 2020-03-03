const express = require('express');
const exphbs = require('express-handlebars');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const path = require('path');
const _ = require('lodash');

const app = express();

// To support URL-encoded bodies
app.use(bodyParser.urlencoded({ extended: true }));

// To parse cookies from the HTTP Request
app.use(cookieParser());

app.use(express.static(path.join(__dirname, '/public')));

app.use((req, res, next) => {
    // Get auth token from the cookies
    const authToken = req.cookies['AuthToken'];

    // Inject the user to the request
    req.user = authTokens[authToken];

    next();
});

app.engine('hbs', exphbs({
    extname: '.hbs',
    helpers: {
        breaklines: function (str) {
            return str.replace(/\n/gi, "<br/>").replace(/(https?:\/\/[^\s]+)/g, "<a href=\"\$1\">\$1</a>");
        },
        checked: function (value, test) {
            if (value === undefined) return '';
            return value === test ? 'checked' : '';
        }
    }
}));

app.set('view engine', 'hbs');

app.listen(3000);

app.get('/', function (req, res) {
    res.render('home');
});

app.get('/register', (req, res) => {
    res.render('register');
});

const crypto = require('crypto');

const getHashedPassword = (password, salt) => {
    return crypto.pbkdf2Sync(password, salt, 10000, 512, 'sha512').toString('hex');
};

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('db.json');
const db = low(adapter);

db.defaults({ cfps: [], users: [], scores: [] }).write();

app.post('/register', (req, res) => {
    const { email, firstName, lastName, password, confirmPassword } = req.body;

    // Check if the password and confirm password fields match
    if (password === confirmPassword) {

        // Check if user with the same email is also registered
        if (!_.isEmpty(db.get('users').find({ email: email }).value())) {

            res.render('register', {
                message: 'User already registered.',
                messageClass: 'alert-danger'
            });

            return;
        }


        const salt = crypto.randomBytes(16).toString('hex');
        const hashedPassword = getHashedPassword(password, salt);

        // Store user into the database if you are using one
        db.get('users').push({
            firstName: firstName,
            lastName: lastName,
            email: email,
            salt: salt,
            password: hashedPassword,
            viewBio: false,
            admin: false,
            weight: 1.
        }).write();

        res.render('home', {
            message: 'Registration Complete. Please login to continue.',
            messageClass: 'alert-success'
        });
    } else {
        res.render('register', {
            message: 'Password does not match.',
            messageClass: 'alert-danger'
        });
    }
});

const generateAuthToken = () => {
    return crypto.randomBytes(30).toString('hex');
};

const authTokens = {};

const checkPassword = (email, password) => {
    const existing = db.get('users').find({ email: email }).value();

    if (_.isEmpty(existing))
        return null;
    const hashedPassword = getHashedPassword(password, existing.salt);

    return existing.password === hashedPassword;
};

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const user = checkPassword(email, password);
    if (user) {
        const authToken = generateAuthToken();

        // Store authentication token
        authTokens[authToken] = email;

        // Setting the auth token in cookies
        res.cookie('AuthToken', authToken);

        // Redirect user to the protected page
        res.redirect('/instructions');
    } else {
        res.render('home', {
            message: 'Invalid username or password',
            messageClass: 'alert-danger'
        });
    }
});

const requireAuth = (req, res, next) => {
    if (req.user) {
        next();
    } else {
        res.render('home', {
            message: 'Please home to continue',
            messageClass: 'alert-danger'
        });
    }
};

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

app.get('/cfp', requireAuth, (req, res) => {
    nextCfp(req, res);
});

app.get('/cfp/:cfpid', requireAuth, (req, res) => {
    const cfpdb = db.get('cfps');
    const cfp = cfpdb.nth(parseInt(req.params.cfpid)).value();
    const score = db.get('scores').find({
        reviewer: req.user,
        cfpId: req.params.cfpid
    }).value();
    const user = db.get('users').find({ email: req.user }).value();

    res.render('cfp', {
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
        seeSpeakers: user.viewBio,
        speakerName: cfp.speakerName,
        speakerAffiliation: cfp.affiliation,
        speakerBio: cfp.speakerBio,
        speakerName2: cfp.speakerName2,
        speakerBio2: cfp.speakerBio2,
        speakerAffiliation2: cfp.affiliation2,
        pastExperience: cfp.pastExperience,
        anything: cfp.isThereAnythingElseYoudLikeToCommunicateToUs
    });
});

app.get('/instructions', requireAuth, (req, res) => {
    res.render('instructions');
});

app.post('/instructions', requireAuth, (req, res) => {
    res.redirect('/cfp');
});

app.get('/refuse/:cfpid', requireAuth, (req, res) => {
    const scores = db.get('scores');
    input = req.body;
    scores.push({
        refused: true,
        changed: false,
        reviewer: req.user,
        cfpId: req.params.cfpid,
        score: 0,
        confidence: 0,
        committee: "",
        author: "",
        durationReco: null,
        durationComment: "",
        trackReco: null,
        trackComment: ""
    }).write();

    res.redirect('/cfp');
});

app.post('/cfp', requireAuth, (req, res) => {
    const scores = db.get('scores');
    input = req.body;
    let existing = scores.find({ cfpId: input.cfpId, reviewer: req.user, changed: false }).value();
    const item = {
        refused: false,
        changed: false,
        changeId: _.isEmpty(existing) ? 0 : existing.changeId + 1,
        reviewer: req.user,
        cfpId: input.cfpId,
        score: input.score,
        confidence: input.confidence,
        committee: input.committee,
        author: input.author,
        durationReco: input.durationReco,
        durationComment: input.durationComment,
        trackReco: input.trackReco,
        trackComment: input.trackComment
    };
    scores.push(item).write();
    if (!_.isEmpty(existing)) {
        existing.assign({ changed: true }).write();
    }

    nextCfp(req, res);
});

app.get('/done', requireAuth, (req, res) => {
    const cfpdb = db.get('cfps');

    let reviewed = [];
    let refused = [];
    const scores = db.get('scores').filter({ reviewer: req.user, changed: false }).sortBy('cfpId').value();
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
    res.render('done', {
        reviewed: reviewed,
        refused: refused
    });
});

const logObject = (obj) => {
    console.log(JSON.stringify(obj, null, 4));
};
