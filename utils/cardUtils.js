const suits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];

const createDeck = (numDecks = 1) => {
    const deck = [];
    for (let i = 0; i < numDecks; i++) {
        for (const suit of suits) {
            for (const rank of ranks) {
                deck.push({ suit, rank });
            }
        }
    }
    return deck;
};

const shuffleDeck = (deck) => {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
};

const isValidStartCard = (card) => {
    const invalidRanks = ['7', '8', '10', 'Jack', '2'];
    return !invalidRanks.includes(card.rank);
};

const canPlayCard = (card, currentCard, currentSuit, penaltyCount) => {
    if (penaltyCount > 0) {
        return card.rank === '7';
    }

    if (currentSuit) {
        return card.suit === currentSuit || card.rank === 'Jack';
    }

    if (currentCard.rank === '8') {
        return card.rank === '8' || card.suit === currentCard.suit;
    }

    if (card.rank === 'Jack') {
        return true;
    }

    return card.suit === currentCard.suit || card.rank === currentCard.rank;
};

module.exports = { createDeck, shuffleDeck, isValidStartCard, canPlayCard };