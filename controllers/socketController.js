const Room = require('../models/Room');
const chatController = require('./chatController');
const { updateUserStatus } = require('../utils/userStatus'); // Import from userStatus.js

// Handle connect event
const handleConnect = (socket, roomDeletionTimers) => {
    console.log(`[${socket.id}] Socket reconnected`);
    if (socket.userId && roomDeletionTimers.has(socket.userId)) {
        clearTimeout(roomDeletionTimers.get(socket.userId));
        roomDeletionTimers.delete(socket.userId);
        console.log(`[${socket.id}] Reconnected user ${socket.userId}, canceled room deletion timer`);
    }
    if (socket.userId) {
        chatController.sendMissedMessages(socket);
        // Use updateUserStatus to set status to online
        updateUserStatus(socket.server, socket.userId, 'online');
    }
};

// Handle disconnect event
const handleDisconnect = async (socket, io, roomDeletionTimers, reason) => {
    console.log(`[${socket.id}] User disconnected, reason: ${reason}`);
    if (socket.userId) {
        // Use updateUserStatus to set status to offline
        updateUserStatus(io, socket.userId, 'offline');

        try {
            const room = await Room.findOne({ creator: socket.userId });
            if (room) {
                console.log(`[${socket.id}] Host ${socket.userId} disconnected from room ${room.roomNumber}, starting 60-second deletion timer`);
                const timer = setTimeout(async () => {
                    try {
                        await Room.deleteOne({ roomNumber: room.roomNumber });
                        io.to(room.roomNumber.toString()).emit('room_deleted', {
                            requestId: null,
                            success: true,
                            roomNumber: room.roomNumber,
                            message: 'اتاق حذف شد زیرا میزبان متصل نبود'
                        });
                        console.log(`[${socket.id}] Room ${room.roomNumber} deleted due to host ${socket.userId} disconnection timeout`);
                        const roomList = await Room.find();
                        io.emit('room_list_update', {
                            rooms: roomList.map(r => ({
                                roomNumber: r.roomNumber,
                                minExperience: r.minExperience,
                                minCoins: r.minCoins,
                                maxPlayers: r.maxPlayers,
                                currentPlayers: r.players.length
                            }))
                        });
                        roomDeletionTimers.delete(socket.userId);
                    } catch (err) {
                        console.error(`[${socket.id}] Error deleting room after timeout: ${err.message}`);
                    }
                }, 60000);
                roomDeletionTimers.set(socket.userId, timer);
            }
        } catch (err) {
            console.error(`[${socket.id}] Error checking room on disconnect: ${err.message}`);
        }
    }
};

// Handle connect error
const handleConnectError = (socket, err) => {
    console.log(`[${socket.id}] Connection error: ${err.message}`);
};

module.exports = { handleConnect, handleDisconnect, handleConnectError };