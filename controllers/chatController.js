const mongoose = require('mongoose');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');

// Send private message
const sendPrivateMessage = async (socket, request) => {
    const { requestId, data } = request;
    const { toUserId, message } = data;
    console.log(`[Server] Received sendPrivateMessage request - requestId: ${requestId}, toUserId: ${toUserId}, message: ${message}`);
    try {
        const senderId = new mongoose.Types.ObjectId(socket.userId);
        const receiverId = new mongoose.Types.ObjectId(toUserId);

        const newMessage = new Message({
            sender: senderId,
            receiver: receiverId,
            message,
            timestamp: new Date()
        });
        await newMessage.save();
        console.log(`[Server] Message saved to database: ${newMessage._id}, sender: ${senderId}, receiver: ${receiverId}, message: ${message}`);

        let chat = await Chat.findOne({
            participants: { $all: [senderId, receiverId] }
        });
        if (!chat) {
            chat = new Chat({
                participants: [senderId, receiverId],
                messages: [newMessage._id]
            });
        } else {
            chat.messages.push(newMessage._id);
        }
        await chat.save();
        console.log(`[Server] Chat updated or created for participants: ${senderId}, ${receiverId}`);

        let targetSocket = null;
        const io = socket.server;
        io.sockets.sockets.forEach((s) => {
            if (s.userId === toUserId) {
                targetSocket = s;
            }
        });

        if (targetSocket) {
            console.log(`[Server] Sending private message to ${toUserId}`);
            targetSocket.emit('receive_private_message', {
                requestId,
                success: true,
                message: {
                    sender: socket.userId,
                    receiver: toUserId,
                    message: message,
                    timestamp: new Date().toISOString().split('T')[0] + ' ' + new Date().toTimeString().split(' ')[0].slice(0, 5)
                }
            });
        } else {
            console.log(`[Server] User ${toUserId} not connected`);
        }

        socket.emit('send_private_message_response', { requestId, success: true, message: 'پیام ارسال شد' });
    } catch (err) {
        console.error(`[Server] Error in sendPrivateMessage - requestId: ${requestId}, error: ${err.message}`);
        socket.emit('send_private_message_response', { requestId, success: false, message: 'خطا در ارسال پیام' });
    }
};

// Load messages and include target user's status
const loadMessages = async (socket, request) => {
    const { requestId, data } = request;
    const { userId: currentUserId, targetUserId } = data;
    console.log(`[Server] Received loadMessages request - requestId: ${requestId}, currentUserId: ${currentUserId}, targetUserId: ${targetUserId}`);
    try {
        const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);
        const targetUserObjectId = new mongoose.Types.ObjectId(targetUserId);

        const chat = await Chat.findOne({
            participants: { $all: [currentUserObjectId, targetUserObjectId] }
        }).populate('messages');

        const messages = chat ? chat.messages.map(msg => ({
            sender: msg.sender.toString(),
            receiver: msg.receiver.toString(),
            message: msg.message,
            timestamp: new Date(msg.timestamp).toISOString().split('T')[0] + ' ' + new Date(msg.timestamp).toTimeString().split(' ')[0].slice(0, 5)
        })) : [];
        console.log(`[Server] Checking userStatusMap for targetUserId: ${targetUserId}`);
        console.log(`[Server] Current userStatusMap: ${JSON.stringify([...socket.userStatusMap.entries()])}`);
        const targetUserStatus = socket.userStatusMap.get(targetUserId) || 'offline';

        console.log(`[Server] Sending loadMessages response - requestId: ${requestId}, messages count: ${messages.length}, targetUserStatus: ${targetUserStatus}`);
        socket.emit('load_messages_response', { 
            requestId, 
            success: true, 
            messages, 
            targetUserStatus
        });
    } catch (err) {
        console.error(`[Server] Error in loadMessages - requestId: ${requestId}, error: ${err.message}`);
        socket.emit('load_messages_response', { requestId, success: false, message: 'خطا در بارگذاری پیام‌ها' });
    }
};

// Send missed messages
const sendMissedMessages = async (socket) => {
    const userId = socket.userId;
    console.log(`[Server] Checking for missed messages for user ${userId}`);
    try {
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const chats = await Chat.find({ participants: userObjectId }).populate('messages');
        const missedMessages = chats.flatMap(chat => chat.messages.filter(msg => msg.receiver.toString() === userId));

        if (missedMessages.length > 0) {
            console.log(`[Server] Sending ${missedMessages.length} missed messages to ${userId}`);
            missedMessages.forEach((msg) => {
                socket.emit('receive_private_message', {
                    requestId: `missed_${msg._id}`,
                    success: true,
                    message: {
                        sender: msg.sender.toString(),
                        receiver: msg.receiver.toString(),
                        message: msg.message,
                        timestamp: new Date(msg.timestamp).toISOString().split('T')[0] + ' ' + new Date(msg.timestamp).toTimeString().split(' ')[0].slice(0, 5)
                    }
                });
            });
        } else {
            console.log(`[Server] No missed messages for ${userId}`);
        }
    } catch (err) {
        console.error(`[Server] Error in sendMissedMessages for user ${userId}: ${err.message}`);
    }
};

// Get user status from the global Map
const getUserStatus = (socket, request) => {
    const { requestId, data } = request;
    const { userId } = data;
    const status = socket.userStatusMap.get(userId) || 'offline';
    socket.emit('get_user_status_response', { requestId, success: true, status });
};

// Register event handlers
module.exports = (io, userStatusMap) => {
    io.on('connection', (socket) => {
        console.log(`[Server] New connection: ${socket.id}`);
        socket.userStatusMap = userStatusMap;

        socket.on('set_user_id', (userId) => {
            socket.userId = userId;
            console.log(`[Server] User ID set for socket ${socket.id}: ${userId}`);
            sendMissedMessages(socket);
        });

        socket.on('send_private_message', (request) => {
            authenticateToken(socket, request, () => sendPrivateMessage(socket, request));
        });

        socket.on('load_messages', (request) => {
            authenticateToken(socket, request, () => loadMessages(socket, request));
        });

        socket.on('get_user_status', (request) => {
            authenticateToken(socket, request, () => getUserStatus(socket, request));
        });
    });

    return { getUserStatus };
};