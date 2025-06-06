const Game = require('../models/Game');
const Room = require('../models/Room');
const User = require('../models/User');
const { updateUserStatus } = require('../utils/userStatus');
const { v4: uuidv4 } = require('uuid'); // برای تولید شناسه یکتا

// Map to store active turn timers for each game
const turnTimers = new Map(); // Key: gameId, Value: { timerId, timeout }

// Map to store timeouts for continue_game fallback
const continueGameTimeouts = new Map(); // Key: gameId, Value: { timerId, userId }

// Map to track initial animation completions for each game
const initialAnimationCompletions = new Map(); // Key: gameId, Value: Set of userIds

// Handle player disconnection
async function handlePlayerDisconnect(game, userId, io, reason = 'repeated inactivity') {
    console.log(`[Game ${game.gameId}] Player ${userId} disconnected due to ${reason}`);
    
    io.to(game.gameId).emit('player_disconnected', {
        gameId: game.gameId,
        userId,
        reason,
        message: `بازیکن ${userId} به دلیل ${reason === 'repeated inactivity' ? 'عدم فعالیت مکرر' : 'قطع اتصال'} از بازی خارج شد`
    });

    const remainingPlayer = game.players.find(p => p.userId.toString() !== userId);
    const winner = remainingPlayer ? remainingPlayer.userId : null;

    updateUserStatus(io, userId, 'offline');
    if (remainingPlayer) {
        updateUserStatus(io, remainingPlayer.userId.toString(), 'online');
    }

    game.gameOver = true;
    const endGamePayload = {
        gameId: game.gameId,
        roomNumber: game.roomNumber,
        players: game.players.map(p => ({ userId: p.userId, cardCount: p.cards.length })),
        tableCards: [],
        collectedCards: game.players.map(p => ({ userId: p.userId, cards: p.collectedCards })),
        surs: game.players.map(p => ({ userId: p.userId, count: p.surs || 0 })),
        winner,
        gameOver: true,
        reason,
        message: `بازی به دلیل خروج بازیکن ${userId} متوقف شد. ${winner ? `بازیکن ${winner} برنده است.` : 'بدون برنده'}`
    };
    io.to(game.gameId).emit('game_state_update', endGamePayload);
    await game.save();
    console.log(`[Game ${game.gameId}] Game stopped due to disconnection of player ${userId}, winner: ${winner}`);

    await Game.deleteOne({ gameId: game.gameId });
    console.log(`[Game ${game.gameId}] Game deleted from database`);

    clearTurnTimer(game.gameId);
    clearContinueGameTimeout(game.gameId);
    initialAnimationCompletions.delete(game.gameId); // Clean up animation completions
}

// Start a 15-second turn timer for the current player
async function startTurnTimer(game, io) {
    const gameId = game.gameId;
    const currentPlayerIndex = game.currentPlayerIndex;
    const userId = game.players[currentPlayerIndex].userId.toString();
    const turnStartTime = Date.now();
    let remainingTime = 15;

    clearTurnTimer(gameId);

    const sendTimerUpdate = () => {
        io.to(gameId).emit('turn_timer_update', {
            gameId,
            userId,
            remainingTime
        });
        console.log(`[Game ${gameId}] Turn timer update sent: ${remainingTime}s remaining for user ${userId}`);
    };

    sendTimerUpdate();

    const timerId = setInterval(async () => {
        const elapsed = Math.floor((Date.now() - turnStartTime) / 1000);
        remainingTime = 15 - elapsed;

        if (remainingTime <= 0) {
            console.log(`[Game ${gameId}] Turn timeout for user ${userId}`);
            clearTurnTimer(gameId);

            const updatedGame = await Game.findOne({ gameId });
            if (!updatedGame) {
                console.error(`[Game ${gameId}] Game not found during timeout handling`);
                return;
            }

            const currentPlayer = updatedGame.players[currentPlayerIndex];
            if (!currentPlayer) {
                console.error(`[Game ${gameId}] Current player not found at index ${currentPlayerIndex}`);
                return;
            }

            currentPlayer.consecutiveTimeouts = (currentPlayer.consecutiveTimeouts || 0) + 1;
            console.log(`[Game ${gameId}] Consecutive timeouts for user ${userId}: ${currentPlayer.consecutiveTimeouts}`);

            await updatedGame.save();

            if (currentPlayer.consecutiveTimeouts >= 3) {
                await handlePlayerDisconnect(updatedGame, userId, io, 'repeated inactivity');
                return;
            }

            const player = updatedGame.players.find(p => p.userId.toString() === userId);
            if (player && player.cards.length > 0) {
                const randomIndex = Math.floor(Math.random() * player.cards.length);
                const randomCard = player.cards[randomIndex];
                console.log(`[Game ${gameId}] Automatically playing random card: ${JSON.stringify(randomCard)} for user ${userId}`);

                const request = {
                    requestId: `auto_${Date.now()}`,
                    data: {
                        gameId,
                        userId,
                        card: randomCard,
                        tableCards: []
                    }
                };

                await playCard({ id: `server_${gameId}`, isAutomatic: true }, request, io);
                console.log(`[Game ${gameId}] Random card ${JSON.stringify(randomCard)} successfully played`);
            } else {
                console.error(`[Game ${gameId}] No cards available to play for user ${userId}`);
                updatedGame.currentPlayerIndex = (updatedGame.currentPlayerIndex + 1) % updatedGame.players.length;
                await updatedGame.save();
                startTurnTimer(updatedGame, io);
            }
        } else {
            sendTimerUpdate();
        }
    }, 1000);

    turnTimers.set(gameId, { timerId, timeout: turnStartTime + 15000 });
}

