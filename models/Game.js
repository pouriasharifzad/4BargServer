const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    cards: [{ suit: String, value: String, cardId: String }], // اضافه کردن cardId
    hasFinished: { type: Boolean, default: false },
    collectedCards: [{ suit: String, value: String, cardId: String }], // اضافه کردن cardId
    surs: { type: Number, default: 0 },
    consecutiveTimeouts: { type: Number, default: 0 }
});

const gameSchema = new mongoose.Schema({
    gameId: { type: String, required: true, unique: true },
    roomNumber: { type: Number, required: true },
    players: [playerSchema],
    deck: [{ suit: String, value: String, cardId: String }], // اضافه کردن cardId
    discardPile: [{ suit: String, value: String, cardId: String }], // اضافه کردن cardId
    currentPlayerIndex: { type: Number, default: 0 },
    direction: { type: Number, default: 1 },
    currentCard: { suit: String, value: String, cardId: String }, // اضافه کردن cardId
    currentSuit: { type: String, default: null },
    penaltyCount: { type: Number, default: 0 },
    winners: [{ userId: String, rank: Number }],
    tableCards: [{ suit: String, value: String, cardId: String }], // اضافه کردن cardId
    lastCollector: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    gameOver: { type: Boolean, default: false } // اضافه کردن gameOver
});

module.exports = mongoose.model('Game', gameSchema);