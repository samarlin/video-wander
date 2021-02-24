const e = require("express");

class Room {
    constructor(users) {
      this.users = users;

    }
  
    onMessage(message) {
        console.log(message);
    }
}