// Clear the turn timer for a game
function clearTurnTimer(gameId) {
    const timerInfo = turnTimers.get(gameId);
    if (timerInfo) {
        clearInterval(timerInfo.timerId);
        turnTimers.delete(gameId);
        console.log(`[Game ${gameId}] Turn timer cleared`);
    }
}

// Clear the continue_game timeout for a game
function clearContinueGameTimeout(gameId) {
    const timerInfo = continueGameTimeouts.get(gameId);
    if (timerInfo) {
        clearTimeout(timerInfo.timerId);
        continueGameTimeouts.delete(gameId);
        console.log(`[Game ${gameId}] Continue game timeout cleared`);
    }
}

const initializeGame = async (game, io) => {
    const suits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];
    let deck = [];

    console.log(`[Game ${game.gameId}] Starting initializeGame for roomNumber: ${game.roomNumber}`);

    // ایجاد دست کارت‌ها با شناسه یکتا
    for (let suit of suits) {
        for (let value of values) {
            deck.push({ suit, value, cardId: uuidv4() });
        }
    }

    // بررسی یکتایی کارت‌ها
    const uniqueCardCount = new Set(deck.map(card => `${card.suit}-${card.value}`)).size;
    if (uniqueCardCount !== 52) {
        console.error(`[Game ${game.gameId}] Deck creation failed: Expected 52 unique cards, but got ${uniqueCardCount}`);
        throw new Error('Failed to create a unique deck');
    }

    deck = shuffle(deck);
    console.log(`[Game ${game.gameId}] Deck created and shuffled, size: ${deck.length}, unique cards: ${uniqueCardCount}`);

    if (game.players.length !== 2) {
        console.error(`[Game ${game.gameId}] Invalid number of players: ${game.players.length}. Expected 2.`);
        return;
    }

    game.players.forEach(player => {
        player.cards = deck.splice(0, 4);
        player.collectedCards = [];
        player.surs = 0;
        player.consecutiveTimeouts = 0;
        console.log(`[Game ${game.gameId}] Assigned cards to player ${player.userId}: ${JSON.stringify(player.cards)}`);
    });

    let tableCards = [];
    while (tableCards.length < 4) {
        let card = deck.pop();
        if (card.value !== 'Jack') {
            tableCards.push(card);
        } else {
            // اگر کارت Jack بود، آن را به دست برگردانیم و دوباره انتخاب کنیم
            deck.push(card);
            deck = shuffle(deck); // دوباره دست را هم بزنیم تا از تکرار جلوگیری شود
        }
    }
    game.deck = deck;
    game.tableCards = tableCards;
    game.lastCollector = null;
    game.gameOver = false;
    console.log(`[Game ${game.gameId}] Table cards assigned: ${JSON.stringify(tableCards)}`);
    console.log(`[Game ${game.gameId}] Remaining deck size: ${deck.length}`);

    // بررسی یکتایی کارت‌های توزیع‌شده
    const allAssignedCards = [
        ...game.players[0].cards,
        ...game.players[1].cards,
        ...tableCards
    ];
    const uniqueAssignedCards = new Set(allAssignedCards.map(card => card.cardId));
    if (uniqueAssignedCards.size !== allAssignedCards.length) {
        console.error(`[Game ${game.gameId}] Duplicate cards detected in distribution: Expected ${allAssignedCards.length} unique cards, but got ${uniqueAssignedCards.size}`);
        throw new Error('Duplicate cards detected in distribution');
    }

    await game.save();
    console.log(`[Game ${game.gameId}] Game saved to database`);

    game.players.forEach(player => {
        const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === player.userId.toString());
        if (targetSocket) {
            targetSocket.join(game.gameId);
            console.log(`[Game ${game.gameId}] Socket ${targetSocket.id} joined gameId: ${game.gameId}`);
            updateUserStatus(io, player.userId.toString(), 'in_game');
        } else {
            console.error(`[Game ${game.gameId}] No socket found for userId: ${player.userId}`);
        }
    });

    game.players.forEach(player => {
        const payload = {
            gameId: game.gameId,
            userId: player.userId,
            cards: player.cards.map(card => ({ suit: card.suit, value: card.value, cardId: card.cardId })),
            tableCards: game.tableCards.map(card => ({ suit: card.suit, value: card.value, cardId: card.cardId }))
        };
        const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === player.userId.toString());
        if (targetSocket) {
            targetSocket.emit('player_cards', payload);
            console.log(`[Game ${game.gameId}] Sent player_cards to ${player.userId}: ${JSON.stringify(payload)}`);
        } else {
            console.error(`[Game ${game.gameId}] No socket found for userId: ${player.userId}`);
        }
    });

    const statePayload = {
        gameId: game.gameId,
        roomNumber: game.roomNumber,
        players: game.players.map(p => ({ userId: p.userId, cardCount: p.cards.length })),
        tableCards: game.tableCards.map(card => ({ suit: card.suit, value: card.value, cardId: card.cardId })),
        currentTurn: game.players[game.currentPlayerIndex].userId
    };
    io.to(game.gameId).emit('game_state_update', statePayload);
    console.log(`[Game ${game.gameId}] Sent game_state_update: ${JSON.stringify(statePayload)}`);

    // Initialize animation completions tracking
    initialAnimationCompletions.set(game.gameId, new Set());
    console.log(`[Game ${game.gameId}] Waiting for initial animation completions from players`);
};

