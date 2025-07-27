class Card {
    constructor(suit, value) {
        this.suit = suit;
        this.value = value;
    }

    toString() {
        return `${this.value} of ${this.suit}`;
    }
}

module.exports = Card;