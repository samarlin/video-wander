const SIGNALING_SERVER = "https://videowander.io";
const IO_CONNOPTS = {
  "force new connection": true,
  reconnection: true,
  reconnectionDelay: 10000,
  reconnectionDelayMax: 60000,
  reconnectionAttempts: "Infinity",
  timeout: 10000,
  transports: ["websocket"],
  resource: "/signalling-server/",
};
let room, name;
const USE_AUDIO = true;
const USE_VIDEO = true;
const MUTE_AUDIO_BY_DEFAULT = false;
const ICE_SERVERS = [
  {
    urls: "stun:coturn.videowander.io:5349",
  },
  {
    urls: "turn:coturn.videowander.io:5349",
    credential: "under2Brain",
    username: "videowander",
  },
];

/////////////////////////////////////////////

let signaling_socket = null;
let local_media_stream = null;
let peers = {};
let peer_media_elements = {};

let map = document.getElementById("controller");
let ctx = map.getContext("2d");

let offsetX = map.offsetLeft;
let offsetY = map.offsetTop;
let startX = 0,
  startY = 0;

let pts = [
  {
    fill: true,
    x: Math.floor(Math.random() * 400 - 12),
    y: Math.floor(Math.random() * 250 - 12),
    r: 12,
    dt: null,
  },
];

let selected = false;

draw();

function draw() {
  ctx.clearRect(0, 0, map.clientWidth, map.height);
  pts.forEach((pt) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.r, 0, 2 * Math.PI);
    if (pt.fill) {
      ctx.stroke();
      ctx.fill();
    } else {
      ctx.stroke();
    }
  });
}

function hitTest(x, y) {
  return (
    x >= pts[0].x - pts[0].r &&
    x <= pts[0].x + pts[0].r &&
    y >= pts[0].y - pts[0].r &&
    y <= pts[0].y + pts[0].r
  );
}

function handleMouseDown(e) {
  e.preventDefault();
  startX = parseInt(e.clientX - offsetX, 10);
  startY = parseInt(e.clientY - offsetY, 10);

  if (hitTest(startX, startY)) {
    selected = true;
  }
}

function handleMouseUp(e) {
  e.preventDefault();
  selected = false;
}

function handleMouseOut(e) {
  e.preventDefault();
  selected = false;
}

function handleMouseMove(e) {
  if (!selected) {
    return;
  }

  e.preventDefault();
  let mouseX = parseInt(e.clientX - offsetX, 10);
  let mouseY = parseInt(e.clientY - offsetY, 10);

  let dx = mouseX - startX;
  let dy = mouseY - startY;
  startX = mouseX;
  startY = mouseY;

  let pt = pts[0];
  pt.x += dx;
  pt.y += dy;

  let other_pts = pts.filter((pt) => pt.dt !== null);
  other_pts.forEach((pt) => {
    pt.dt.send(
      JSON.stringify({
        x: pts[0].x,
        y: pts[0].y,
        r: pts[0].r,
        w: ctx.width,
        h: ctx.height,
      })
    );
  });
  draw();
}

map.addEventListener("mousedown", handleMouseDown);
map.addEventListener("mousemove", handleMouseMove);
map.addEventListener("mouseup", handleMouseUp);
map.addEventListener("mouseout", handleMouseOut);

