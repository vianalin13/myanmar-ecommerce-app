//exports all chat-related functions

module.exports = {
  ...require("./startChat"),
  ...require("./sendMessage"),
  // - getChatMessages
  // - getUserChats
  // - linkChatToOrder
};

