// ==========================================================
// Nexara Double Ratchet
//
// JSX mirror of backend/app/crypto/signal/double_ratchet.py
// Per https://signal.org/docs/specifications/doubleratchet/
//
// A pure ratchet implementation: state + key derivation steps.
// Persistence is handled by the session layer.
// ==========================================================

import {
    x25519,
    generateX25519Keypair,
    x25519PublicToBytes,
    x25519SharedKey,
    kdfRootChain,
    kdfChainKey,
    deriveMessageKeys,
    aesGcmEncrypt,
    aesGcmDecrypt,
} from "./primitives.js";
import { hexEncode, hexDecode, concatBytes } from "./bytes.js";

// ==========================================================
// Types
// ==========================================================

export class Chain {
    constructor(key, index = 0) {
        this.key = key;
        this.index = index;
    }
}

export class DHKeyPair {
    constructor({ privateKey, publicKey }) {
        this.private = privateKey;
        this.public = publicKey;
        this.publicRaw = x25519PublicToBytes(publicKey);
    }

    static fromPrivateKey(privateKey) {
        return new DHKeyPair({
            privateKey,
            publicKey: x25519.getPublicKey(privateKey),
        });
    }

    static new() {
        const { privateKey, publicKey } = generateX25519Keypair();
        return new DHKeyPair({ privateKey, publicKey });
    }
}

// ==========================================================
// Ratchet State (serializable)
// ==========================================================

export class RatchetState {
    constructor({
        rootKey,
        ourDhPair,
        theirDhPublic = null,
        sendingChain = null,
        receivingChain = null,
        skippedMessageKeys = {},
        associatedData = new Uint8Array(0),
        maxSkip = 1000,
    }) {
        this.rootKey = rootKey;
        this.ourDhPair = ourDhPair;
        this.theirDhPublic = theirDhPublic;
        this.sendingChain = sendingChain;
        this.receivingChain = receivingChain;
        this.skippedMessageKeys = skippedMessageKeys; // "dhHex:n" -> key
        this.associatedData = associatedData;
        this.maxSkip = maxSkip;
    }

    toDict() {
        return {
            root_key: hexEncode(this.rootKey),
            our_dh_private: hexEncode(this.ourDhPair.private),
            our_dh_public: hexEncode(this.ourDhPair.publicRaw),
            their_dh_public: this.theirDhPublic
                ? hexEncode(this.theirDhPublic)
                : null,
            sending_chain: this.sendingChain
                ? { key: hexEncode(this.sendingChain.key), index: this.sendingChain.index }
                : null,
            receiving_chain: this.receivingChain
                ? { key: hexEncode(this.receivingChain.key), index: this.receivingChain.index }
                : null,
            skipped_message_keys: Object.fromEntries(
                Object.entries(this.skippedMessageKeys).map(([k, v]) => [
                    k,
                    hexEncode(v),
                ]),
            ),
            associated_data: hexEncode(this.associatedData),
            max_skip: this.maxSkip,
        };
    }

    static fromDict(data) {
        const skipped = {};
        for (const [k, v] of Object.entries(data.skipped_message_keys || {})) {
            skipped[k] = hexDecode(v);
        }
        return new RatchetState({
            rootKey: hexDecode(data.root_key),
            ourDhPair: DHKeyPair.fromPrivateKey(hexDecode(data.our_dh_private)),
            theirDhPublic: data.their_dh_public
                ? hexDecode(data.their_dh_public)
                : null,
            sendingChain: data.sending_chain
                ? new Chain(
                      hexDecode(data.sending_chain.key),
                      data.sending_chain.index,
                  )
                : null,
            receivingChain: data.receiving_chain
                ? new Chain(
                      hexDecode(data.receiving_chain.key),
                      data.receiving_chain.index,
                  )
                : null,
            skippedMessageKeys: skipped,
            associatedData: data.associated_data
                ? hexDecode(data.associated_data)
                : new Uint8Array(0),
            maxSkip: data.max_skip ?? 1000,
        });
    }
}