const shuffle = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

const initialAnimationComplete = async (socket, request, io) => {
    const { requestId, data } = request;
    const { gameId, userId } = data;
    console.log(`[Game ${gameId}] [${socket.id}] Received initial_animation_complete request - User: ${userId}`);

    try {
        const game = await Game.findOne({ gameId });
        if (!game) {
            socket.emit('initial_animation_complete_response', { requestId, success: false, message: 'بازی پیدا نشد' });
            console.error(`[Game ${gameId}] [${socket.id}] Game not found for gameId: ${gameId}`);
            return;
        }

        const completions = initialAnimationCompletions.get(gameId) || new Set();
        completions.add(userId);
        initialAnimationCompletions.set(gameId, completions);

        socket.emit('initial_animation_complete_response', { requestId, success: true, message: 'انیمیشن اولیه تکمیل شد' });
        console.log(`[Game ${gameId}] [${socket.id}] Initial animation completed for user ${userId}, total completions: ${completions.size}`);

        if (completions.size === game.players.length) {
            console.log(`[Game ${gameId}] All players completed initial animations, starting turn timer`);
            startTurnTimer(game, io);
            initialAnimationCompletions.delete(gameId); // Clean up
        }
    } catch (err) {
        socket.emit('initial_animation_complete_response', { requestId, success: false, message: 'خطا در پردازش انیمیشن اولیه' });
        console.error(`[Game ${gameId}] [${socket.id}] Error in initialAnimationComplete: ${err.message}`);
    }
};

const getGamePlayersInfo = async (socket, request) => {
    const { requestId, data } = request;
    const { gameId, userId } = data;
    console.log(`[${socket.id}] Received get_game_players_info request for gameId: ${gameId}, userId: ${userId}`);
    try {
        const game = await Game.findOne({ gameId });
        if (!game) {
            socket.emit('get_game_players_info_response', { requestId, success: false, message: 'بازی پیدا نشد' });
            return;
        }

        const playersInfo = [];
        for (const player of game.players) {
            const user = await User.findById(player.userId);
            if (!user) continue;
            playersInfo.push({
                userId: player.userId.toString(),
                username: user.username,
                exp: user.exp || 0,
                coins: user.coins || 0
            });
        }

        socket.emit('get_game_players_info_response', { requestId, success: true, players: playersInfo });
        console.log(`[${socket.id}] Sent get_game_players_info_response: ${JSON.stringify({ requestId, success: true, players: playersInfo })}`);
    } catch (err) {
        socket.emit('get_game_players_info_response', { requestId, success: false, message: 'خطا در دریافت اطلاعات بازیکن‌ها' });
        console.error(`[${socket.id}] Error in get_game_players_info: ${err.message}`);
    }
};

