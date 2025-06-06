const Room = require('../models/Room');
const User = require('../models/User');
const Game = require('../models/Game');
const { initializeGame } = require('./gameController');
const { v4: uuidv4 } = require('uuid');

const getRoomList = async (socket, request, io) => {
    console.log(`[${socket.id}] Received get_room_list request`);
    const { requestId } = request;
    try {
        const user = await User.findById(socket.userId);
        console.log(`[${socket.id}] Received get_room_list request by (${user.username})`);
        const roomList = await Room.find();
        socket.emit('get_room_list_response', {
            requestId,
            success: true,
            rooms: roomList.map(r => ({
                roomNumber: r.roomNumber,
                minExperience: r.minExperience,
                minCoins: r.minCoins,
                maxPlayers: r.maxPlayers,
                currentPlayers: r.players.length
            }))
        });
    } catch (err) {
        console.error(`[${socket.id}] Get room list error: ${err.message}`);
        socket.emit('get_room_list_response', {
            requestId,
            success: false,
            message: 'خطا در دریافت لیست روم‌ها'
        });
    }
};

const getRoomDetails = async (socket, request) => {
    console.log(`[${socket.id}] Received get_room_details request`);
    const { requestId, data } = request;
    const { roomNumber } = data;
    try {
        const user = await User.findById(socket.userId);
        console.log(`[${socket.id}] Received get_room_details request by (${user.username})`);
        const room = await Room.findOne({ roomNumber });
        if (!room) {
            console.log(`[${socket.id}] Room not found: ${roomNumber}`);
            socket.emit('get_room_details_response', {
                requestId,
                success: false,
                message: 'روم پیدا نشد'
            });
            return;
        }
        socket.emit('get_room_details_response', {
            requestId,
            success: true,
            room: {
                roomNumber: room.roomNumber,
                minExperience: room.minExperience,
                minCoins: room.minCoins,
                currentPlayers: room.players.length,
                hostId: room.creator.toString(),
                gameId: room.gameId
            }
        });
    } catch (err) {
        console.error(`[${socket.id}] Get room details error: ${err.message}`);
        socket.emit('get_room_details_response', {
            requestId,
            success: false,
            message: 'خطا در دریافت مشخصات روم'
        });
    }
};

const getRoomPlayers = async (socket, request) => {
    console.log(`[${socket.id}] Received get_room_players request`);
    const { requestId, data } = request;
    const { roomNumber } = data;
    try {
        const user = await User.findById(socket.userId);
        console.log(`[${socket.id}] Received get_room_players request by (${user.username})`);
        const room = await Room.findOne({ roomNumber });
        if (!room) {
            console.log(`[${socket.id}] Room not found: ${roomNumber}`);
            socket.emit('get_room_players_response', {
                requestId,
                success: false,
                message: 'روم پیدا نشد'
            });
            return;
        }
        const playersData = await Promise.all(room.players.map(async (playerId) => {
            const player = await User.findById(playerId);
            return { userId: playerId, username: player.username };
        }));
        socket.emit('get_room_players_response', {
            requestId,
            success: true,
            roomNumber: room.roomNumber,
            players: playersData
        });
    } catch (err) {
        console.error(`[${socket.id}] Get room players error: ${err.message}`);
        socket.emit('get_room_players_response', {
            requestId,
            success: false,
            message: 'خطا در دریافت لیست بازیکن‌ها'
        });
    }
};

