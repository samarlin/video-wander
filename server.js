const static = require("node-static");
const http = require("http");
const app = http
  .createServer(function (req, res) {
    file.serve(req, res);
  })
  .listen(3000);
const file = new static.Server(app);
const io = require("socket.io")(app);

io.sockets.on("connection", function (socket) {
  socket.on("disconnecting", function () {
    let id = socket.id;
    for (let room of socket.rooms.values()) {
      leave(room);
    }
  });

  socket.on("join", function (config) {
    let room = config.room;
    let userdata = config.userdata;

    socket.join(room);
    socket.userdata = userdata;

    socket.emit("joinedRoom", room, socket.id);

    for (let id of io.sockets.adapter.rooms.get(room).values()) {
      io.to(id).emit("addPeer", {
        peer_id: socket.id,
        should_create_offer: false,
      });
      socket.emit("addPeer", { peer_id: id, should_create_offer: true });
    }
  });

  function leave(room) {
    for (let id of io.sockets.adapter.rooms.get(room).values()) {
      io.to(id).emit("removePeer", { peer_id: socket.id });
      socket.emit("removePeer", { peer_id: id });
    }
    socket.leave(room);
  }
  socket.on("leave", leave);

  socket.on("relayICECandidate", function (config) {
    let peer_id = config.peer_id;
    let ice_candidate = config.ice_candidate;

    io.to(peer_id).emit("iceCandidate", {
      peer_id: socket.id,
      ice_candidate: ice_candidate,
    });
  });

  socket.on("relaySessionDescription", function (config) {
    let peer_id = config.peer_id;
    let session_description = config.session_description;

    io.to(peer_id).emit("sessionDescription", {
      peer_id: socket.id,
      session_description: session_description,
    });
  });
});

/*
app.post("/create-room", (req, res) => {
});

app.post("/join-room", (req, res) => {
});
*/
