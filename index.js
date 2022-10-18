var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var config = {
    secure: false,
    url: '127.0.0.1',
    port: 3000,
    correct: 4, // amount of points player receives for a correct answer
    wrong: 1,
    wrongAnswerPointsEveryone: true, // enabled = on wrong answer, everyone else receives "wrong" amount of points - otherwise "wrong" amount of points substract,
    moderatorSecret: makeid(5),
    colors: [
        "#03C604",
        "#6868DC",
        "#FE5858",
        "#49B84A",
        "#FCFF00",
        "#DAA520",
        "#DB5B5B",
        "#FF0000",
        "#0000FF",
        "#008001",
        "#B32222",
        "#FF7F4F",
        "#FF4500",
        "#2E8B58",
        "#DAA521",
        "#D1691E",
        "#609EA0",
        "#1C90FF",
        "#FF68B4",
        "#8A2BE2",
        "#02FF7F"
    ]
}

var currentConnections = {};
var buzzered = {
    active: false,
    name: null
}

var guess = false; // if guessing field is locked / unlocked ?
var gameConfig = {
    guess: false
}

http.listen(config.port, function () {
    console.log(`///\nRaved's Gameshow started on ${config.url}:${config.port}\nJoin as moderator: ${config.secure ? "https://" : "http://" }${config.url}:${config.port}?secret=${config.moderatorSecret}\nJoin as player: ${config.secure ? "https://" : "http://" }${config.url}:${config.port}\n///`)
});

app.use('/static', express.static(__dirname + '/public'));

app.get('/api', function (req, res) {
    res.json(getUsers())
})

app.get('/', function (req, res) {
    res.sendFile(__dirname+'/viewer.html')
});