const createRoom = async (socket, request, io) => {
    console.log(`[${socket.id}] Received create_room request`);
    const { requestId, data } = request;
    const { minExperience, minCoins, userId } = data;
    try {
        const user = await User.findById(socket.userId);
        console.log(`[${socket.id}] Received create_room request by (${user.username})`);
        const lastRoom = await Room.findOne().sort({ roomNumber: -1 });
        const roomNumber = lastRoom ? lastRoom.roomNumber + 1 : 100;
        const gameId = uuidv4();
        const room = new Room({
            roomNumber,
            minExperience,
            minCoins,
            creator: userId,
            players: [userId],
            maxPlayers: 2,
            gameId
        });
        await room.save();

        const game = new Game({
            gameId,
            roomNumber: room.roomNumber,
            players: room.players.map(playerId => ({
                userId: playerId,
                cards: [],
                hasFinished: false,
                collectedCards: [],
                surs: 0
            })),
            deck: [],
            discardPile: [],
            currentPlayerIndex: 0,
            direction: 1,
            currentCard: null,
            currentSuit: null,
            penaltyCount: 0,
            winners: [],
            tableCards: [],
            lastCollector: null
        });
        await game.save();
        console.log(`[${socket.id}] Game created with gameId: ${gameId} for roomNumber: ${roomNumber}`);

        console.log(`[${socket.id}] Attempting to join room ${roomNumber} for socket ${socket.id}`);
        try {
            socket.join(roomNumber.toString());
            const rooms = socket.rooms;
            if (rooms.has(roomNumber.toString())) {
                console.log(`[${socket.id}] Socket successfully joined room ${roomNumber}`);
            } else {
                console.error(`[${socket.id}] Socket failed to join room ${roomNumber}`);
                throw new Error(`Socket failed to join room ${roomNumber}`);
            }
        } catch (joinError) {
            console.error(`[${socket.id}] Error joining room ${roomNumber}: ${joinError.message}`);
            socket.emit('create_room_response', {
                requestId,
                success: false,
                message: 'خطا در پیوستن به روم پس از ایجاد'
            });
            return;
        }

        console.log(`[${socket.id}] Room created, roomNumber: ${room.roomNumber}, gameId: ${gameId}`);
        const playersData = await Promise.all(room.players.map(async (playerId) => {
            const player = await User.findById(playerId);
            return { userId: playerId, username: player.username };
        }));
        socket.emit('create_room_response', {
            requestId,
            success: true,
            roomId: room._id,
            roomNumber: room.roomNumber,
            gameId: room.gameId,
            message: "Room created successfully",
            room: {
                roomNumber: room.roomNumber,
                minExperience: room.minExperience,
                minCoins: room.minCoins,
                maxPlayers: 2,
                currentPlayers: room.players.length,
                gameId: room.gameId
            }
        });
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
        io.to(roomNumber.toString()).emit('room_players_update', {
            roomNumber,
            players: playersData
        });
    } catch (err) {
        console.error(`[${socket.id}] Create room error: ${err.message}`);
        socket.emit('create_room_response', {
            requestId,
            success: false,
            message: 'خطا در ساخت روم'
        });
    }
};

const joinRoom = async (socket, request, io) => {
    console.log(`[${socket.id}] Received join_room request`);
    const { requestId, data } = request;
    const { roomNumber, userId } = data;
    try {
        const user = await User.findById(socket.userId);
        console.log(`[${socket.id}] Received join_room request by (${user.username})`);
        const room = await Room.findOne({ roomNumber });
        if (!room) {
            console.log(`[${socket.id}] Room not found: ${roomNumber}`);
            socket.emit('join_room_response', {
                requestId,
                success: false,
                message: 'روم پیدا نشد'
            });
            return;
        }
        const userCheck = await User.findById(userId);
        if (!userCheck || userCheck.experience < room.minExperience || userCheck.coins < room.minCoins) {
            console.log(`[${socket.id}] User ${userId} does not meet room requirements`);
            socket.emit('join_room_response', {
                requestId,
                success: false,
                message: 'شرایط ورود به روم را ندارید'
            });
            return;
        }
        if (room.players.length >= room.maxPlayers) {
            console.log(`[${socket.id}] Room ${roomNumber} is full`);
            socket.emit('join_room_response', {
                requestId,
                success: false,
                message: 'روم پر است'
            });
            return;
        }
        room.players.push(userId);
        await room.save();

        const game = await Game.findOne({ gameId: room.gameId });
        if (game) {
            game.players = room.players.map(playerId => ({
                userId: playerId,
                cards: [],
                hasFinished: false,
                collectedCards: [],
                surs: 0
            }));
            await game.save();
            console.log(`[${socket.id}] Updated game players for gameId: ${room.gameId}`);
        }

        console.log(`[${socket.id}] Attempting to join room ${roomNumber} for socket ${socket.id}`);
        try {
            socket.join(roomNumber.toString());
            const rooms = socket.rooms;
            if (rooms.has(roomNumber.toString())) {
                console.log(`[${socket.id}] Socket successfully joined room ${roomNumber}`);
            } else {
                console.error(`[${socket.id}] Socket failed to join room ${roomNumber}`);
                throw new Error(`Socket failed to join room ${roomNumber}`);
            }
        } catch (joinError) {
            console.error(`[${socket.id}] Error joining room ${roomNumber}: ${joinError.message}`);
            socket.emit('join_room_response', {
                requestId,
                success: false,
                message: 'خطا در پیوستن به روم'
            });
            return;
        }
        console.log(`[${socket.id}] Current players in room ${roomNumber}: ${room.players}`);
        console.log(`[${socket.id}] User ${userId} joined room ${roomNumber}`);
        const playersData = await Promise.all(room.players.map(async (playerId) => {
            const player = await User.findById(playerId);
            return { userId: playerId, username: player.username };
        }));
        console.log(`[${socket.id}] Sending room_players_update for room ${roomNumber}: ${JSON.stringify(playersData)}`);
        socket.emit('join_room_response', {
            requestId,
            success: true,
            roomId: room._id,
            roomNumber: room.roomNumber,
            gameId: room.gameId,
            message: "Joined room successfully",
            room: {
                roomNumber: room.roomNumber,
                minExperience: room.minExperience,
                minCoins: room.minCoins,
                maxPlayers: room.maxPlayers,
                currentPlayers: room.players.length,
                gameId: room.gameId
            }
        });
        io.to(roomNumber.toString()).emit('room_players_update', {
            roomNumber,
            players: playersData
        });
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
    } catch (err) {
        console.error(`[${socket.id}] Join room error: ${err.message}`);
        socket.emit('join_room_response', {
            requestId,
            success: false,
            message: 'خطا در پیوستن به روم'
        });
    }
};

