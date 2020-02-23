const express = require('express');
const exphbs = require('express-handlebars');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const _ = require('lodash');

const app = express();

// To support URL-encoded bodies
app.use(bodyParser.urlencoded({ extended: true }));

// To parse cookies from the HTTP Request
app.use(cookieParser());

app.use((req, res, next) => {
    // Get auth token from the cookies
    const authToken = req.cookies['AuthToken'];

    // Inject the user to the request
    req.user = authTokens[authToken];

    next();
});

app.engine('hbs', exphbs({
    extname: '.hbs'
}));

app.set('view engine', 'hbs');

// Our requests hadlers will be implemented here...

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
            password: hashedPassword
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
    console.log(`user ${user}`);
    if (user) {
        const authToken = generateAuthToken();

        // Store authentication token
        authTokens[authToken] = user;

        // Setting the auth token in cookies
        res.cookie('AuthToken', authToken);

        // Redirect user to the protected page
        res.redirect('/protected');
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

app.get('/protected', requireAuth, (req, res) => {
    res.render('protected');
});