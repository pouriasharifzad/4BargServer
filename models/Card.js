class Card {
    constructor(suit, value, _id) {
        this.suit = suit;
        this.value = value;
        this._id = _id; // شناسه یکتا برای هر کارت
    }

    toString() {
        return `${this.value} of ${this.suit} (ID: ${this._id})`;
    }
}

module.exports = Card;