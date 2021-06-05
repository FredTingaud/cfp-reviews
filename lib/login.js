const _ = require('lodash');
const cookieParser = require('cookie-parser');
const shortid = require('shortid');

const requireAuth = (req, res, next) => {
    if (req.user) {
        next();
    } else {
        res.render('login/home', {
            message: 'Please login to continue',
            messageClass: 'alert-danger'
        });
    }
};

const prepareLogin = (app, db) => {
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
        res.render('login/home');
    });

    app.get('/register', (req, res) => {
        res.render('login/register');
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
                userId: shortid.generate(),
                weight: 1.
            }).write();

            res.render('login/home', {
                message: 'Registration Complete. Please login to continue.',
                messageClass: 'alert-success'
            });
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
            res.redirect('/instructions');
        } else {
            res.render('login/home', {
                message: 'Invalid username or password',
                messageClass: 'alert-danger'
            });
        }
    });
    
app.get('/account', requireAuth, (req, res) => {
    const user = db.get('users').find({ userId: req.user }).value();

    res.render('login/account', {
        admin: user.admin,
        mail: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        bio: user.speakerBio
    });
});

app.post('/account', requireAuth, (req, res) => {
    const { firstName, lastName, password, confirmPassword, bio } = req.body;
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
        firstName: firstName,
        lastName: lastName,
        speakerBio: bio
    }).write();

    res.redirect('/account');
});

}

exports.prepareLogin = prepareLogin;
exports.requireAuth = requireAuth;