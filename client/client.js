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
    urls: "turn:coturn.videowander.io:5349", // ?transport=tcp",
    username: "coturn",
    credential: "under2Brain",
  },
];

/////////////////////////////////////////////

let signaling_socket = null;
let local_media_stream = null;
let peers = {};
let peer_media_elements = {};

let videos = document.getElementById("videos");
let colors = [
  "tomato",
  "cornflowerblue",
  "cadetblue",
  "darkolivegreen",
  "orange",
  "goldenrod",
  "mediumaquamarine",
  "indianred",
  "lightcoral",
  "palevioletred",
  "chocolate",
];

let map = document.getElementById("controller");
let ctx = map.getContext("2d");

let startX = 0,
  startY = 0;

let pts = [
  {
    fill: false,
    x: Math.floor(Math.random() * 400 - 12),
    y: Math.floor(Math.random() * 250 - 12),
    r: 12,
    dt: null,
    pid: "self",
    color: "darkslateblue",
  },
];

let selected = false;

function draw() {
  ctx.clearRect(0, 0, map.clientWidth, map.height);
  pts.forEach((pt) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.r, 0, 2 * Math.PI);
    if (pt.fill) {
      ctx.strokeStyle = pt.color;
      ctx.fillStyle = pt.color;
      ctx.stroke();
      ctx.fill();
    } else {
      ctx.strokeStyle = pt.color;
      ctx.stroke();
    }
  });

  // now update video scales
  // max distance: width of canvas - r*2
  // max size 100%, min 20%
  // within a certain radius should all just be max size
  // order video elements by distance or scale
  let sorted = [];
  pts.forEach((pt) => {
    sorted.push([
      pt.pid,
      Math.sqrt((pts[0].x - pt.x) ** 2 + (pts[0].y - pt.y) ** 2),
    ]);

    // update frame colors
    peer_media_elements[pt.pid].style.borderColor = pt.color;
  });
  sorted.sort(function (a, b) {
    return a[1] - b[1];
  });

  sorted.forEach((pt, idx) => {
    peer_media_elements[pt[0]].style.order = `${idx}`;

    let max_w = Math.sqrt(map.width ** 2 + map.height ** 2);
    max_w += max_w * 0.2;
    let scale = 1 - pt[1] / max_w;
    peer_media_elements[pt[0]].style.transform = `scale(${scale})`;
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
  startX = e.layerX;
  startY = e.layerY;

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
  let mouseX = e.layerX;
  let mouseY = e.layerY;

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
        w: map.width,
        h: map.height,
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
      event.channel.onmessage = function (event) {
        let evt = JSON.parse(event.data);

        //check if already exists
        // eventually use event.data.w * event.data.h to calculate location relative to resolution
        let target = pts.filter((pt) => pt.dt === data_channel);
        if (target.length === 0) {
          pts.push({
            fill: true,
            x: evt.x,
            y: evt.y,
            r: 12,
            dt: data_channel,
            pid: peer_id,
            color: colors.pop(),
          });
        } else {
          target[0].x = evt.x;
          target[0].y = evt.y;
        }
        draw();
      };

      event.channel.onclose = function (event) {
        pts = pts.filter((pt) => pt.dt !== data_channel);
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
            w: map.width,
            h: map.height,
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
        remote_media.setAttribute("autoplay", "");
        remote_media.setAttribute("playsinline", "");
        if (MUTE_AUDIO_BY_DEFAULT) {
          remote_media.muted = true;
        }
        peer_media_elements[peer_id] = remote_media;

        document.getElementById("videos").append(remote_media); // append peer video
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
    let ice_pr = peer.addIceCandidate(new RTCIceCandidate(ice_candidate));
    ice_pr.catch((error) => {
      console.log(error);
    });
  });

  signaling_socket.on("removePeer", function (config) {
    let peer_id = config.peer_id;
    if (peer_id in peer_media_elements) {
      let idx = pts.findIndex((obj) => obj.pid === peer_id);
      colors.push(pts[idx].color);

      pts.splice(idx, 1);
      peer_media_elements[peer_id].remove();
    }
    if (peer_id in peers) {
      peers[peer_id].close();
    }

    delete peers[peer_id];
    delete peer_media_elements[config.peer_id];
    draw(); // recalculate order
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

      local_media.setAttribute("autoplay", "");
      local_media.setAttribute("playsinline", "");
      // dynamic setting of muted tag doesn't work in chrome for some reason so...
      local_media.setAttribute("oncanplay", "this.muted=true");

      peer_media_elements["self"] = local_media;
      document.getElementById("videos").append(local_media);
      local_media.srcObject = stream;

      draw();
      next();
    })
    .catch(function (error) {
      alert("Access to the camera/microphone denied.");
    });
}
