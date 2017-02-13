var http = require('http');
var CryptoJS = require('crypto-js');
var fs = require('fs');
var server_port = process.argv[2];

/* LOCAL SERVER FOR THE SIMPLE DISTRIBUTED MULTIPLAYER GAME
   (uses Node.js to implement the server)
   uses Node.js to create a server that can communicate 
   with other servers for the game
*/

/* example data formats

dataStorage = {
    "players" : [
        {"location" : { "x" : 0, "y" : 0 },
         "health" : 5,
         "address" : { "ip" : "192.168.0.1",
                       "port" : "8081" },
         "name" : "player1",
         "connection" : {"counter" : 0, "connected" : true}
        },
        {"location" : { "x" : 0, "y" : 0 },
         "health" : 5,
         "address" : { "ip" : "192.168.0.1",
                       "port" : "8082" },
         "name" : "player2",
         "connection" : {"counter" : 0, "connected" : true}
        }
    ],
    "vector_clock" : [0, 0]
}

message = {
    
    index : playerIndex,
    type : 'EVENT'
    source : 'client' or 'server',
    data : {'x': dx,
            'y': dy,
            'eventId': latest event count}

}    

sessions = [
    { players : [ {index : 0, port : 0},
                  {index : 1, port : 1} ]
      id : 0 }
]
           
*/

var secret;
var initialized = false;

var eventQueue = [];
var chatQueue = [];
var ackQueue = [];
var waitQueue = [];
var log = [];

function init() {
    
    //initialize 'database'
    var dataStorage = NaN;
    var sdata = JSON.stringify(dataStorage);
    fs.writeFileSync('data'+server_port+'.json', sdata);
    
    //check if the player is in session from the game server
    http.get('http://localhost:9000/', (res) => {
       var body = '';
       res.on('data' , function (chunk) {
           body += chunk;
       });
       res.on('end', function() {
           var sessions = JSON.parse(body);
           var session = '';
           //check if player is in session
           for (var i = 0; i < sessions.length; i++) {
               var players = sessions[i].players;
               for (var j = 0; j < players.length; j++) {
                   if (players[j].port == server_port) {
                       session = sessions[i];
                   }
               }
           }
           //update the game state if in session
           if (session != '') updateGameState(session);
       });
    });
};

function getOwnPlayerIndex(data) {
    state = JSON.parse(data);
    for (var i = 0; i < state.players.length; i++) {
        if(state.players[i].address.port == server_port) {
            return i;
        }
    }
};

/*******************************************************************/
/******************** GAME STATE HANDLING **************************/
/*******************************************************************/

//ask the state of the game from other nodes
function updateGameState(session) {
    secret = session.secret;
    for (var i = 0; i < session.players.length; i++) {
        var port = session.players[i].port;
        if(port == server_port) continue;
        
        //get state from other players
        http.get('http://localhost:' + port + '/state', (res) => {
            var body = '';
            res.on('data' , function (chunk) {
                body += chunk;
            });
            res.on('end', function() {
                if (body != "null") {
                    var i = getOwnPlayerIndex(body)
                    body = JSON.parse(body);
                    body.players[i].connection.connected = true;
                    body.players[i].connection.counter = 0;
                    body = JSON.stringify(body);
                    fs.writeFileSync('data'+server_port+'.json', body);
                    console.log("game state found and saved");
                    initialized = true;
                    incrementVectorClock(server_port);
                    var message = {};
                    message.type = "RECONNECTED";
                    message.source = server_port;
                    incrementVectorClock(server_port);
                    message = JSON.stringify(message);
                    message = encryptMessage(message);
                    sendMessages(message);
                }
                else console.log('found empty game state');
            });
        }).on('error', (e) => {
            console.log("Player could not be reached. Error message: " + e.message);
        });
    }
};

