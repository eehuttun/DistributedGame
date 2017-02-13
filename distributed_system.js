
/* BROWSER PART OF THE SIMPLE DISTRIBUTED MULTIPLAYER GAME
   
   Code to handle the browser part that communicates with its
   local server to form a game.
   
   Used by game.html
*/

var changes = '';
var server_port = '';
var gameRunning = 0;
var secret;

function init() {
    //enter the port number that the localserver is using
    //localserver is used to communicate with other nodes
    server_port = prompt("Enter your port number: ");
    setInterval(chatLoop, 500);
};

function startGame() {
    // init the data storage used to store game state and player info
    $.ajax({
        url: 'http://localhost:' + server_port + '/state',
        type: 'GET',
        success: function(data) {
            //store game state to local storage
            //if state is empty the data is a null STRING
            if(data == "null") {
                console.log("no session running");
            }
            else {
                //save the data to a local storage
                sessionStorage.data = data
                secret = JSON.parse(data).secret;
                changes = {"x":0, "y": 0, "eventId": 0};
                //create the player
                spawnPlayers();
                var playerIndex = getOwnPlayerIndex(data);
                //add keyboard input listener
                document.addEventListener('keydown', function(event) {
                    controls(event.keyCode, playerIndex);
                });
                //add game loop
                gameRunning = 1;
                setTimeout(function(){ gameLoop(playerIndex) }, 100);
            }
        }
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

//================================================
//=============== CHAT CHANNELS ==================
//================================================


//submit a chat message from the chatInput to the game server that forwards the message
//to all subscribers including the sender itself (if subscribed)
function submitMessage() {
    var input = document.getElementById('chatInput').value;
    document.getElementById('chatInput').value = "";
    var message = {};
    message.type = "CHAT_MESSAGE";
    message.source = server_port;
    message.channel = document.getElementById('currentChannel').getAttribute('current_channel');
    console.log("submitted message to: " + message.channel)
    //encrypt if there is a secret key
    if(secret && message.channel != "general chat") {
        input = encrypt(input, secret.key);
    }
    message.data = input;
    $.ajax({
        url: 'http://localhost:' + 9000,
        type: 'POST',
        data: JSON.stringify(message),
        success: function(data) {
            console.log("message submitted")
        },
        error: function(e) {
            console.log("could not fetch chat queue from local server");
        }
    });
    
};


//join a chat channel and sets the current channel you type in to that
function joinChannel() {
    var channel = prompt("Give channel to join");
    document.getElementById('currentChannel').setAttribute('current_channel', channel);
    document.getElementById('currentChannel').innerHTML = "current channel: " +channel;
    console.log("Joined channel: " + channel);
    var message = {};
    message.type = "JOIN_CHAT";
    message.source = server_port;
    message.id = channel;
    $.ajax({
        url: 'http://localhost:' + 9000,
        type: 'POST',
        data: JSON.stringify(message),
        success: function(data) {
            console.log("message submitted")
        }
    });
};

//chat loop that GETs the message queue from the local server
function chatLoop() {
    //update chat
    $.ajax({
        url: "http://localhost:" + server_port + '/chat',
        type: 'GET',
        success: function(data) {
            //store game state to local storage
            if (data != "") {
                data = JSON.parse(data);
                for (var i = 0; i < data.length; i++) {
                    var message = data[i];
                    if(secret && message.channel != "general chat") {
                        message.data = decrypt(message.data, secret.key);
                    }
                    var m = message.channel + " " + message.source + ": " + message.data + '\n';
                    document.getElementById('chat').innerHTML += m;
                }
            }
        }
    });
};

//================================================
//================= ENCRYPTION ===================
//================================================

function decrypt(data, key) {
    var decrypted = CryptoJS.AES.decrypt(data, key).toString(CryptoJS.enc.Utf8);
    return decrypted;
};

function encrypt(data, key) {
    var encrypted = CryptoJS.AES.encrypt(data, key).toString();
    return encrypted;
};

function generateKey() {
    var randomstring = Math.random().toString(36).slice(-8);
    return randomstring;
}

//================================================
//========== GAMESERVER SESSIONS =================
//================================================

function getSessions() {
    $.ajax({
        url: "http://localhost:" + 9000,
        type: 'GET',
        success: function(data) {
            //store game state to local storage
            document.getElementById("sessionList").innerHTML = data;
            console.log(data);
        }
    });
}
function createSession() {
    var message = {};
    message.type = "CREATE_SESSION";
    message.port = server_port;
    //create a session unique passphrase for encryption
    message.secret = {'key' : generateKey(), 'iv' : ''};
    secret = message.secret;
    console.log(message.secret);
    $.ajax({
        url: 'http://localhost:' + 9000,
        type: 'POST',
        data: JSON.stringify(message),
        success: function(data) {
            console.log(data)
            getSessions();
        }
    });
};

function startSession() {
    var message = {};
    message.type = "START_SESSION";
    message.id = prompt("Enter session to start: ");
    $.ajax({
        url: 'http://localhost:' + 9000,
        type: 'POST',
        data: JSON.stringify(message),
        success: function(data) {
            console.log(data)
        }
    });
};

function joinSession() {
    var message = {};
    var id = prompt("Enter session to join: ");
    message.type = "JOIN_SESSION";
    message.port = server_port;
    message.id = id;
    $.ajax({
        url: 'http://localhost:' + 9000,
        type: 'POST',
        data: JSON.stringify(message),
        success: function(data) {
            console.log(data)
            getSessions();
        }
    });
};

function endSession() {
    var message = {};
    var id = prompt("Enter session to destroy: ");
    message.type = "DESTROY_SESSION";
    message.port = server_port;
    message.id = id;
    $.ajax({
        url: 'http://localhost:' + 9000,
        type: 'POST',
        data: JSON.stringify(message),
        success: function(data) {
            console.log(data)
            getSessions();
        }
    });
};

//================================================
//============= GAME HANDLING ====================
//================================================

function spawnPlayers() {
    var colours = ['red', 'green', 'blue', 'yellow'];
    var data = JSON.parse(sessionStorage.data);
    for (var i = 0; i < data.players.length; i++) {
        var block = document.createElement('div');
        block.id = 'block' + i;
        block.style = 'position:absolute;'+
                      'background-color:' + colours[i]+';'+
                      'top:' + data.players[i].location.y + 'px;'+
                      'left:' + data.players[i].location.x + 'px;'+
                      'width:50px;'+
                      'height:50px;'+
                      'border: 2px solid #000;'+
                      'text-align: center';
        block.innerHTML = "player"+i+'\n'+data.players[i].health;
        document.getElementById('arena').appendChild(block);
    }
};

function despawnPlayers() {
    var arena = document.getElementById('arena');
    while (arena.firstChild) {
        arena.removeChild(arena.firstChild);
    }
};

function gameLoop(playerIndex) {
    //send changes to local server
    if(!(changes.x == 0 && changes.y == 0)) {
        var message = {};
        message.type = "EVENT";
        message.eventType = "MOVE";
        message.data = changes;
        message.index = playerIndex;
        message.source = "client";
        //console.log(message);
        $.ajax({
            url: 'http://localhost:'+server_port,
            type: 'POST',
            data: encrypt(JSON.stringify(message), secret.key),
            success: function(data) {
                console.log(data)
            }
        });
        
        //reset changes to zero and update change count
        changes.x = 0; 
        changes.y = 0;
        changes.eventId++;
    };
    
    //update game state
    $.ajax({
        url: "http://localhost:" + server_port + '/state',
        type: 'GET',
        success: function(data) {
            //store game state to local storage
            if(data) {
                sessionStorage.data = data;
                var players = JSON.parse(data).players;
                for (var i = 0; i < players.length; i++) {
                    var player = players[i];
                    var block = document.getElementById("arena").childNodes[i];
                    block.style.left = player.location.x + 'px';
                    block.style.top = player.location.y + 'px';
                    block.innerHTML = "player"+i+'\n'+player.health;
                }
            }
            else {
                console.log(data);
            }
        },
        error: function(data) {
            console.log('localserver not running');
            gameRunning = 0;
            despawnPlayers();
            
        }
    });
    
    if(gameRunning) setTimeout(function(){ gameLoop(playerIndex) }, 100);
    
    //check if attack has hit somebody
    checkAttack(playerIndex);
};

function checkAttack(playerIndex) {
    var players = JSON.parse(sessionStorage.data).players;
    //return if no hitbox
    if (document.getElementById('arena').childNodes[playerIndex].childNodes.length == 1) return;
    //check for hits
    var loc = {
        'x' : players[playerIndex].location.x,
        'y' : players[playerIndex].location.y };
    for (var i = 0; i < players.length; i++) {
        if( i != playerIndex ) {
            var block = document.getElementById('arena').childNodes[i];
            var x = parseInt(block.style.left);
            var y = parseInt(block.style.top);
            if(loc.x + 55 > x && loc.x + 55 < x+50 &&
               loc.y + 20 > y && loc.y + 20 < y+50) {
                hit(i);
            }
        }
    }
};

function hit(index) {
    data = JSON.parse(sessionStorage.data);
    data.players[index].health--;
    console.log('player hit: ' + index);
    sessionStorage.data = JSON.stringify(data);
};

function attack(i) {
    var player = document.getElementById('arena').childNodes[i];
    //exit if player already has an attack hitbox
    if (player.childNodes[1]) return;
    
    //create an attack hitbox for the player
    var data = JSON.parse(sessionStorage.data);
    var aBlock = document.createElement('div');
    aBlock.style = 'position:relative;'+
                   'top:-20px;'+
                   'left:50px;'+
                   'width:20px;'+
                   'height:10px;'+
                   'border: 2px solid #000;';
    player.appendChild(aBlock);
    //destroy the attack hitbox after some time has passed
    setTimeout(function() {
        player.removeChild(player.lastChild);
    }, 1000);
};

function controls(key, index) {
    switch(key) {
        //letter 'a'
        case 65:
            attack(index);
            break;
        //left arrow key
        case 37:
            changes.x--;
            break;
        //up arrow
        case 38:
            changes.y--;
            break;
        //right arrow
        case 39:
            changes.x++;
            break;
        //down arrow
        case 40:
            changes.y++;
            break;
        default:
            break;
    }
};
