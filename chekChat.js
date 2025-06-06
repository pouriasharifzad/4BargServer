const mongoose = require('mongoose');
const Message = require('./models/Message');
const Chat = require('./models/Chat');

// اتصال به دیتابیس
mongoose.connect('mongodb://localhost:27017/4Bargdb', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

async function checkChat() {
  try {
    const user1Id = new mongoose.Types.ObjectId("680a590bb89611a2bf2996cb");
    const user2Id = new mongoose.Types.ObjectId("680a5951b89611a2bf2996da");

    const chat = await Chat.findOne({
      participants: { $all: [user1Id, user2Id] }
    }).populate('messages');
    console.log('Chat found:', chat);

    const messageId = new mongoose.Types.ObjectId("68168e730f0b627c9168a177");
    const message = await Message.findById(messageId);
    console.log('Message details:', message);
  } catch (err) {
    console.error('Error checking chat:', err);
  } finally {
    mongoose.connection.close();
  }
}

checkChat();