//save a event (move/attack done in the game) to the database.
function saveAnEvent(gameEvent) {
    console.log("SAVING...");
    var data = JSON.parse(fs.readFileSync('data'+server_port+'.json', 'utf8'));
    if (gameEvent.eventType == "MOVE") {
        data.players[gameEvent.index].location.x += gameEvent.data.x;
        data.players[gameEvent.index].location.y += gameEvent.data.y;
    }
    else if (gameEvent.eventType == "ATK") {
        
    }
    var sData = JSON.stringify(data);
    fs.writeFileSync('data'+server_port+'.json', sData);
    log.push(gameEvent);
    var sLog = JSON.stringify(log);
    fs.writeFileSync('log'+server_port+'.json', sLog);
};

// received ACKs from other servers are counted and if a event in queue
// has received enough ACKs, executes/saves the event to the database.
function queueHandler(message) {
   
    for(var i = 0; i < eventQueue.length; i++) {
        if(eventQueue[i].data.eventId == message.eventId && 
           eventQueue[i].index == message.index) {
            //count the received ACKs from other servers until everyone got it
            eventQueue[i].okCount--;
            //count the disconnected nodes to determine the amount of needed ACKs
            var neededACKs = countDisconnected();
            //console.log(neededACKs);
            if(eventQueue[i].okCount <= neededACKs) {
                //save the event and remove it from the queue
                saveAnEvent(eventQueue.splice(i,1)[0])
            }
            return 1;
        }
    }
    return 0;
};

// add a event to the queue to wait for all of the players to ACK the event
function addToQueue(message) {
    var data = JSON.parse(fs.readFileSync('data'+server_port+'.json', 'utf8'));
    var count = data.players.length;
    message.okCount = count - 1;
    //when only one player in the game you don't have to wait for ACKs
    if(count - countDisconnected() == 1) {
        saveAnEvent(message);
    }
    else eventQueue.push(message);
};

// count the amount of disconnected players in a session
function countDisconnected() {
    var data = JSON.parse(fs.readFileSync('data'+server_port+'.json', 'utf8'));
    var count = 0;
    for (var i = 0; i < data.players.length; i++) {
        if(data.players[i].connection.connected == false) {
            count++;
        }
    }
    return count;
};

/*******************************************************************/
/******************* VECTOR CLOCKS *********************************/
/*******************************************************************/

// compares the vector clock of this server and received message
// and return wait true/false depending on the result
function compareVectorClocks(message) {
    var data = JSON.parse(fs.readFileSync('data'+server_port+'.json', 'utf8'));
    var myClock = data.vector_clock;
    var clock = message.vector_clock;
    var wait = false;
    
    //see if all messages received
    for (var i = 0; i < myClock.length; i++) {
        if (myClock[i] < clock[i]) {
            //wait for message to arrive
            console.log("waiting for a message from player " + i);
            wait = true;
        }
    }
    //not all messages are received so wait
    if (wait) {
        return wait;
    }
    //otherwise update vector clock by taking the max clock values
    else {
        for (var i = 0; i < myClock.length; i++) {
            myClock[i] = Math.max(myClock[i], clock[i])
        }
    }
    //save the new vector clock values
    data.vector_clock = myClock;
    var sData = JSON.stringify(data);
    fs.writeFileSync('data'+server_port+'.json', sData);
    return wait;
};

// increments a vector clock of one node identified by its port
function incrementVectorClock(port) {
    var data = JSON.parse(fs.readFileSync('data'+server_port+'.json', 'utf8'));
    //find the player from list of players with port number
    for (var i = 0; i < data.players.length; i++) {
        //increment the clock of the sender
        if(data.players[i].address.port == port) {
            //console.log("incremented port: " + server_port + " and i = " + i);
            data.vector_clock[i]++;
            var sData = JSON.stringify(data);
            fs.writeFileSync('data'+server_port+'.json', sData);
            return data.vector_clock;
        }
    }
    return -1;
}

function getVectorClock() {
    var data = JSON.parse(fs.readFileSync('data'+server_port+'.json', 'utf8'));
    return data.vector_clock;
};

/*******************************************************************/
/********************** MESSAGE HANDLING ***************************/
/*******************************************************************/

