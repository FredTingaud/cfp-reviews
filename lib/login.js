const express = require('express');
const _ = require('lodash');
const cookieParser = require('cookie-parser');
const shortid = require('shortid');
const octicons = require("@primer/octicons");
const path = require('path');
const exphbs = require('express-handlebars');
const marked = require('marked');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const prepareLogin = (app, db, home) => {
    const requireAuth = (req, res, next) => {
        if (req.user) {
            next();
        } else {
            home(req, res, { message: 'Please login to continue', class: 'danger' });
        }
    };

    // To support URL-encoded bodies
    app.use(express.urlencoded({ extended: true }));

    app.use(express.static(path.join(__dirname, '../public')));

    app.set('view engine', 'hbs');

    app.engine('hbs', exphbs({
        extname: '.hbs',
        helpers: {
            input_long: function (str) {
                return DOMPurify.sanitize(marked((str || "").trim()));
            },
            input_short: function (str) {
                return DOMPurify.sanitize(marked.parseInline((str || "").trim()));
            },
            checked: function (value, test) {
                if (value === undefined) return '';
                return value === test ? 'checked' : '';
            },
            icon: function (name, tooltip, color) {
                return octicons[name].toSVG({ height: "1em", width: "1em", "aria-label": tooltip, fill: color ? color : "currentColor" });
            }
        }
    }));

    const TAGS = ["tooling", "testing", "refactoring", "libraries", "STL", "C++ evolution",
        "accessibility", "soft skills", "language", "essentials", "performance",
        "modules", "concepts", "pattern matching", "metaprogramming", "contracts", "spaceship operator"];

    db.defaults({ cfps: [], users: [], scores: [], tags: TAGS.map(t => ({ value: t, count: 0, checked: true })), alerts: [] }).write();

    // To parse cookies from the HTTP Request
    app.use(cookieParser());

    app.use((req, res, next) => {
        // Get auth token from the cookies
        const authToken = req.cookies['AuthToken'];

        // Inject the user to the request
        req.user = authTokens[authToken];

        next();
    });

    app.get('/', function (req, res) {
        home(req, res);
    });

    app.get('/register', (req, res) => {
        res.render('login/register', { alerts: db.get('alerts').value() });
    });

    const crypto = require('crypto');

    const getHashedPassword = (password, salt) => {
        return crypto.pbkdf2Sync(password, salt, 10000, 512, 'sha512').toString('hex');
    };

    app.post('/register', (req, res) => {
        const { email, firstName, lastName, password, confirmPassword } = req.body;

        // Check if the password and confirm password fields match
        if (password === confirmPassword) {

            // Check if user with the same email is also registered
            if (!_.isEmpty(db.get('users').find({ email: email }).value())) {

                res.render('login/register', {
                    alerts: db.get('alerts').value(),
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
                admin: _.isEmpty(db.get('users').value()),
                userId: shortid.generate(),
                timestamp: Date.now(),
                weight: 1.
            }).write();

            home(req, res, {message: 'Registration Complete. Please login to continue.', class:'success'});
        } else {
            res.render('login/register', {
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
        const { email, password, userId } = req.body;
        const valid = checkPassword(email, password);
        if (valid) {
            const user = db.get('users').find({ email: email }).value();
            const authToken = generateAuthToken();

            // Store authentication token
            authTokens[authToken] = user.userId;

            // Setting the auth token in cookies
            res.cookie('AuthToken', authToken);

            // Redirect user to the protected page
            res.redirect('/');
        } else {
            home(req, res, {
                message: 'Invalid username or password',
                class: 'danger'
            });
        }
    });

    app.get('/disconnect', (req, res) => {
        res.clearCookie('AuthToken');
        res.redirect('/');
    });

    displayAllTags = (res) => {
        const tags = db.get('tags').value();
        res.render('login/tags', {
            alerts: db.get('alerts').value(),
            tags: tags,
            checkedIcon: octicons['check-circle-fill'].toSVG({ height: "1em", width: "1em", "aria-label": "Checked", fill: "currentColor" }),
            uncheckedIcon: octicons['issue-draft'].toSVG({ height: "1em", width: "1em", "aria-label": "Unchecked", fill: "currentColor" })
        });
    };

    app.get('/tags', requireAuth, (req, res) => {
        const user = db.get('users').find({ userId: req.user }).value();
        if (user.admin) {
            displayAllTags(res);
        } else {
            home(req, res, {
                message: 'You don\'t have rights to access this page',
                class: 'danger'
            });
        }

    });

    app.post('/tags', requireAuth, (req, res) => {
        const user = db.get('users').find({ userId: req.user }).value();
        if (user.admin) {

            const tag = req.body.check;
            if (tag)
                db.get('tags').find({ value: tag }).assign({ checked: true }).write();
            else
                db.get('tags').find({ value: req.body.uncheck }).assign({ checked: false }).write();
            displayAllTags(res);
        } else {
            home(req, res, {
                message: 'You don\'t have rights to access this page',
                class: 'danger'
            });
        }

    });

    displayAllUsers = (req, res) => {
        const users = db.get('users').filter(u => u.userId !== req.user).value();
        res.render('login/users', {
            alerts: db.get('alerts').value(),
            users: users.map(u => ({ ...u, timestamp: new Date(u.timestamp).toLocaleString() })),
            adminIcon: octicons['tools'].toSVG({ height: "1em", width: "1em", "aria-label": "Admin", fill: "currentColor" }),
            editIcon: octicons['pencil'].toSVG({ height: "1em", width: "1em", "aria-label": "Edit", fill: "currentColor" })
        });
    };

    app.get('/users', requireAuth, (req, res) => {
        const user = db.get('users').find({ userId: req.user }).value();
        if (user.admin) {
            displayAllUsers(req, res);
        } else {
            home(req, res, {
                message: 'You don\'t have rights to access this page',
                class: 'danger'
            });
        }
    });

    app.post('/email', requireAuth, (req, res) => {
        const caller = db.get('users').find({ userId: req.user }).value();
        if (caller.admin) {
            const { mail, userId } = req.body;
            const user = db.get('users').find({ userId: userId });

            user.assign({
                email: mail,
            }).write();

            res.redirect('/users');
        } else {
            home(req, res, {
                message: 'You don\'t have rights to access this page',
                class: 'danger'
            });
        }

    });

    app.post('/users', requireAuth, (req, res) => {
        const caller = db.get('users').find({ userId: req.user }).value();
        if (caller.admin) {
            if (req.body.email) {
                const mailId = req.body.email;
                const mail = db.get('users').find({ userId: mailId }).value();
                res.render('login/emailChange', {
                    alerts: db.get('alerts').value(),
                    userId: mailId,
                    mail: mail.email,
                    firstName: mail.firstName,
                    lastName: mail.lastName
                });
                return;
            }
            if (req.body.admin)
                db.get('users').find({ userId: req.body.admin }).assign({ admin: true }).write();
            else if (req.body.unadmin)
                db.get('users').find({ userId: req.body.unadmin }).assign({ admin: false }).write();
            else if (req.body.bio)
                db.get('users').find({ userId: req.body.bio }).assign({ viewBio: true }).write();
            else if (req.body.unbio)
                db.get('users').find({ userId: req.body.unbio }).assign({ viewBio: false }).write();

            displayAllUsers(req, res);
        } else {
            home(req, res, {
                message: 'You don\'t have rights to access this page',
                class: 'danger'
            });
        }
    });

    app.get('/account', requireAuth, (req, res) => {
        const user = db.get('users').find({ userId: req.user }).value();

        res.render('login/account', {
            alerts: db.get('alerts').value(),
            adviceIcon: octicons['light-bulb'].toSVG({ height: "1em", width: "1em", "aria-label": "Hint", fill: "currentColor" }),
            userId: req.user,
            admin: user.admin,
            mail: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            bio: user.speakerBio,
            affiliation: user.affiliation,
            pastExperience: user.pastExperience
        });
    });

    app.post('/account', requireAuth, (req, res) => {
        const { firstName, lastName, password, confirmPassword, bio, mail, affiliation, pastExperience } = req.body;
        const user = db.get('users').find({ userId: req.user });

        if (password && password === confirmPassword) {
            const salt = crypto.randomBytes(16).toString('hex');
            const hashedPassword = getHashedPassword(password, salt);

            user.assign({
                salt: salt,
                password: hashedPassword
            }).write;

        }
        user.assign({
            email: mail,
            firstName: firstName,
            lastName: lastName,
            speakerBio: bio,
            affiliation: affiliation,
            pastExperience: pastExperience
        }).write();

        res.redirect('/');
    });

    displayAlerts = (req, res) => {
        const alerts = db.get('alerts').value();
        res.render('login/alerts', {
            alerts: alerts,
            addIcon: octicons['plus'].toSVG({ height: "1em", width: "1em", "aria-label": "Add", fill: "currentColor" }),
            removeIcon: octicons['trash'].toSVG({ height: "1em", width: "1em", "aria-label": "Remove", fill: "currentColor" }),
            editIcon: octicons['pencil'].toSVG({ height: "1em", width: "1em", "aria-label": "Edit", fill: "currentColor" })
        });
    };

    app.get('/alerts', requireAuth, (req, res) => {
        const user = db.get('users').find({ userId: req.user }).value();
        if (user.admin) {
            displayAlerts(req, res);
        } else {
            home(req, res, {
                message: 'You don\'t have rights to access this page',
                class: 'danger'
            });
        }
    });

    app.post('/alerts', requireAuth, (req, res) => {
        const caller = db.get('users').find({ userId: req.user }).value();
        if (caller.admin) {
            const alerts = db.get('alerts');
            if (req.body.changeAlert) {
                const val = req.body.changeAlert.split('/');
                alerts.find({ alertId: val[1] }).assign({ class: val[0] }).write();
            } else if (req.body.change) {
                alerts.find({ alertId: req.body.change }).assign({ message: req.body['message-' + req.body.change] }).write();
            } else if (req.body.remove) {
                alerts.remove(a => a.alertId === req.body.remove).write();
            } else if (req.body.add) {
                alerts.push({ alertId: shortid.generate(), class: req.body.alertClass, message: req.body.message }).write();
            }

            displayAlerts(req, res);
        } else {
            home(req, res, {
                message: 'You don\'t have rights to access this page',
                class: 'danger'
            });
        }
    });

    return requireAuth;
}

exports.prepareLogin = prepareLogin;