const leaveRoom = async (socket, request, io, roomDeletionTimers) => {
    console.log(`[${socket.id}] Received leave_room request`);
    const { requestId, data } = request;
    const { roomNumber, userId } = data;
    try {
        const user = await User.findById(socket.userId);
        console.log(`[${socket.id}] Received leave_room request by (${user.username})`);
        const room = await Room.findOne({ roomNumber });
        if (!room) {
            console.log(`[${socket.id}] Room not found: ${roomNumber}`);
            socket.emit('leave_room_response', {
                requestId,
                success: false,
                message: 'روم پیدا نشد'
            });
            return;
        }
        const userIndex = room.players.indexOf(userId);
        if (userIndex === -1) {
            console.log(`[${socket.id}] User ${userId} not in room ${roomNumber}`);
            socket.emit('leave_room_response', {
                requestId,
                success: false,
                message: 'شما در این روم نیستید'
            });
            return;
        }
        room.players.splice(userIndex, 1);
        await room.save();
        socket.leave(roomNumber.toString());
        console.log(`[${socket.id}] User ${userId} left room ${roomNumber}`);
        if (room.creator.toString() === userId) {
            await Game.deleteOne({ gameId: room.gameId });
            console.log(`[${socket.id}] Game deleted for gameId: ${room.gameId} due to room deletion`);
            await Room.deleteOne({ roomNumber });
            io.to(roomNumber.toString()).emit('room_deleted', {
                requestId: null,
                success: true,
                roomNumber,
                message: 'میزبان از روم خارج شد، روم حذف شد'
            });
            console.log(`[${socket.id}] Room ${roomNumber} deleted because host ${userId} left`);
            if (roomDeletionTimers.has(userId)) {
                clearTimeout(roomDeletionTimers.get(userId));
                roomDeletionTimers.delete(userId);
                console.log(`[${socket.id}] Canceled disconnection timer for host ${userId} due to explicit leave`);
            }
        } else {
            const playersData = await Promise.all(room.players.map(async (playerId) => {
                const player = await User.findById(playerId);
                return { userId: playerId, username: player.username };
            }));
            io.to(roomNumber.toString()).emit('room_players_update', {
                roomNumber,
                players: playersData
            });
        }
        socket.emit('leave_room_response', {
            requestId,
            success: true,
            message: 'با موفقیت از روم خارج شدید',
            isHost: room.creator.toString() === userId,
            roomNumber
        });
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
    } catch (err) {
        console.error(`[${socket.id}] Leave room error: ${err.message}`);
        socket.emit('leave_room_response', {
            requestId,
            success: false,
            message: 'خطا در خروج از روم'
        });
    }
};