const getPlayerCards = async (socket, request) => {
    const { requestId, data } = request;
    const { gameId, userId } = data;
    console.log(`[${socket.id}] Received get_player_cards request for gameId: ${gameId}, userId: ${userId}`);
    try {
        const game = await Game.findOne({ gameId });
        if (!game) {
            socket.emit('get_player_cards_response', { requestId, success: false, message: 'بازی پیدا نشد' });
            return;
        }
        const player = game.players.find(p => p.userId.toString() === userId);
        if (!player) {
            socket.emit('get_player_cards_response', { requestId, success: false, message: 'شما در این بازی نیستید' });
            return;
        }
        const payload = {
            gameId: game.gameId,
            userId,
            cards: player.cards.map(card => ({ suit: card.suit, value: card.value, cardId: card.cardId })),
            tableCards: game.tableCards.map(card => ({ suit: card.suit, value: card.value, cardId: card.cardId })) || []
        };
        socket.emit('player_cards', payload);
        socket.emit('get_player_cards_response', { requestId, success: true, message: 'کارت‌ها با موفقیت ارسال شد' });
        console.log(`[${socket.id}] Sent player_cards and response: ${JSON.stringify(payload)}`);
    } catch (err) {
        socket.emit('get_player_cards_response', { requestId, success: false, message: 'خطا در دریافت کارت‌ها' });
        console.error(`[${socket.id}] Error in get_player_cards: ${err.message}`);
    }
};

const calculateScores = (players) => {
    const scores = players.map(player => {
        let score = 0;
        const collectedCards = player.collectedCards;

        const clubsCount = collectedCards.filter(card => card.suit === 'Clubs').length;

        const surScore = (player.surs || 0) * 5;
        const tenDiamonds = collectedCards.some(card => card.suit === 'Diamonds' && card.value === '10') ? 3 : 0;
        const twoClubs = collectedCards.some(card => card.suit === 'Clubs' && card.value === '2') ? 2 : 0;
        const jackCount = collectedCards.filter(card => card.value === 'Jack').length;
        const aceCount = collectedCards.filter(card => card.value === 'Ace').length;

        return { userId: player.userId, clubsCount, surScore, tenDiamonds, twoClubs, jackCount, aceCount };
    });

    const player1 = scores[0];
    const player2 = scores[1];
    if (player1.clubsCount >= 7) {
        player1.score = 7 + player1.surScore + player1.tenDiamonds + player1.twoClubs + player1.jackCount + player1.aceCount;
        player2.score = player2.surScore + player2.tenDiamonds + player2.twoClubs + player2.jackCount + player2.aceCount;
    } else if (player2.clubsCount >= 7) {
        player2.score = 7 + player2.surScore + player2.tenDiamonds + player2.twoClubs + player2.jackCount + player2.aceCount;
        player1.score = player1.surScore + player1.tenDiamonds + player1.twoClubs + player1.jackCount + player1.aceCount;
    }

    const winner = player1.score > player2.score ? player1.userId : player2.userId;

    return {
        scores: scores.map(s => ({ userId: s.userId, score: s.score || 0 })),
        winner
    };
};

