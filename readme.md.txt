Distributed system: course work
Simple multiplayer game

0. Table of Contents

	1. Introduction
	2. Architecture
	3. Communication
	4. Naming
	5. Synchronization
	6. Consistency and replication
	7. Fault tolerancy
	8. Security

0.1 Dependacies and installation

This course work is implemented with Javascript and Node.js. To run it you need:

	- Node.js installed with crypto-js package
	- Any web browser
	- Jquery javascript package
	- Googles CryptoJS javascript package	

To run the gameserver (only one needed) type this to the command line:

	- Node gameServer.js <insert port number>

To run localserver (server for client, run for each node you want) type:

	- Node localServer.js <insert port number>

Then open game.html in any browser for each node/player.


1. Introduction
The distributed system is a simple multiplayer game where players try to hit each other with a sword. When a player gets hit 5 times he/she loses. Game ends when only one player remains. Here it is important that every player sees the same state of the game. Otherwise one player could land a hit in his/hers screen but other players see that as a miss. Game sessions need to be created/ destroyed to support multiple sessions running in the system.

(ONLY MOVING IS IMPLEMENTED)

2. Architecture
The system runs on one machine and each node has its own port number which acts as an address of the node. This can be changed in the future to use IP addresses instead of only ports.

A session is created by submitting a game session to the game session server. A player node can then join an open game from a list of submitted sessions. After all players have joined, the game is started. Players communicate directly to each other using the addresses acquired from the game session server and using multicast. The game is then played out normally. After the game ends the game session is removed from the server.

A game session server has:
- all current game sessions.
- addresses of everyone in a session.
- chat channels and their subscribers
A player has:
- the info acquired from the server.
- game state (player positions, healths, chat etc.) in its replicated data storage.

During the game the nodes send updates of their positions and attack events which are stored into every nodes local data storage. Chat messages are sent to directly to the game session server which forwards the messages to their destinations. The updates and chat messages are sent in encrypted JSON format.

3. Communication
The nodes can subscribe to chat channels. The game session server also servers as a message broker that forwards the messages to every subscriber. A session also has its own chat channel. When a node joins a session it is automatically subscribed to the session channel which uses the sessions secret key to encrypt the chat messages. There is also the "general chat" you can join that uses plain text messages.

4. Naming
Since the system is run on a single machine each node is identified with the port number. When starting a node a port number is asked which is used as its address. The ports of others nodes can be discovered from the session information.

5. Synchronization
Causally ordered multicasting implemented with totally ordered-multicast and vector clocks.

6. Consistency and replication
The state of the game is replicated to each players local data storage. 

7. Fault tolerancy
If a player node crashes it can find the game session from the server and start the game by asking the current state from other player nodes. If a game session server crashes all session data are lost but games still run independently although reconnecting to a session does not work anymore.

8. Security
Encrypted communication between nodes using AES and symmetric key generated for every session and chat channel. Communication with server and in general chat is plaintext.