// ==========================================================
// Core Operations
// ==========================================================

export class DoubleRatchetCore {
    constructor(rootKey, associatedData, ourInitialDhPrivate = null, theirDhPublic = null) {
        this.ourDhPair = ourInitialDhPrivate
            ? DHKeyPair.fromPrivateKey(ourInitialDhPrivate)
            : DHKeyPair.new();
        this.rootKey = rootKey;
        this.associatedData = associatedData;
        this.theirDhPublic = theirDhPublic;
        this.sendingChain = null;
        this.receivingChain = null;
        this.skippedMessageKeys = {}; // "dhHex:n" -> message key
        this.maxSkip = 1000;
        this.previousSendingNumber = 0; // PN
    }

    state() {
        return new RatchetState({
            rootKey: this.rootKey,
            ourDhPair: this.ourDhPair,
            theirDhPublic: this.theirDhPublic,
            sendingChain: this.sendingChain,
            receivingChain: this.receivingChain,
            skippedMessageKeys: { ...this.skippedMessageKeys },
            associatedData: this.associatedData,
            maxSkip: this.maxSkip,
        });
    }

    static fromState(state) {
        const core = Object.create(DoubleRatchetCore.prototype);
        core.rootKey = state.rootKey;
        core.ourDhPair = state.ourDhPair;
        core.theirDhPublic = state.theirDhPublic;
        core.sendingChain = state.sendingChain;
        core.receivingChain = state.receivingChain;
        core.skippedMessageKeys = { ...state.skippedMessageKeys };
        core.associatedData = state.associatedData;
        core.maxSkip = state.maxSkip;
        core.previousSendingNumber = 0;
        return core;
    }

    // ==========================================================
    // Skip message keys (spec: SKIP_MESSAGE_KEYS)
    //
    // Derives & stores keys for receiving-chain indices between the
    // current index and `until` (exclusive), tagged by the DH public
    // key the messages were sent under.
    // ==========================================================

    _skipMessageKeys(until, dhPublic) {
        const chain = this.receivingChain;
        if (!chain) return;
        if (chain.index + this.maxSkip < until) {
            throw new Error("Too many skipped messages (possible DoS)");
        }
        const dhHex = hexEncode(dhPublic);
        while (chain.index < until) {
            const { nextChainKey, messageKey } = kdfChainKey(chain.key);
            chain.key = nextChainKey;
            if (Object.keys(this.skippedMessageKeys).length >= this.maxSkip) {
                throw new Error("Skipped message key storage full (possible DoS)");
            }
            this.skippedMessageKeys[`${dhHex}:${chain.index}`] = messageKey;
            chain.index += 1;
        }
    }

    // ==========================================================
    // DH ratchet (spec: DHRatchet)
    // ==========================================================

    dhRatchet(theirNewDhPublic) {
        this.previousSendingNumber = this.sendingChain ? this.sendingChain.index : 0;
        this.sendingChain = null;
        this.theirDhPublic = theirNewDhPublic;

        // Step 3: root, receiving chain (uses CURRENT our DH pair)
        const { rootKey: rk1, chainKey: receivingCk } = kdfRootChain(
            this.rootKey,
            x25519SharedKey(this.ourDhPair.private, theirNewDhPublic),
        );
        this.rootKey = rk1;
        this.receivingChain = new Chain(receivingCk, 0);

        // Step 4: new DH pair for us
        this.ourDhPair = DHKeyPair.new();

        // Step 5: root, sending chain (uses NEW DH pair)
        const { rootKey: rk2, chainKey: sendingCk } = kdfRootChain(
            this.rootKey,
            x25519SharedKey(this.ourDhPair.private, theirNewDhPublic),
        );
        this.rootKey = rk2;
        this.sendingChain = new Chain(sendingCk, 0);
    }

