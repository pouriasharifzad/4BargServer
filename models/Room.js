const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    roomNumber: { type: Number, unique: true, default: 100 },
    minExperience: { type: Number, required: true },
    minCoins: { type: Number, required: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    maxPlayers: { type: Number, required: true, default: 2 },
    gameId: { type: String, required: true } // اضافه کردن فیلد gameId
});

module.exports = mongoose.model('Room', roomSchema);