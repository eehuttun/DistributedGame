var http = require('http');
var fs = require('fs');
var server_port = process.argv[2];

/* GAME SERVER (uses Node.js to implement the server)
   Game server handles the game sessions and chat channels.
   Each session has list of the players addresses and session key.
   Each chat channel has subscribers and chat messages are submitted here
   to be forwarded to the subscribers.
*/

var sessions = [];
var chatChannels = [];
var sessionCounter = 0;

//================================================
//=============== CHAT CHANNELS ==================
//================================================

function createChannel(name) {
    var channel = {};
    channel.name = name;
    channel.subscribers = [];
    chatChannels.push(channel)
    console.log(chatChannels)
};

function destroyChannel(i) {
    chatChannels.splice(i,1)
};

function joinChannel(name, port) {
    var k = getChannelByName(name);
    if (k == -1) return;
    //find if already subscribed
    for (var j = 0; j < chatChannels[k].subscribers.length; j++) {
        if (port == chatChannels[k].subscribers[j]) return;
    }
    chatChannels[k].subscribers.push(port);
    console.log(port + " joined channel " + name);
    console.log(chatChannels[k]);
};

// send a message to all of the subscribers of the channel spesified in the message
function messageBreaker(message) {
    var i = getChannelByName(message.channel);
    if (i == -1) return;
    message.type = "CHAT"
    message = JSON.stringify(message);
    for (var j = 0; j < chatChannels[i].subscribers.length; j++) {
        //forward the message to all subscribers
        var options = {
                host: 'localhost',
                path: '/',
                port: chatChannels[i].subscribers[j],
                method: 'POST'
            };
        var req = http.request(options, function() {});
        req.on('error' , (e) => {});
        req.write(message);
        req.end();
    }
};

function getChannelByName(name) {
    var k = -1;
    for (var i = 0; i < chatChannels.length; i++) {
        if (chatChannels[i].name == name) {
            k = i;
            break;
        }
    }
    if (k == -1) {
        console.log("chat channel '" + name + "' does not exist")
    }
    return k;
    
};

//================================================
//========== GAMESERVER SESSIONS =================
//================================================

function create_game_session(message) {
    var session = {};
    session.players = [];
    session.players[0] = {"index" : 0, "port" : message.port };
    session.id = sessionCounter;
    sessionCounter++;
    session.secret = message.secret;
    sessions.push(session);
    //create secure chat channel for session
    createChannel("session" + session.id);
    joinChannel("session" + session.id, message.port)
    console.log("Session "+session.id+" created");
};

function join_game_session(message) {
    for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].id == message.id && sessions[i].players.length < 4) {
            var player = {};
            player.index = sessions[i].players.length;
            player.port = message.port;
            sessions[i].players.push(player)
            
            joinChannel("session" + i, message.port);
            console.log("Player "+message.port+" joined session "+sessions[i].id);
        }
    }
};

function start_game_session(message) {
    var session;
    var player;
    for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].id == message.id) {
            session = sessions[i];
            // send session information to all of the players and tell them to
            // start the session by initializing the state of the game
            for (var j = 0; j < session.players.length; j++) {
                player = session.players[j];
                var options = {
                        host: 'localhost',
                        path: '/',
                        port: player.port,
                        method: 'POST'
                    };
                var req = http.request(options, function() {
                    
                });
                var data = {};
                data.type = "START";
                data.session = session;
                data = JSON.stringify(data)
                req.write(data);
                req.end();
            }
        }
    }
};

function destroy_game_session(message) {
    for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].id == message.id) {
            sessions.splice(i,1)
            console.log("Session "+message.id+" destroyed");
        }
    }
};

//================================================
//============= MESSAGE HANDLING =================
//================================================

// process the received message depending on the message type
function process_message(message) {
    message = JSON.parse(message);
    switch(message.type) {
        case "CREATE_SESSION":
            create_game_session(message);
            break;
        case "START_SESSION":
            start_game_session(message);
            break;
        case "JOIN_SESSION":
            join_game_session(message);
            break;
        case "DESTROY_SESSION":
            destroy_game_session(message);
            break;
        case "CREATE_CHAT":
            createChannel(message.name);
            break;
        case "JOIN_CHAT":
            joinChannel(message.id, message.source);
            break;
        case "DESTROY_CHAT":
            destroyChannel(message.id);
            break;
        case "CHAT_MESSAGE":
            messageBreaker(message);
            break;
    }
};

function init() {
    createChannel("general chat");
};

init();

http.createServer(function (req, res) {
    console.log(req.method);
    
    //fetch the sessions from the server
    if (req.method == "GET" ) {
        res.writeHead(200, {'Content-Type':'text/plain',
                            'Access-Control-Allow-Origin':'*'} );
        var data = JSON.stringify(sessions);
        res.end(data);
    }
    //receive post from nodes
    if (req.method == "POST" ) {
        var body = '';
        req.on('data', function(chunk) {
            body += chunk;
        });
        req.on('end', function() {
            //process message and send OK as a response
            process_message(body);

            res.writeHead(200, {'Content-Type':'text/plain',
                                'Access-Control-Allow-Origin':'*'} );
            res.end("OK");
        });
    }
}).listen(parseInt(server_port));

console.log('Game server running at http:/localhost:' + server_port + '/');