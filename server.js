const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const { authenticateToken } = require('./middleware/auth');
const { verifyToken, register, login } = require('./controllers/authController');
const { getRoomList, getRoomDetails, getRoomPlayers, createRoom, joinRoom, leaveRoom, startGame, gameLoading } = require('./controllers/roomController');
const { playCard, drawCard, chooseSuit, getGamePlayersInfo, initializeGame, handlePlayerDisconnect } = require('./controllers/gameController');
const { handleConnect, handleConnectError } = require('./controllers/socketController');
const { getProfile, updateProfile, getPendingAvatars, approveAvatar, rejectAvatar, handleAvatarChunk, checkPendingAvatar, checkAvatarStatus } = require('./controllers/profileController');
const { searchUsers, sendFriendRequest, getFriendRequests, acceptFriendRequest, rejectFriendRequest, getFriends } = require('./controllers/friendController');
const chatControllerModule = require('./controllers/chatController');
const { updateUserStatus, userStatusMap } = require('./utils/userStatus');
const Game = require('./models/Game');
const Room = require('./models/Room');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const roomDeletionTimers = new Map();
const gameReadyStatus = new Map(); // Key: gameId, Value: Array of ready userIds

// Express settings
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Middleware to pass io to controllers
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Admin panel routes
app.get('/admin/avatars', (req, res, next) => {
    console.log('Request received for /admin/avatars');
    getPendingAvatars(req, res, next);
});
app.post('/admin/avatars/approve/:id', (req, res, next) => {
    console.log(`Request received for /admin/avatars/approve/${req.params.id}`);
    approveAvatar(req, res, next);
});
app.post('/admin/avatars/reject/:id', (req, res, next) => {
    console.log(`Request received for /admin/avatars/reject/${req.params.id}`);
    rejectAvatar(req, res, next);
});