//send a message to other nodes
function sendToOthers(message) {
    //if message came from client just send it forward.
    if (message.source == "client") {
        message.source = server_port;
    }
    //create an ACK message to ACK the reveived event
    else {
        var ack = {};
        ack.eventId = message.data.eventId,
        ack.index = message.index;
        ack.type = "ACK";
        message = ack;
        message.source = server_port;
    }
    //increment own vector clock because server is sending a message
    incrementVectorClock(server_port);
    message.vector_clock = getVectorClock();
    message = JSON.stringify(message);
    message = encryptMessage(message);
    sendMessages(message);
};

//send messages to players
function sendMessages(message) {
    var data = JSON.parse(fs.readFileSync('data'+server_port+'.json', 'utf8'));
    for (var i = 0; i < data.players.length; i++) {
        var port = data.players[i].address.port;
        var connected = data.players[i].connection.connected;
        //skip sending to itself and to disconnected players
        if (port == server_port) continue;
        var options = {
            host: 'localhost',
            path: '/',
            port: port,
            method: 'POST'
        };
        // on successful POST and destination reached
        var req = http.request(options, function(res) {
            if (res.statusCode == 200) {
                var port = '';
                res.on('data', function(chunk) {
                    port += chunk;
                });
                res.on('end', function() {
                    var data = JSON.parse(fs.readFileSync('data'+server_port+'.json', 'utf8'));
                    for (var j = 0; j < data.players.length; j++) {
                        var player = data.players[j];
                        //update the connection status of a player
                        if (player.address.port == port && player.connection.counter > 0) {
                            if(player.connection.connected == false) {
                                console.log("Player "+j+" reconnected" + "count " + data.players[j].connection.counter + " " + data.players[j].connection.connected);
                                data.players[j].connection.connected = true;
                            }
                            data.players[j].connection.counter = 0;
                            var sData = JSON.stringify(data);
                            fs.writeFileSync('data'+server_port+'.json', sData);
                        }
                    }
                });
            };
        });
        // on failed POST and destination not reached
        req.on('error', (e) => { 
            console.log('error: '+e.message);
            var disconnected_port = e.message.split(":")[1];
            var data = JSON.parse(fs.readFileSync('data'+server_port+'.json', 'utf8'));
            //if the player is not reached for 3 consecutive times, label it disconnected
            for (var i = 0; i < data.players.length; i++) {
                if (disconnected_port == data.players[i].address.port) {
                    data.players[i].connection.counter++;
                    if (data.players[i].connection.counter > 3) {
                        data.players[i].connection.connected = false;
                        console.log("Player "+i+" disconnected");
                    }
                    var sData = JSON.stringify(data);
                    fs.writeFileSync('data'+server_port+'.json', sData);
                }
            }
        });
        req.write(message);
        req.end();
        console.log("sent data to " + port);
    }
};

function reconnectPlayer(message) {
    var data = JSON.parse(fs.readFileSync('data'+server_port+'.json', 'utf8'));
    for (var j = 0; j < data.players.length; j++) {
        var player = data.players[j];
        //update the connection status of a player
        if (player.address.port == message.source) {
            data.players[j].connection.connected = true;
            data.players[j].connection.counter = 0;
            var sData = JSON.stringify(data);
            fs.writeFileSync('data'+server_port+'.json', sData);
            console.log("player " + j + " reconnected")
            return;
        }
    }
};

//init the game state when starting a session
function initState(message) {
    session = message.session;
    eventQueue = [];
    log = [];
    var dataStorage = { "players" : [] }
    dataStorage.vector_clock = [];
    var player;
    for (var i = 0; i < session.players.length; i++) {
        player = {"location" : {"x": 0, "y": 0},
                  "health" : 5,
                  "name" : "player" + i,
                  "address" : {"ip" : "192.168.0.1",
                               "port" : session.players[i].port},
                  "connection" : {"counter" : 0, "connected" : true}
        };
        dataStorage.players.push(player);
        dataStorage.vector_clock.push(0);
    }
    secret = session.secret;
    dataStorage.secret = session.secret;
    var sdata = JSON.stringify(dataStorage);
    fs.writeFileSync('data'+server_port+'.json', sdata);
    initialized = true;
};