io.on('connection', function (socket, name) {
    currentConnections[socket.id] = {socket: socket};
    currentConnections[socket.id].data = {};

    io.emit('playerConnect', { for: 'everyone' });

    socket.on('forceDisconnect', function() {
        socket.disconnect()
    })

    socket.on('disconnect', function () {
        if (currentConnections[socket.id] === undefined) return;
        currentConnections[socket.id].data.connected = false

        // No players / moderators anymore
        if (getUsers().length === 0) {
            buzzered.active = false;
            buzzered.name = null;
            console.log("\n\nNo players // resetting game!")
            config.moderatorSecret = makeid(5);
            console.log("Moderator Secret: http://127.0.0.1:3000?secret="+config.moderatorSecret)
            currentConnections = {};
            return;
        }

        // No moderators anymore
        // if (getUsers().filter(entry => entry.role === "moderator").length === 0)

        // If buzzered and player who buzzered disconnects
        if (buzzered.active && buzzered.name !== null) {
            if (getUsers().filter(entry => entry.name === buzzered.name).length === 0) {
                buzzered.active = false;
                buzzered.name = null;
            }
        }

        io.emit('playerDisconnect', getUsers(false, true), gameConfig, { for: 'everyone' });

        if (buzzered.active && buzzered.name !== null) {
            // Make sure it's called AFTER update players list
            io.emit('setActiveBuzzer', buzzered.name, getUsers(true))
        }
    })

    socket.on('playerJoin', function (username, secret) {
        let role = "player";
        if (secret && secret === config.moderatorSecret) {
            // Delete Token after redemption
            config.moderatorSecret = makeid(20); // ungessable token!
            console.log("Moderator Secret Redeemed!")
            role = "moderator";
        }
        // if (getUsers(true).length == 0) role = "moderator";

        if (username.length == 0) {
            return socket.emit('error', "Please enter a username", {for: 'everyone'})
        }

        if (getUsers(true).filter(entry => entry.name === username).length === 1 && getUsers(true).filter(entry => entry.name === username && entry.connected === true).length === 1) {
            return socket.emit('error', "Username already taken!", {for: 'everyone'})
        }

        if (getUsers(true).filter(entry => entry.name === username && entry.connected === false).length === 1) {
            // User reconnected

            let old = Object.values(currentConnections).filter(entry => entry.data.name === username && entry.data.connected === false)[0];

            const clone = JSON.parse(JSON.stringify(old.data))

            currentConnections[socket.id].data = clone;
            currentConnections[socket.id].data.connected = true

            old.data = []
            delete Object.values(currentConnections).filter(entry => entry.data.name === username && entry.data.connected === false)

        } else {
            // New user
            currentConnections[socket.id].data = {
                name: username,
                color: config.colors[Math.floor(Math.random()*config.colors.length)],
                role: role,
                points: 0,
                guess: "",
                connected: true
            }
        }

        io.emit('playerJoin', getUsers(false, true), gameConfig);

        if (buzzered.active && buzzered.name !== null) {
            // Make sure it's called AFTER update players list
            io.emit('setActiveBuzzer', buzzered.name, getUsers())
        }
    })

    socket.on('buzzered', function (username) {
        if (buzzered.active || getUsers().filter(entry => entry.role == "moderator").length <= 0) return;
        buzzered.active = true;
        buzzered.name = username;

        io.emit('buzzered', getUserByUsername(username), getUsers(), {for: 'everyone'});
    })

    socket.on('wrong', function (buzzered__name) {
        buzzered.active = false;
        buzzered.name = null;

        if (config.wrongAnswerPointsEveryone) {
            let users = getUsers();
            users = users.filter(entry => entry.name !== buzzered__name && entry.role !== "moderator")

            for (const user of users)
                user.points += config.wrong;
        } else {
            const user = getUserByUsername(buzzered__name)
            if (user === undefined) return;
            if (user)
                user.points -= config.wrong;
        }

        io.emit('wrongAnswered', getUsers(false ,true), buzzered__name, gameConfig)
    })

    socket.on('correct', function (buzzered__name) {
        buzzered.active = false;
        buzzered.name = null;

        const user = getUserByUsername(buzzered__name)
        if (user === undefined) return;
        if (user)
            user.points += config.correct;

        io.emit('correctAnswered', getUsers(false, true), buzzered__name, gameConfig)
    })

    socket.on('nopoints', function (username) {
        buzzered.active = false;
        buzzered.name = null;
        io.emit('nopointsAnswered', getUsers(false, true), username, gameConfig)
    })

    socket.on('updatepoints', function (username, points) {
        const user = getUserByUsername(username)
        if (user === undefined) return;

        user.points = points;
        io.emit('nopointsAnswered', getUsers(false, true), username, gameConfig)
    })

    socket.on('lockGuessing', function() {
        guess = false;
        gameConfig.guess = false;
        io.emit('lockGuessing')
    });

    socket.on('unlockGuessing', function() {
        guess = true;
        gameConfig.guess = true;
        io.emit('unlockGuessing')
    });

    socket.on('updateGuess', function(data) {
        if (guess === false) return;

        const user = getUserByUsername(data.username)
        if (user === undefined) return;

        user.guess = data.value;
        io.emit('updateGuess', {
            value: data.value,
            username: data.username
        })
    });

       function getUserByUsername(username) {
        const users = getUsers(true);
        return users.filter(user => user.name === username)[0]
    }
});

function getUsers(disconnected, sorted) {
    let users = Object.values(currentConnections).map(entry => entry.data);
    users = users.filter(value => Object.keys(value).length !== 0);
    if (!disconnected) users = users.filter(entry => entry.connected) // only return connected clients!
    if (sorted) {
        const usersWithoutModerators = users.filter(entry => entry.role !== "moderator");
        const usersOnlyModerators = users.filter(entry => entry.role === "moderator");
        users = (usersOnlyModerators.sort( function( a, b ) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0 })).concat((usersWithoutModerators.sort( function( a, b ) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0 })));
    }
    return users
}

function makeid(length) {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() *
            charactersLength));
    }
    return result;
}