    // ==========================================================
    // Initialization (spec section 2.4)
    // ==========================================================

    initializeInitiator() {
        if (!this.theirDhPublic) {
            throw new Error("Initiation requires their DH public key");
        }
        const { rootKey, chainKey } = kdfRootChain(
            this.rootKey,
            x25519SharedKey(this.ourDhPair.private, this.theirDhPublic),
        );
        this.rootKey = rootKey;
        this.sendingChain = new Chain(chainKey, 0);
    }

    initializeResponder() {
        if (!this.theirDhPublic) {
            throw new Error("Responder needs Alice's DH from first message");
        }
        const { rootKey, chainKey } = kdfRootChain(
            this.rootKey,
            x25519SharedKey(this.ourDhPair.private, this.theirDhPublic),
        );
        this.rootKey = rootKey;
        this.receivingChain = new Chain(chainKey, 0);
    }

    // ==========================================================
    // Message key derivation
    // ==========================================================

    _nextSendingMessageKey() {
        const chain = this.sendingChain;
        if (!chain) throw new Error("No sending chain");
        const { nextChainKey, messageKey } = kdfChainKey(chain.key);
        chain.key = nextChainKey;
        const index = chain.index;
        chain.index += 1;
        return { messageKey, index };
    }

    _receivingMessageKey(index) {
        const lookedUp = this.skippedMessageKeys[
            `${hexEncode(this.theirDhPublic)}:${index}`
        ];
        if (lookedUp !== undefined) {
            delete this.skippedMessageKeys[
                `${hexEncode(this.theirDhPublic)}:${index}`
            ];
            return lookedUp;
        }
        const chain = this.receivingChain;
        if (!chain || index !== chain.index) {
            throw new Error(
                `Message index ${index} out of order (expected ${
                    chain ? chain.index : -1
                })`,
            );
        }
        const { nextChainKey, messageKey } = kdfChainKey(chain.key);
        chain.key = nextChainKey;
        chain.index += 1;
        return messageKey;
    }

    // ==========================================================
    // RatchetEncrypt / RatchetDecrypt (spec)
    // ==========================================================

    encrypt_message(plaintext) {
        const chain = this.sendingChain;
        if (!chain) throw new Error("No sending chain to encrypt from");

        const { nextChainKey, messageKey } = kdfChainKey(chain.key);
        chain.key = nextChainKey;
        const index = chain.index;
        chain.index += 1;

        const header = {
            pn: this.previousSendingNumber,
            n: index,
            dh: hexEncode(this.ourDhPair.publicRaw),
        };

        const { encKey, nonceSeed } = deriveMessageKeys(messageKey);
        const adData = concatBytes(this.associatedData, this.ourDhPair.publicRaw);
        const { ciphertext, nonce } = aesGcmEncrypt(
            encKey,
            plaintext,
            adData,
            nonceSeed.slice(0, 12),
        );

        return { header, payload: concatBytes(ciphertext, nonce) };
    }

    decrypt_message(header, payload) {
        const theirDh = hexDecode(header.dh);
        const n = header.n;

        if (!bytesEqual(theirDh, this.theirDhPublic)) {
            // new epoch: skip keys of the current receiving chain, then ratchet
            this._skipMessageKeys(
                this.receivingChain ? this.receivingChain.index : 0,
                this.theirDhPublic,
            );
            this.dhRatchet(theirDh);
        }

        // Skip message keys for gaps within THIS receiving chain
        this._skipMessageKeys(n, theirDh);

        const mk = this._receivingMessageKey(n);

        const { encKey } = deriveMessageKeys(mk);
        const adData = concatBytes(this.associatedData, theirDh);
        const nonce = payload.slice(-12);
        const ciphertext = payload.slice(0, -12);
        return aesGcmDecrypt(encKey, ciphertext, adData, nonce);
    }
}

// ==========================================================
// Helpers
// ==========================================================

function bytesEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
}
