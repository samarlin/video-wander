const express = require("express");
const room = require("./room.js");

const app = express();
const WebSocket = require("ws");

const cors = require("cors");
const body_parser = require("body-parser");
const http = require("http").createServer(app);
const wss = new WebSocket.Server({ server: http, port: 9000 });

const port = 3000;
app.use(cors());
app.use(body_parser.json());

let vidroom;
let state = {
    users: {},
};

wss.on('connection', function connection(ws) {
    ws.on('message', function incoming(msg) {
        let message = JSON.parse(msg);
        if (message.type === "ASSOCIATE") {
            state.users[message.id].connection = ws;
            
            let users = Object.keys(state.users);
            for (let i = 0; i < users.length; ++i) {
                state.users[users[i]].connection.send(JSON.stringify({type: "USER_LIST", names: users}));
            }
        } else {
            vidroom.onMessage(message);
        }
    });
});

app.post("/join-lobby", (req, res) => {
    let body = req.body;
    let admin = false;
    if (Object.keys(state.users).length == 0) {
        admin = true;
    }

    state.users[body.name] = { admin: admin, name: body.name };

    res.json({ admin });
});

app.post("/start-room", (req, res) => {
    // start room,
    // send message to all clients w/ room init info
    vidroom = new room.Room(state.users);
});

http.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});