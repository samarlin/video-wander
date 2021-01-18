const local_user = document.getElementById('local');
const remote_users = document.getElementById('remote');
const start_room = documents.getElementById('start_room');

let local_stream;
let socket;
let state = {};

async function init() {
    console.log('Requesting local stream');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
        console.log('Received local stream');
        local_user.srcObject = stream;
        local_stream = stream;
        start_room.disabled = false;
    } catch (e) {
        alert(`getUserMedia() error: ${e.name}`);
    }

    const data = await join();
    state.admin = data.admin;
    if (state.admin == true) {
        // show the start button if admin
        start_room.style.display = "block";
        start_room.addEventListener("click", function (event) {
          fetch("http://localhost:3000/start-room", { method: "POST" });
        });
    } else {
        start_room.style.display = "none";
    }
    socket = new WebSocket("ws://localhost:9000");
    socket.onopen = () => {
        let msg = {type: "ASSOCIATE", id: state.name};
        socket.send(JSON.stringify(msg));
    };
    socket.onmessage = (event) => {onMessage(event);};
}

// USER_LIST
function onMessage(event) {
    let message = JSON.parse(event.data);
    console.log(message);

    switch(message.type) {
        case "USER_LIST":
            // update for efficiency later
            let list = document.getElementById('remote_list');
            while(list.firstChild) {
                list.removeChild(list.firstChild);
            }

            message.names.forEach(function(curr_name) {
                let item = document.createElement('li');
                item.appendChild(document.createTextNode(curr_name));
                item.addEventListener('click', addToCall, false);
                list.appendChild(item);

                if(curr_name !== state.name) {
                    state.users[curr_name].name = curr_name;
                }
            });
            break;
    }
}

function join() {
    // sent post request to server,
    // joining lobby
    let name = prompt("Enter name:");
    state.name = name;
    let body = { name };
    return fetch("http://localhost:3000/join-lobby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    .then((response) => response.json());
}

function addToCall(event) {
    let clicked_user = event.target.textContent;
    if(clicked_user !== state.name) {
        
    }
}