const playCard = async (socket, request, io) => {
    const startTime = Date.now();
    const { requestId, data } = request;
    const { gameId, userId, card, tableCards: selectedTableCards } = data;
    const isAutomatic = socket.isAutomatic || false;

    console.log(`[Game ${gameId}] [${socket.id}] Received play_card request - User: ${userId}, Card: ${JSON.stringify(card)}, SelectedTableCards: ${JSON.stringify(selectedTableCards)}`);
    try {
        const game = await Game.findOne({ gameId });
        if (!game) {
            if (!isAutomatic) {
                socket.emit('play_card_response', { requestId, success: false, message: 'بازی پیدا نشد' });
            }
            return;
        }

        const currentPlayer = game.players[game.currentPlayerIndex];
        if (currentPlayer.userId.toString() !== userId) {
            if (!isAutomatic) {
                socket.emit('play_card_response', { requestId, success: false, message: 'نوبت شما نیست' });
            }
            return;
        }

        const playerCardIndex = currentPlayer.cards.findIndex(c => c.cardId === card.cardId);
        if (playerCardIndex === -1) {
            if (!isAutomatic) {
                socket.emit('play_card_response', { requestId, success: false, message: 'کارت در دست شما نیست' });
            }
            return;
        }

        clearTurnTimer(gameId);

        if (!isAutomatic) {
            currentPlayer.consecutiveTimeouts = 0;
            console.log(`[Game ${gameId}] [${socket.id}] Consecutive timeouts reset to 0 for user ${userId} due to manual play`);
        }

        const cardValue = getCardValue(card.value);
        let collectedCards = [];
        let cardAdded = false;
        let surEvent = false;

        if (card.value === 'Jack') {
            collectedCards = game.tableCards.filter(tc => tc.value !== 'King' && tc.value !== 'Queen');
            game.tableCards = game.tableCards.filter(tc => tc.value === 'King' || tc.value === 'Queen');
            console.log(`[Game ${gameId}] [${socket.id}] Jack played, collected: ${JSON.stringify(collectedCards)}, remaining table: ${JSON.stringify(game.tableCards)}`);
        } else if (cardValue <= 10) {
            const combinations = findCombinations(game.tableCards, cardValue);
            console.log(`[Game ${gameId}] [${socket.id}] Calculated combinations for value ${cardValue}: ${combinations.length} options`);
            if (combinations.length > 1 && (!selectedTableCards || selectedTableCards.length === 0)) {
                if (isAutomatic) {
                    const randomComboIndex = Math.floor(Math.random() * combinations.length);
                    collectedCards = combinations[randomComboIndex];
                    console.log(`[Game ${gameId}] [${socket.id}] Automatic play: Randomly selected combination to collect: ${JSON.stringify(collectedCards)}`);
                    game.tableCards = game.tableCards.filter(tc => !collectedCards.some(c => c.cardId === tc.cardId));
                } else {
                    const payload = {
                        gameId: game.gameId,
                        userId: userId,
                        card: { suit: card.suit, value: card.value, cardId: card.cardId },
                        combinations: combinations.map(combo => combo.map(c => ({ suit: c.suit, value: c.value, cardId: c.cardId })))
                    };
                    socket.emit('select_combination', payload);
                    console.log(`[Game ${gameId}] [${socket.id}] Sent select_combination with ${combinations.length} options`);
                    return;
                }
            } else if (combinations.length === 1) {
                collectedCards = combinations[0];
                console.log(`[Game ${gameId}] [${socket.id}] Single combination found, collected: ${JSON.stringify(collectedCards)}`);
                game.tableCards = game.tableCards.filter(tc => !collectedCards.some(c => c.cardId === tc.cardId));
            } else if (selectedTableCards && selectedTableCards.length > 0) {
                const selectedCards = selectedTableCards.map(c => ({
                    suit: c.suit,
                    value: c.value,
                    cardId: c.cardId
                }));
                const validCombination = combinations.some(combo =>
                    combo.length === selectedCards.length &&
                    combo.every(c => selectedCards.some(sc => sc.cardId === c.cardId))
                );
                if (validCombination) {
                    collectedCards = selectedCards;
                    console.log(`[Game ${gameId}] [${socket.id}] Valid combination selected, collected: ${JSON.stringify(collectedCards)}`);
                    game.tableCards = game.tableCards.filter(tc => !collectedCards.some(c => c.cardId === tc.cardId));
                } else {
                    if (!isAutomatic) {
                        socket.emit('play_card_response', { requestId, success: false, message: 'ترکیب انتخاب‌شده معتبر نیست' });
                    }
                    console.log(`[Game ${gameId}] [${socket.id}] Invalid combination selected: ${JSON.stringify(selectedCards)}`);
                    return;
                }
            } else if (combinations.length === 0) {
                game.tableCards.push(card);
                cardAdded = true;
                console.log(`[Game ${gameId}] [${socket.id}] No combinations available, card added to table: ${JSON.stringify(card)}`);
            }
        } else if (card.value === 'King' || card.value === 'Queen') {
            const matchingCards = game.tableCards.filter(tc => tc.value === card.value);
            if (matchingCards.length > 1 && (!selectedTableCards || selectedTableCards.length === 0)) {
                if (isAutomatic) {
                    const randomCardIndex = Math.floor(Math.random() * matchingCards.length);
                    collectedCards.push(matchingCards[randomCardIndex]);
                    game.tableCards = game.tableCards.filter(tc => tc.cardId !== matchingCards[randomCardIndex].cardId);
                    console.log(`[Game ${gameId}] [${socket.id}] Automatic play: Randomly selected card to collect: ${JSON.stringify(collectedCards)}`);
                } else {
                    const payload = {
                        gameId: game.gameId,
                        userId: userId,
                        card: { suit: card.suit, value: card.value, cardId: card.cardId },
                        options: matchingCards.map(c => ({ suit: c.suit, value: c.value, cardId: c.cardId }))
                    };
                    socket.emit('select_king_or_queen', payload);
                    console.log(`[Game ${gameId}] [${socket.id}] Sent select_king_or_queen with ${matchingCards.length} options`);
                    return;
                }
            } else if (matchingCards.length === 1) {
                collectedCards.push(matchingCards[0]);
                game.tableCards = game.tableCards.filter(tc => tc.cardId !== matchingCards[0].cardId);
                console.log(`[Game ${gameId}] [${socket.id}] Single matching card collected: ${JSON.stringify(collectedCards)}`);
            } else if (selectedTableCards && selectedTableCards.length === 1) {
                const selectedCard = selectedTableCards[0];
                const validCard = matchingCards.find(c => c.cardId === selectedCard.cardId);
                if (validCard) {
                    collectedCards.push(validCard);
                    game.tableCards = game.tableCards.filter(tc => tc.cardId !== validCard.cardId);
                    console.log(`[Game ${gameId}] [${socket.id}] Valid card selected, collected: ${JSON.stringify(collectedCards)}`);
                } else {
                    if (!isAutomatic) {
                        socket.emit('play_card_response', { requestId, success: false, message: 'کارت انتخاب‌شده معتبر نیست' });
                    }
                    console.log(`[Game ${gameId}] [${socket.id}] Invalid card selected: ${JSON.stringify(selectedCard)}`);
                    return;
                }
            } else if (matchingCards.length === 0) {
                game.tableCards.push(card);
                cardAdded = true;
                console.log(`[Game ${gameId}] [${socket.id}] No matching cards, card added to table: ${JSON.stringify(card)}`);
            }
        }

        if (collectedCards.length > 0 && game.tableCards.length === 0 && card.value !== 'Jack' && game.deck.length >= 8) {
            currentPlayer.surs = (currentPlayer.surs || 0) + 1;
            surEvent = true;
            console.log(`[Game ${gameId}] [${socket.id}] Sur event triggered, new sur count: ${currentPlayer.surs}`);
        }

        if (collectedCards.length > 0) {
            currentPlayer.collectedCards.push(...collectedCards, card);
            game.lastCollector = currentPlayer.userId;
            console.log(`[Game ${gameId}] [${socket.id}] Cards collected by ${userId}, total collected: ${currentPlayer.collectedCards.length}`);
        } else if (!cardAdded) {
            game.tableCards.push(card);
            console.log(`[Game ${gameId}] [${socket.id}] Card added to table: ${JSON.stringify(card)}`);
        }
        currentPlayer.cards.splice(playerCardIndex, 1);

        await game.save();

        const playedCardPayload = {
            gameId: game.gameId,
            userId: userId,
            card: { suit: card.suit, value: card.value, cardId: card.cardId },
            isCollected: collectedCards.length > 0,
            tableCards: collectedCards.map(c => ({ suit: c.suit, value: c.value, cardId: c.cardId })),
            surEvent: surEvent
        };
        io.to(game.gameId).emit('played_card', playedCardPayload);
        console.log(`[Game ${gameId}] [${socket.id}] Sent played_card event with tableCards: ${JSON.stringify(playedCardPayload.tableCards)}`);

        if (!isAutomatic) {
            socket.emit('play_card_response', { requestId, success: true, message: 'کارت با موفقیت بازی شد' });
        }

        const fallbackTimeout = setTimeout(async () => {
            console.log(`[Game ${gameId}] [${socket.id}] Fallback: No continue_game request received for user ${userId}, proceeding automatically`);
            const fallbackRequest = {
                requestId: `fallback_${Date.now()}`,
                data: {
                    gameId: game.gameId,
                    userId: userId
                }
            };
            await continueGameAfterAnimation(socket, fallbackRequest, io);
        }, 3000);

        continueGameTimeouts.set(gameId, { timerId: fallbackTimeout, userId });
        console.log(`[Game ${gameId}] [${socket.id}] Waiting for client to send continue_game request, fallback timeout set, took ${Date.now() - startTime}ms`);

    } catch (err) {
        if (!isAutomatic) {
            socket.emit('play_card_response', { requestId, success: false, message: 'خطا در بازی کردن کارت' });
        }
        console.error(`[Game ${gameId}] [${socket.id}] Error in playCard: ${err.message}`);
    }
};

