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

  /**
   * When we join a group, our signaling server will send out 'addPeer' events to each pair
   * of users in the group (creating a fully-connected graph of users, ie if there are 6 people
   * in the room you will connect directly to the other 5, so there will be a total of 15
   * connections in the network).
   */
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
        let remote_media = USE_VIDEO ? $("<video>") : $("<audio>");
        remote_media.attr("autoplay", "autoplay");
        remote_media.attr("playsinline", "true");
        if (MUTE_AUDIO_BY_DEFAULT) {
          remote_media.attr("muted", "true");
        }
        peer_media_elements[peer_id] = remote_media;
        $("body").append(remote_media);
      }
      peer_media_elements[peer_id][0].srcObject = stream;
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

/***********************/
/* Local media set-up */
/***********************/
function setup_local_media(next) {
  if (local_media_stream !== null) {
    return;
  }

  navigator.mediaDevices
    .getUserMedia({ audio: USE_AUDIO, video: USE_VIDEO })
    .then(function (stream) {
      local_media_stream = stream;
      let local_media = USE_VIDEO ? $("<video>") : $("<audio>");
      local_media.attr("autoplay", "autoplay");
      local_media.attr("muted", "true");
      local_media.attr("playsinline", "true");
      $("body").append(local_media);
      local_media[0].srcObject = stream;

      next();
    })
    .catch(function (error) {
      alert("Access to the camera/microphone denied.");
    });
}