const gameLoading = async (socket, request, io) => {
    console.log(`[${socket.id}] Received game_loading request: ${JSON.stringify(request)}`);
    const { requestId, data } = request;
    const { roomNumber } = data;
    try {
        const user = await User.findById(socket.userId);
        if (!user) {
            console.log(`[${socket.id}] User not found: ${socket.userId}`);
            socket.emit('game_loading_response', {
                requestId,
                success: false,
                message: 'کاربر پیدا نشد'
            });
            return;
        }
        console.log(`[${socket.id}] Received game_loading request by (${user.username})`);
        const room = await Room.findOne({ roomNumber });
        if (!room) {
            console.log(`[${socket.id}] Room not found: ${roomNumber}`);
            socket.emit('game_loading_response', {
                requestId,
                success: false,
                message: 'روم پیدا نشد'
            });
            return;
        }
        if (room.creator.toString() !== socket.userId) {
            console.log(`[${socket.id}] User ${socket.userId} is not the host of room ${roomNumber}`);
            socket.emit('game_loading_response', {
                requestId,
                success: false,
                message: 'فقط میزبان می‌تواند بازی را شروع کند'
            });
            return;
        }
        if (room.players.length !== room.maxPlayers) {
            console.log(`[${socket.id}] Room ${roomNumber} is not full (current: ${room.players.length}, max: ${room.maxPlayers})`);
            socket.emit('game_loading_response', {
                requestId,
                success: false,
                message: 'ظرفیت روم باید تکمیل باشد'
            });
            return;
        }

        io.to(roomNumber.toString()).emit('game_loading', {
            roomNumber,
            message: 'در حال بارگذاری بازی...'
        });

        socket.emit('game_loading_response', {
            requestId,
            success: true,
            message: 'در حال انتقال به بازی...'
        });
    } catch (err) {
        console.error(`[${socket.id}] Game loading error: ${err.message}`);
        socket.emit('game_loading_response', {
            requestId,
            success: false,
            message: 'خطا در بارگذاری بازی'
        });
    }
};

const startGame = async (socket, request, io) => {
    console.log(`[${socket.id}] Received start_game request`);
    const { requestId, data } = request;
    const { roomNumber } = data;
    try {
        const user = await User.findById(socket.userId);
        console.log(`[${socket.id}] Received start_game request by (${user.username})`);
        const room = await Room.findOne({ roomNumber });
        if (!room) {
            console.log(`[${socket.id}] Room not found: ${roomNumber}`);
            socket.emit('start_game_response', {
                requestId,
                success: false,
                message: 'روم پیدا نشد'
            });
            return;
        }
        if (room.creator.toString() !== socket.userId) {
            console.log(`[${socket.id}] User ${socket.userId} is not the host of room ${roomNumber}`);
            socket.emit('start_game_response', {
                requestId,
                success: false,
                message: 'فقط میزبان می‌تواند بازی را شروع کند'
            });
            return;
        }
        if (room.players.length !== room.maxPlayers) {
            console.log(`[${socket.id}] Room ${roomNumber} is not full (current: ${room.players.length}, max: ${room.maxPlayers})`);
            socket.emit('start_game_response', {
                requestId,
                success: false,
                message: 'ظرفیت روم باید تکمیل باشد'
            });
            return;
        }

        const game = await Game.findOne({ gameId: room.gameId });
        if (!game) {
            console.log(`[${socket.id}] Game not found for gameId: ${room.gameId}`);
            socket.emit('start_game_response', {
                requestId,
                success: false,
                message: 'بازی پیدا نشد'
            });
            return;
        }

        socket.emit('start_game_response', {
            requestId,
            success: true,
            gameId: room.gameId,
            message: 'منتظر آماده شدن بازیکنان...'
        });
        console.log(`[${socket.id}] Sent start_game_response, waiting for players to be ready`);
    } catch (err) {
        console.error(`[${socket.id}] Start game error: ${err.message}`);
        socket.emit('start_game_response', {
            requestId,
            success: false,
            message: 'خطا در شروع بازی'
        });
    }
};

module.exports = { getRoomList, getRoomDetails, getRoomPlayers, createRoom, joinRoom, leaveRoom, gameLoading, startGame };