function init() {
  room = prompt("Enter room name:");
  //name = prompt("Enter your name:");

  signaling_socket = io.connect("https://videowander.io", IO_CONNOPTS);

  signaling_socket.on("connect", function () {
    setup_local_media(function () {
      join_room(room, { name: "default" });
    });
  });
  signaling_socket.on("disconnect", function () {
    console.log("Disconnected from signaling server");
    for (peer_id in peer_media_elements) {
      peer_media_elements[peer_id].remove();
    }
    for (peer_id in peers) {
      peers[peer_id].close();
    }

    peers = {};
    peer_media_elements = {};
  });
  function join_room(room, userdata) {
    signaling_socket.emit("join", { room: room, userdata: userdata });
  }
  function leave_room(room) {
    signaling_socket.emit("leave", room);
  }

  signaling_socket.on("addPeer", function (config) {
    let peer_id = config.peer_id;
    if (peer_id in peers) {
      return;
    }
    let peer_connection = new RTCPeerConnection(
      { iceServers: ICE_SERVERS },
      { optional: [{ DtlsSrtpKeyAgreement: true }] }
    );
    peers[peer_id] = peer_connection;
    let data_channel = peer_connection.createDataChannel("data"); // data channel for map sync

    peer_connection.ondatachannel = function (event) {
      console.log("Data channel is created!");

      event.channel.onmessage = function (event) {
        let evt = JSON.parse(event.data);

        //check if already exists
        // eventually have targets swap colors to use for map/video frame
        // eventually use event.data.w * event.data.h to calculate location relative to resolution
        let target = pts.filter((pt) => pt.dt === data_channel);
        if (target.length === 0) {
          pts.push({
            fill: false,
            x: evt.x,
            y: evt.y,
            r: 12,
            dt: data_channel,
          });
        } else {
          target[0].x = evt.x;
          target[0].y = evt.y;
        }
        draw();
      };

      event.channel.onopen = function (event) {
        let map = document.getElementById("controller");
        let ctx = map.getContext("2d");
        data_channel.send(
          JSON.stringify({
            x: pts[0].x,
            y: pts[0].y,
            r: pts[0].r,
            w: ctx.width,
            h: ctx.height,
          })
        );
      };
    };

    peer_connection.onicecandidate = function (event) {
      if (event.candidate) {
        signaling_socket.emit("relayICECandidate", {
          peer_id: peer_id,
          ice_candidate: {
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            candidate: event.candidate.candidate,
          },
        });
      }
    };
    peer_connection.ontrack = function ({ streams: [stream] }) {
      if (!(peer_id in peer_media_elements)) {
        let remote_media = USE_VIDEO
          ? document.createElement("video")
          : document.createElement("audio");
        remote_media.autoplay = true;
        remote_media.playsinline = true;
        if (MUTE_AUDIO_BY_DEFAULT) {
          remote_media.muted = true;
        }
        peer_media_elements[peer_id] = remote_media;

        document.getElementsByTagName("body")[0].append(remote_media); // append peer video
      }
      peer_media_elements[peer_id].srcObject = stream;
    };

    for (const track of local_media_stream.getTracks()) {
      peer_connection.addTrack(track, local_media_stream);
    }

    if (config.should_create_offer) {
      peer_connection
        .createOffer()
        .then(function (local_description) {
          return peer_connection.setLocalDescription(local_description);
        })
        .then(function () {
          signaling_socket.emit("relaySessionDescription", {
            peer_id: peer_id,
            session_description: peer_connection.localDescription,
          });
        })
        .catch(function (event) {
          console.log("createOffer error: ", event);
        });
    }
  });

  signaling_socket.on("sessionDescription", function (config) {
    let peer_id = config.peer_id;
    let peer = peers[peer_id];
    let remote_description = config.session_description;

    let desc = new RTCSessionDescription(remote_description);
    peer
      .setRemoteDescription(desc)
      .then(function () {
        if (remote_description.type == "offer") {
          peer
            .createAnswer()
            .then(function (local_description) {
              return peer.setLocalDescription(local_description);
            })
            .then(function () {
              signaling_socket.emit("relaySessionDescription", {
                peer_id: peer_id,
                session_description: peer.localDescription,
              });
            });
        }
      })
      .catch(function (error) {
        console.log("setRemoteDescription error: ", error);
      });
  });

  signaling_socket.on("iceCandidate", function (config) {
    let peer = peers[config.peer_id];
    let ice_candidate = config.ice_candidate;
    peer.addIceCandidate(new RTCIceCandidate(ice_candidate));
  });

  signaling_socket.on("removePeer", function (config) {
    let peer_id = config.peer_id;
    if (peer_id in peer_media_elements) {
      peer_media_elements[peer_id].remove();
    }
    if (peer_id in peers) {
      peers[peer_id].close();
    }

    delete peers[peer_id];
    delete peer_media_elements[config.peer_id];
  });
}

function setup_local_media(next) {
  if (local_media_stream !== null) {
    return;
  }

  // video echoes in chrome for some reason
  navigator.mediaDevices
    .getUserMedia({ audio: USE_AUDIO, video: USE_VIDEO })
    .then(function (stream) {
      local_media_stream = stream;
      let local_media = USE_VIDEO
        ? document.createElement("video")
        : document.createElement("audio");
      local_media.autoplay = true;
      local_media.muted = true;
      local_media.playsinline = true;
      document.getElementsByTagName("body")[0].append(local_media);
      local_media.srcObject = stream;

      next();
    })
    .catch(function (error) {
      alert("Access to the camera/microphone denied.");
    });
}