async function startServer() {
    try {
        await connectDB();
        console.log('Database connection established, starting server...');

        const chatController = chatControllerModule(io, userStatusMap);

        io.on('connection', (socket) => {
            console.log('A user connected:', socket.id);
            console.log(`[${socket.id}] Socket connection established`);

            socket.on('set_user_id', (userId) => {
                console.log(`[${socket.id}] Received set_user_id for userId: ${userId}`);
                socket.userId = userId;
                socket.join(userId);
                console.log(`[${socket.id}] Socket mapped to userId: ${userId}`);
                updateUserStatus(io, userId, 'online');
            });

            socket.on('ready', async (data) => {
                console.log(`[${socket.id}] Received ready event: ${JSON.stringify(data)}`);
                const { data: { gameId, userId }, token } = data;
                try {
                    const decoded = require('jsonwebtoken').decode(token);
                    if (!decoded || decoded.userId !== userId) {
                        console.error(`[${socket.id}] Invalid token for ready event, userId: ${userId}`);
                        return;
                    }

                    // حذف بازی‌های قدیمی کاربر قبل از شروع بازی جدید
                    await Game.deleteMany({
                        'players.userId': userId,
                        gameOver: { $ne: true },
                        gameId: { $ne: gameId }
                    });
                    console.log(`[${socket.id}] Deleted old games for user ${userId} except gameId: ${gameId}`);

                    const game = await Game.findOne({ gameId });
                    if (!game) {
                        console.error(`[${socket.id}] Game not found for gameId: ${gameId}`);
                        return;
                    }

                    const isPlayer = game.players.some(p => p.userId.toString() === userId);
                    if (!isPlayer) {
                        console.error(`[${socket.id}] User ${userId} is not in game ${gameId}`);
                        return;
                    }

                    if (!gameReadyStatus.has(gameId)) {
                        gameReadyStatus.set(gameId, []);
                    }
                    const readyUsers = gameReadyStatus.get(gameId);
                    if (!readyUsers.includes(userId)) {
                        readyUsers.push(userId);
                        console.log(`[Game ${gameId}] User ${userId} marked as ready. Ready users: ${readyUsers}`);
                    } else {
                        console.log(`[Game ${gameId}] User ${userId} already marked as ready, ignoring duplicate`);
                        return;
                    }

                    if (readyUsers.length === game.players.length) {
                        console.log(`[Game ${gameId}] All players ready, starting initializeGame`);
                        await initializeGame(game, io);

                        io.to(game.roomNumber.toString()).emit('game_started', {
                            gameId,
                            roomNumber: game.roomNumber,
                            message: 'بازی شروع شد'
                        });

                        await Room.deleteOne({ roomNumber: game.roomNumber });
                        console.log(`[${socket.id}] Room ${game.roomNumber} deleted because game started`);

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

                        gameReadyStatus.delete(gameId);
                        console.log(`[Game ${gameId}] Ready status cleared`);
                    } else {
                        console.log(`[Game ${gameId}] Waiting for other players to be ready. Ready users: ${readyUsers.length}/${game.players.length}`);
                    }
                } catch (err) {
                    console.error(`[${socket.id}] Error processing ready event: ${err.message}`);
                }
            });

            socket.on('connect', () => handleConnect(socket, roomDeletionTimers));
            socket.on('disconnect', async (reason) => {
                console.log(`[${socket.id}] Socket disconnected, reason: ${reason}`);
                if (socket.userId) {
                    console.log(`[${socket.id}] User ${socket.userId} disconnected`);
                    try {
                        // لاگ تمام بازی‌های کاربر
                        const allGames = await Game.find({ 'players.userId': socket.userId });
                        console.log(`[${socket.id}] All games for user ${socket.userId}: ${JSON.stringify(allGames.map(g => ({ gameId: g.gameId, gameOver: g.gameOver, updatedAt: g.updatedAt })))}`);

                        // بررسی بازی‌های فعال برای کاربر، با اولویت جدیدترین
                        const activeGame = await Game.findOne({
                            'players.userId': socket.userId,
                            gameOver: { $ne: true }
                        }).sort({ updatedAt: -1 }); // مرتب‌سازی بر اساس جدیدترین
                        if (activeGame) {
                            console.log(`[${socket.id}] Found active game ${activeGame.gameId} for user ${socket.userId}, updatedAt: ${activeGame.updatedAt}`);
                            await handlePlayerDisconnect(activeGame, socket.userId, io, 'socket disconnection');
                        } else {
                            console.log(`[${socket.id}] No active game found for user ${socket.userId}`);
                            updateUserStatus(io, socket.userId, 'offline');
                        }

                        // مدیریت حذف اتاق در صورت نیاز
                        const room = await Room.findOne({ 'players.userId': socket.userId });
                        if (room) {
                            console.log(`[${socket.id}] User ${socket.userId} was in room ${room.roomNumber}`);
                            const timer = roomDeletionTimers.get(room.roomNumber);
                            if (timer) clearTimeout(timer);
                            room.players = room.players.filter(p => p.userId.toString() !== socket

.userId.toString());
                            if (room.players.length === 0) {
                                await Room.deleteOne({ roomNumber: room.roomNumber });
                                console.log(`[${socket.id}] Room ${room.roomNumber} deleted due to no players`);
                            } else {
                                await room.save();
                                io.to(room.roomNumber.toString()).emit('room_update', {
                                    roomNumber: room.roomNumber,
                                    players: room.players,
                                    minExperience: room.minExperience,
                                    minCoins: room.minCoins,
                                    maxPlayers: room.maxPlayers
                                });
                            }
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
                        }
                    } catch (err) {
                        console.error(`[${socket.id}] Error handling disconnect: ${err.message}`);
                    }
                }
            });
            socket.on('connect_error', (err) => handleConnectError(socket, err));

            socket.on('verify_token', (data) => {
                console.log(`[${socket.id}] Handling verify_token request`);
                verifyToken(socket, data);
                const { requestId, token } = data;
                if (token) {
                    const decoded = require('jsonwebtoken').decode(token);
                    if (decoded && decoded.userId) {
                        socket.userId = decoded.userId;
                        socket.join(decoded.userId);
                        console.log(`[${socket.id}] Socket mapped to userId after verify_token: ${decoded.userId}`);
                        updateUserStatus(io, decoded.userId, 'online');
                    }
                }
            });

            socket.on('register', (request) => register(socket, request));
            socket.on('login', (request) => login(socket, request));

            socket.on('get_room_list', (request) => {
                authenticateToken(socket, request, () => getRoomList(socket, request, io));
            });
            socket.on('get_room_details', (request) => {
                authenticateToken(socket, request, () => getRoomDetails(socket, request));
            });
            socket.on('get_room_players', (request) => {
                authenticateToken(socket, request, () => getRoomPlayers(socket, request));
            });
            socket.on('create_room', (request) => {
                authenticateToken(socket, request, () => createRoom(socket, request, io));
            });
            socket.on('join_room', (request) => {
                authenticateToken(socket, request, () => joinRoom(socket, request, io));
            });
            socket.on('leave_room', (request) => {
                authenticateToken(socket, request, () => leaveRoom(socket, request, io, roomDeletionTimers));
            });
            socket.on('start_game', (request) => {
                authenticateToken(socket, request, () => {
                    startGame(socket, request, io, (gameId) => {
                        socket.join(gameId);
                        console.log(`[${socket.id}] Socket joined gameId: ${gameId}`);
                        updateUserStatus(io, socket.userId, 'in_game');
                    });
                });
            });
            socket.on('game_loading', (request) => {
                authenticateToken(socket, request, () => gameLoading(socket, request, io));
            });
            socket.on('play_card', (request) => {
                authenticateToken(socket, request, () => playCard(socket, request, io));
            });
            socket.on('draw_card', (request) => {
                authenticateToken(socket, request, () => drawCard(socket, request, io));
            });
            socket.on('choose_suit', (request) => {
                authenticateToken(socket, request, () => chooseSuit(socket, request, io));
            });
            socket.on('get_game_players_info', (request) => {
                authenticateToken(socket, request, () => getGamePlayersInfo(socket, request));
            });
            socket.on('turn_update', (data) => {
                const { gameId, userId } = data;
                io.to(gameId).emit('turn_update', { gameId, currentTurn: userId });
            });
            socket.on('send_in_game_message', (request) => {
                authenticateToken(socket, request, () => {
                    const { requestId, data } = request;
                    const { gameId, userId, message } = data;
                    console.log(`[${socket.id}] Received send_in_game_message: ${JSON.stringify(data)}`);
                    console.log(`[${socket.id}] Broadcasting to gameId: ${gameId}`);
                    io.to(gameId).emit('receive_in_game_message', { userId, message });
                    socket.emit('send_in_game_message_response', { requestId, success: true, message: 'پیام با موفقیت ارسال شد' });
                });
            });

            socket.on('get_profile', (request) => {
                authenticateToken(socket, request, () => getProfile(socket, request));
            });
            socket.on('update_profile', (request) => {
                authenticateToken(socket, request, () => updateProfile(socket, request));
            });

            socket.on('check_pending_avatar', (request) => {
                authenticateToken(socket, request, () => checkPendingAvatar(socket, request));
            });

            socket.on('check_avatar_status', (request) => {
                authenticateToken(socket, request, () => checkAvatarStatus(socket, request));
            });

            socket.on('upload_avatar_init', (data) => handleAvatarChunk(socket, data, null, 'init'));
            socket.on('upload_avatar_chunk', (data, chunk) => handleAvatarChunk(socket, data, chunk, 'chunk'));

            // Friend management events
            socket.on('search_users', (request) => {
                authenticateToken(socket, request, () => searchUsers(socket, request));
            });
            socket.on('send_friend_request', (request) => {
                authenticateToken(socket, request, () => sendFriendRequest(socket, request));
            });
            socket.on('get_friend_requests', (request) => {
                authenticateToken(socket, request, () => getFriendRequests(socket, request));
            });
            socket.on('accept_friend_request', (request) => {
                authenticateToken(socket, request, () => acceptFriendRequest(socket, request));
            });
            socket.on('reject_friend_request', (request) => {
                authenticateToken(socket, request, () => rejectFriendRequest(socket, request));
            });
            socket.on('get_friends', (request) => {
                authenticateToken(socket, request, () => getFriends(socket, request));
            });

            socket.on('get_user_status', (request) => {
                authenticateToken(socket, request, () => chatController.getUserStatus(socket, request));
            });
        });

        server.listen(3000, () => {
            console.log('Server running on port 3000');
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

startServer();