const continueGameAfterAnimation = async (socket, request, io) => {
    const startTime = Date.now();
    const { requestId, data } = request;
    const { gameId, userId } = data;
    const isAutomatic = socket.isAutomatic || false;

    console.log(`[Game ${gameId}] [${socket.id}] Received continue_game request - User: ${userId}, RequestId: ${requestId}, at ${startTime}`);

    clearContinueGameTimeout(gameId);

    try {
        const game = await Game.findOne({ gameId }).lean();
        if (!game) {
            if (!isAutomatic) {
                socket.emit('continue_game_response', { requestId, success: false, message: 'بازی پیدا نشد' });
            }
            console.error(`[Game ${gameId}] [${socket.id}] Game not found for gameId: ${gameId}`);
            return;
        }

        console.log(`[Game ${gameId}] [${socket.id}] Game found, current state: players=${game.players.length}, deck=${game.deck.length}, gameOver=${game.gameOver}`);

        let gameUpdate = {};
        const allPlayersDone = game.players.every(p => p.cards.length === 0);
        if (allPlayersDone && game.deck.length < 8) {
            console.log(`[Game ${gameId}] [${socket.id}] All players done. Deck size: ${game.deck.length}, Last collector: ${game.lastCollector}`);
            gameUpdate.tableCards = [];
            gameUpdate.gameOver = true;
            if (game.tableCards.length > 0) {
                let lastCollectorPlayer = game.lastCollector
                    ? game.players.find(p => p.userId.toString() === game.lastCollector.toString())
                    : game.players[game.currentPlayerIndex];
                if (!lastCollectorPlayer) {
                    lastCollectorPlayer = game.players[game.currentPlayerIndex];
                    gameUpdate.lastCollector = lastCollectorPlayer.userId;
                    console.log(`[Game ${gameId}] [${socket.id}] No previous lastCollector, assigned to current player: ${gameUpdate.lastCollector}`);
                }
                lastCollectorPlayer.collectedCards.push(...game.tableCards);
                console.log(`[Game ${gameId}] [${socket.id}] Remaining table cards assigned to last collector ${lastCollectorPlayer.userId}: ${JSON.stringify(game.tableCards)}`);
            }

            const { scores, winner } = calculateScores(game.players);

            const endGamePayload = {
                gameId: game.gameId,
                roomNumber: game.roomNumber,
                players: game.players.map(p => ({ userId: p.userId, cardCount: p.cards.length })),
                tableCards: [],
                collectedCards: game.players.map(p => ({ userId: p.userId, cards: p.collectedCards.map(card => ({ suit: card.suit, value: card.value, cardId: card.cardId })) })),
                surs: game.players.map(p => ({ userId: p.userId, count: p.surs || 0 })),
                scores,
                winner,
                gameOver: true
            };
            io.to(game.gameId).emit('game_state_update', endGamePayload);
            await Game.updateOne({ gameId }, gameUpdate);
            console.log(`[Game ${gameId}] [${socket.id}] Final game state saved to database with scores: ${JSON.stringify(scores)} and winner: ${winner}`);

            if (!isAutomatic) {
                socket.emit('continue_game_response', { requestId, success: true, message: 'بازی پایان یافت' });
            }

            await Game.deleteOne({ gameId: game.gameId });
            console.log(`[Game ${gameId}] Game deleted from database`);

            game.players.forEach(player => {
                updateUserStatus(io, player.userId.toString(), 'online');
            });
            clearTurnTimer(gameId);
            initialAnimationCompletions.delete(gameId);
            console.log(`[Game ${gameId}] [${socket.id}] Processed continue_game (game over), took ${Date.now() - startTime}ms`);
            return;
        } else if (allPlayersDone && game.deck.length >= 8) {
            console.log(`[Game ${gameId}] [${socket.id}] All players done, distributing new cards from deck`);
            game.players.forEach(player => {
                player.cards = game.deck.splice(0, 4);
                player.consecutiveTimeouts = 0;
            });
            gameUpdate.players = game.players;
        }

        gameUpdate.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
        await Game.updateOne({ gameId }, gameUpdate);
        console.log(`[Game ${gameId}] [${socket.id}] Turn advanced to player index: ${gameUpdate.currentPlayerIndex}`);

        const updatedGame = await Game.findOne({ gameId }).lean();
        if (!updatedGame) {
            console.error(`[Game ${gameId}] [${socket.id}] Game not found after update`);
            return;
        }

        updatedGame.players.forEach(player => {
            const payload = {
                gameId: updatedGame.gameId,
                userId: player.userId,
                cards: player.cards.map(card => ({ suit: card.suit, value: card.value, cardId: card.cardId })),
                tableCards: updatedGame.tableCards.map(card => ({ suit: card.suit, value: card.value, cardId: card.cardId }))
            };
            const targetSocket = unhappiness(io.sockets.sockets.values()).find(s => s.userId === player.userId.toString());
            if (targetSocket) {
                targetSocket.emit('player_cards', payload);
                console.log(`[Game ${gameId}] [${socket.id}] Sent player_cards to ${player.userId}`);
            } else {
                console.error(`[Game ${gameId}] [${socket.id}] No socket found for userId: ${player.userId}`);
            }
        });

        const statePayload = {
            gameId: updatedGame.gameId,
            roomNumber: updatedGame.roomNumber,
            players: updatedGame.players.map(p => ({ userId: p.userId, cardCount: p.cards.length })),
            tableCards: updatedGame.tableCards.map(card => ({ suit: card.suit, value: card.value, cardId: card.cardId })),
            currentTurn: updatedGame.players[updatedGame.currentPlayerIndex].userId,
            collectedCards: updatedGame.players.map(p => ({ userId: p.userId, cards: p.collectedCards.map(card => ({ suit: card.suit, value: card.value, cardId: card.cardId })) })),
            surs: updatedGame.players.map(p => ({ userId: p.userId, count: p.surs || 0 }))
        };
        io.to(game.gameId).emit('game_state_update', statePayload);
        console.log(`[Game ${gameId}] [${socket.id}] Sent game_state_update: ${JSON.stringify(statePayload)}`);

        if (!isAutomatic) {
            socket.emit('continue_game_response', { requestId, success: true, message: 'بازی ادامه یافت', tableCards: updatedGame.tableCards.map(card => ({ suit: card.suit, value: card.value, cardId: card.cardId })) });
            console.log(`[Game ${gameId}] [${socket.id}] Sent continue_game_response: success=true`);
        }

        startTurnTimer(updatedGame, io);
        console.log(`[Game ${gameId}] [${socket.id}] Processed continue_game, took ${Date.now() - startTime}ms`);
    } catch (err) {
        if (!isAutomatic) {
            socket.emit('continue_game_response', { requestId, success: false, message: `خطا در ادامه بازی: ${err.message}` });
        }
        console.error(`[Game ${gameId}] [${socket.id}] Error in continueGameAfterAnimation: ${err.message}`);
    }
};