function checkForMissedACKS() {
    var result;
    //go through missed ACKs that had no matches for events
    for (var i = 0; i < ackQueue.length; i++) {
        var ack = ackQueue[i]
        result = queueHandler(ack);
        //remove the ACK if match found
        if(result == 1) {
            ackQueue.splice(i,1)
            i--;
        }
    }
}

// check if event that is waiting can be added to the event queue
function checkForWaitingEvents() {
    if (waitQueue.length > 0) {
        var wait = compareVectorClocks(waitQueue[0]);
        // if still waiting for an arriving message, wait more
        if (wait) {
            return;
        }
        // else remove the event and process it normally
        else {
            var message = waitQueue.shift();
        }
        addToQueue(message);
        sendToOthers(message);
        checkForMissedACKS();
        checkForWaitingEvents();
    }
};

//process the message this server received
function processMessage(message) {
    
    switch(message.type) {
        //start a game session sent by game server
        case "START":
            initState(message);
            break;
        //chat message received
        case "CHAT":
            console.log("got chat message");
            chatQueue.push(message);
            break;
        //other player informs it has reconnected
        case "RECONNECTED":
            reconnectPlayer(message);
            break;
        //another server gives an acknowledgment to a event
        case "ACK":
            //var wait = compareVectorClocks(message);
            //if (wait) break;
            var result = queueHandler(message);
            if (result == 0) ackQueue.push(message);
            else checkForMissedACKS();
            break;
        //a new event is added to queue and sent to other nodes
        case "EVENT":
            if (message.source == "client") {
                addToQueue(message);
                sendToOthers(message);
                //send ACK to others that this node got the event
                message.type = "ACK";
                sendToOthers(message);
            }
            else {
                var wait = compareVectorClocks(message);
                if (wait) {
                    waitQueue.push(message);
                    break;
                }
                addToQueue(message);
                sendToOthers(message);
                checkForMissedACKS();
                checkForWaitingEvents();
            }
            break;
    }
};

/*******************************************************************/
/********************* ENCRYPTION **********************************/
/*******************************************************************/

// encrypt/decrypt a string using 256 bit AES

function decryptMessage(message) {
    var decrypted = CryptoJS.AES.decrypt(message, secret.key).toString(CryptoJS.enc.Utf8);
    return decrypted;
};

function encryptMessage(message) {
    var encrypted = CryptoJS.AES.encrypt(message, secret.key).toString();
    return encrypted;
};

//================================================
//=============== CHAT CHANNELS ==================
//================================================

//return the chat messages waiting in a queue and clear the queue
//called when browser asks for messages
function chatMessageHandler() {
    var data = chatQueue;
    chatQueue = [];
    data = JSON.stringify(data);
    return data;
};

init();

http.createServer(function (req, res) {
    //console.log(req.method + " " + req.url);
    
    //fetch the game state from the server
    if (req.method == "GET" ) {
        res.writeHead(200, {'Content-Type':'text/plain',
                            'Access-Control-Allow-Origin':'*'} );
        var data = '';
        if (req.url == '/state') {
            data = fs.readFileSync('data'+server_port+'.json', 'utf8');
        }
        else if (req.url == '/chat') {
            data = chatMessageHandler();
        }
        res.end(data);
    }
    //receive post from other servers or from local client
    if (req.method == "POST" ) {
        var body = '';
        req.on('data', function(chunk) {
            body += chunk;
        });
        req.on('end', function() {
            //test if plain or encrypted JSON
            var message;
            try {
                message = JSON.parse(body);
            }
            catch(err) {
                body = decryptMessage(body);
                message = JSON.parse(body);
            }
            //increment vector clock if game running
            if (initialized) incrementVectorClock(message.source);
            //process message and send OK as a response
            processMessage(message);

            res.writeHead(200, {'Content-Type':'text/plain',
                                'Access-Control-Allow-Origin':'*'} );
            res.end(String(server_port));
        });
    }
}).listen(parseInt(server_port));

//periodically post the state of waiting events and ACKs
//setInterval(function() {console.log(eventQueue.length + " " + ackQueue.length) }, 5000);

console.log('Server running at http:/localhost:' + server_port + '/');