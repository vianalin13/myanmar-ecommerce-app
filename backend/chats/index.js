//exports all chat-related functions

module.exports = {
  ...require("./startChat"),
  ...require("./sendMessage"),
  ...require("./getChatMessages"),
  ...require("./getUserChats"),
  // - linkChatToOrder
};