const getCardValue = (value) => {
    const values = {
        'Ace': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
        'Jack': 11, 'Queen': 12, 'King': 13
    };
    return values[value] || 0;
};

const findCombinations = (tableCards, playedCardValue) => {
    const numericCards = tableCards.filter(card => getCardValue(card.value) <= 10);
    const target = 11 - playedCardValue;
    const combinations = [];

    for (let i = 1; i < (1 << numericCards.length); i++) {
        const combination = [];
        let sum = 0;
        for (let j = 0; j < numericCards.length; j++) {
            if (i & (1 << j)) {
                const card = numericCards[j];
                sum += getCardValue(card.value);
                combination.push(card);
            }
        }
        if (sum === target) {
            combinations.push(combination);
        }
    }
    return combinations;
};

const setupSocketHandlers = (socket, io) => {
    console.log(`[${socket.id}] Setting up socket handlers for userId: ${socket.userId || 'unknown'}`);
    socket.on('test_connection', (data) => {
        console.log(`[${socket.id}] Received test_connection: ${JSON.stringify(data)}`);
        socket.emit('test_connection_response', { requestId: data.id, success: true, message: 'اتصال برقرار است' });
        console.log(`[${socket.id}] Sent test_connection_response: { requestId: ${data.id}, success: true }`);
    });

    socket.on('play_card', (request) => {
        console.log(`[${socket.id}] Received play_card request: ${JSON.stringify(request)}`);
        playCard(socket, request, io);
    });
    socket.on('get_player_cards', (request) => {
        console.log(`[${socket.id}] Received get_player_cards request: ${JSON.stringify(request)}`);
        getPlayerCards(socket, request);
    });
    socket.on('get_game_players_info', (request) => {
        console.log(`[${socket.id}] Received get_game_players_info request: ${JSON.stringify(request)}`);
        getGamePlayersInfo(socket, request);
    });
    socket.on('continue_game', (request) => {
        console.log(`[${socket.id}] Received continue_game request: ${JSON.stringify(request)}`);
        continueGameAfterAnimation(socket, request, io);
    });
    socket.on('initial_animation_complete', (request) => {
        console.log(`[${socket.id}] Received initial_animation_complete request: ${JSON.stringify(request)}`);
        initialAnimationComplete(socket, request, io);
    });
    
    socket.on('select_king_or_queen_response', async (response) => {
        console.log(`[${socket.id}] Received select_king_or_queen_response: ${JSON.stringify(response)}`);
        const { requestId, gameId, userId, selectedCard } = response;
        const requestData = {
            requestId,
            data: {
                gameId,
                userId,
                card: response.card,
                tableCards: [selectedCard]
            }
        };
        await playCard(socket, requestData, io);
    });
};

module.exports = { initializeGame, getPlayerCards, getGamePlayersInfo, playCard, setupSocketHandlers, handlePlayerDisconnect, continueGameAfterAnimation, initialAnimationComplete };