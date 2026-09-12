// ============================================================
// Nexara consolidated frontend test suite.
//
// Single-file merge of the former tests/signal/ directory.
// Each source file runs as its own named subtree so its
// beforeEach hooks and module-level setup stay scoped,
// mirroring the old process-per-file isolation.
//
// Run: npm test   (node --test all.test.js)
// ============================================================

import { DM_AAD_PREFIX, GROUP_AAD_PREFIX, encryptMessage, decryptMessage as decryptMessage___crypto_cryptoService_js, generateIdentityKeys } from "./src/crypto/cryptoService.js";
import { savePublicKey, savePrivateKey, getPublicKey, getPrivateKey, saveKeyPair, loadKeyPair, hasKeyPair, clearKeyPair } from "./src/crypto/keyStorage.js";
import { b64encode, b64decode } from "./src/crypto/signal/bytes.js";
import { RatchetState, DoubleRatchetCore, DHKeyPair, Chain } from "./src/crypto/signal/doubleRatchet.js";
import { generateDeviceIdentity, generateOneTimePrekeys, generateDeviceId, buildRegisterPayload, OPK_BATCH_SIZE } from "./src/crypto/signal/identity.js";
import { SignalKeyStore, signalKeyStore } from "./src/crypto/signal/keyStore.js";
import { SignalEnvelope, EnvelopeError, buildPrekeyMessage, parsePrekeyMessage } from "./src/crypto/signal/message.js";
import { replenishOneTimePrekeys } from "./src/crypto/signal/prekeyManager.js";
import { ed25519Verify, generateEd25519Keypair, generateX25519Keypair, x25519Dh, ed25519Sign, kdfRootChain, kdfChainKey, aesGcmEncrypt, aesGcmDecrypt, generateSymmetricKey, generateNonce, deriveMessageKeys } from "./src/crypto/signal/primitives.js";
import { SignalSessionManager, InMemorySessionStore } from "./src/crypto/signal/session.js";
import { createKeyBundle } from "./src/crypto/signal/x3dh.js";
import { normalizeRecoveryCode, deriveWrapKeyFromCode, unwrapSyncSecret, encryptSyncText, decryptSyncText, encryptSyncBytes, decryptSyncBytes, clearSyncKeyCache, SYNC_KEY_SIZE } from "./src/crypto/syncCrypto.js";
import { encryptForConversation, encryptBytesForDevices, decryptMessage as decryptMessage__ces_signalChatService_js, decryptEnvelopeBytes } from "./src/services/signalChatService.js";
import { gcm } from "@noble/ciphers/aes.js";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test, beforeEach } from "node:test";

// ───────────────────────────────────────────────────────────
// source: tests/signal/aadBinding.test.js
// ───────────────────────────────────────────────────────────
describe("suite: aadBinding", () => {
    const decryptMessage = decryptMessage___crypto_cryptoService_js;
// ==========================================================
// AAD binding tests (legacy RSA/AES-GCM path)
//
// The legacy hybrid encryption binds every AES-GCM operation
// to its conversation (AAD). A ciphertext moved into another
// conversation by a compromised server must fail GCM
// authentication instead of silently decrypting. Pre-AAD
// history (rows encrypted before the binding existed) must
// keep decrypting via the unbound fallback.
//
// Run: node --test tests/signal/
// ==========================================================






async function keypair() {
    return generateIdentityKeys();
}

test("AAD binding: wrong conversation context fails to decrypt", async () => {
    const sender = await keypair();
    const receiver = await keypair();

    const encrypted = await encryptMessage(
        "secret",
        sender.publicKey,
        receiver.publicKey,
        DM_AAD_PREFIX + "conv-1",
    );

    const right = await decryptMessage(
        encrypted.ciphertext,
        encrypted.encrypted_key_receiver,
        encrypted.nonce,
        receiver.privateKey,
        DM_AAD_PREFIX + "conv-1",
    );
    assert.equal(right, "secret");

    // Moved into another conversation: must NOT decrypt.
    await assert.rejects(
        decryptMessage(
            encrypted.ciphertext,
            encrypted.encrypted_key_receiver,
            encrypted.nonce,
            receiver.privateKey,
            DM_AAD_PREFIX + "conv-2",
        ),
        /decrypt|OperationError/i,
    );

    // The unbound attempt (used for pre-AAD rows) must also
    // fail for a bound ciphertext.
    await assert.rejects(
        decryptMessage(
            encrypted.ciphertext,
            encrypted.encrypted_key_receiver,
            encrypted.nonce,
            receiver.privateKey,
        ),
        /decrypt|OperationError/i,
    );
});

test("AAD binding: group context mismatch fails to decrypt", async () => {
    const sender = await keypair();
    const receiver = await keypair();

    const encrypted = await encryptMessage(
        "group secret",
        sender.publicKey,
        receiver.publicKey,
        GROUP_AAD_PREFIX + "group-9",
    );

    await assert.rejects(
        decryptMessage(
            encrypted.ciphertext,
            encrypted.encrypted_key_receiver,
            encrypted.nonce,
            receiver.privateKey,
            GROUP_AAD_PREFIX + "group-10",
        ),
        /decrypt|OperationError/i,
    );

    const right = await decryptMessage(
        encrypted.ciphertext,
        encrypted.encrypted_key_receiver,
        encrypted.nonce,
        receiver.privateKey,
        GROUP_AAD_PREFIX + "group-9",
    );
    assert.equal(right, "group secret");
});

test("AAD binding: pre-AAD history still decrypts via fallback", async () => {
    const sender = await keypair();
    const receiver = await keypair();

    // Encrypted WITHOUT a binding (legacy row).
    const encrypted = await encryptMessage(
        "old message",
        sender.publicKey,
        receiver.publicKey,
    );

    // A modern caller passes the conversation AAD; the
    // internal unbound fallback must recover the plaintext.
    const plaintext = await decryptMessage(
        encrypted.ciphertext,
        encrypted.encrypted_key_receiver,
        encrypted.nonce,
        receiver.privateKey,
        DM_AAD_PREFIX + "conv-1",
    );
    assert.equal(plaintext, "old message");
});
});

// ───────────────────────────────────────────────────────────
// source: tests/signal/attachmentKeys.test.js
// ───────────────────────────────────────────────────────────
describe("suite: attachmentKeys", () => {
    const decryptMessage = decryptMessage__ces_signalChatService_js;
// ==========================================================
// Integration test: per-device attachment file-key wrapping
//
// Mirrors the send flow: the sender wraps the file's AES key
// with encryptBytesForDevices() (the same machinery that wraps
// text messages), the backend stores the envelopes, and any
// receiving device unwraps its own copy with
// decryptEnvelopeBytes().
//
// Also covers the reordering that the 5s "Sent" hold creates:
// the attachment event reaches the peer BEFORE the message
// relay, so the file-key envelope is decrypted first, must
// fail cleanly (no session yet), and must succeed once the
// handshake text envelope arrives.
//
// Run: node --test tests/signal/
// ==========================================================











let aliceStore;
let bobStore;
let bobBundle;
let aliceBundle;

const CONVERSATION_ID = "conv-file-keys";
const ALICE_DEVICE_ID = "alice-dev-1";
const BOB_DEVICE_ID = "bob-dev-1";

function transport(serializable) {
    return JSON.parse(JSON.stringify(serializable));
}

function randomFileKey() {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = (i * 7 + 3) % 256;
    }
    return bytes;
}

beforeEach(async () => {
    aliceStore = new SignalKeyStore("test-alice-fk");
    bobStore = new SignalKeyStore("test-bob-fk");

    await aliceStore.clearAll();
    await bobStore.clearAll();

    const alice = generateDeviceIdentity({});
    const aliceOpks = generateOneTimePrekeys({ startId: 1, count: 3 });
    await aliceStore.saveIdentity({
        deviceId: ALICE_DEVICE_ID,
        identityKeyPrivate: b64encode(alice.identity.privateKey),
        identityKeyPublic: b64encode(alice.identity.publicKey),
        x25519IdentityKeyPublic: b64encode(alice.identity.x25519Public),
    });
    await aliceStore.saveMeta({ deviceId: ALICE_DEVICE_ID });
    await aliceStore.saveOneTimePrekeys(
        aliceOpks.map((opk) => ({
            keyId: opk.keyId,
            publicKey: b64encode(opk.publicKey),
            privateKey: b64encode(opk.privateKey),
        })),
    );

    aliceBundle = createKeyBundle({
        deviceId: ALICE_DEVICE_ID,
        identityKeyPrivate: alice.identity.privateKey,
        signedPrekeyPrivate: alice.signedPrekey.privateKey,
        signedPrekeyId: alice.signedPrekey.keyId,
        oneTimePrekeys: aliceOpks,
    });

    const bob = generateDeviceIdentity({});
    const bobOpks = generateOneTimePrekeys({ startId: 1, count: 3 });
    const bobSpk = bob.signedPrekey;

    await bobStore.saveIdentity({
        deviceId: BOB_DEVICE_ID,
        identityKeyPrivate: b64encode(bob.identity.privateKey),
        identityKeyPublic: b64encode(bob.identity.publicKey),
        x25519IdentityKeyPublic: b64encode(bob.identity.x25519Public),
    });
    await bobStore.saveMeta({ deviceId: BOB_DEVICE_ID });
    await bobStore.saveSignedPrekey({
        keyId: bobSpk.keyId,
        publicKey: b64encode(bobSpk.publicKey),
        signature: b64encode(bobSpk.signature),
        privateKey: b64encode(bobSpk.privateKey),
    });
    await bobStore.saveOneTimePrekeys(
        bobOpks.map((opk) => ({
            keyId: opk.keyId,
            publicKey: b64encode(opk.publicKey),
            privateKey: b64encode(opk.privateKey),
        })),
    );

    bobBundle = createKeyBundle({
        deviceId: BOB_DEVICE_ID,
        identityKeyPrivate: bob.identity.privateKey,
        signedPrekeyPrivate: bobSpk.privateKey,
        signedPrekeyId: bobSpk.keyId,
        oneTimePrekeys: bobOpks,
    });
});

test("file key wraps for the recipient device and unwraps there", async () => {
    // Establish the text session first (exactly like the send
    // flow: encryptForDevices runs before the file wraps).
    const text = await encryptForConversation({
        conversationId: CONVERSATION_ID,
        plaintext: "hello + attachment",
        remoteDevices: [bobBundle],
        keyStore: aliceStore,
    });
    await decryptMessage({
        conversationId: CONVERSATION_ID,
        ciphertext: transport(text.ciphertext),
        keyStore: bobStore,
    });

    const rawKey = randomFileKey();

    const wrapped = await encryptBytesForDevices({
        conversationId: CONVERSATION_ID,
        bytes: rawKey,
        devices: [bobBundle],
        keyStore: aliceStore,
    });

    assert.equal(wrapped.length, 1);
    assert.equal(wrapped[0].device_id, BOB_DEVICE_ID);

    // Data envelope: the established ratchet, sent after the text.
    const envelope = SignalEnvelopeLike(wrapped[0].data);
    assert.equal(envelope.type, "data");

    const unwrapped = await decryptEnvelopeBytes({
        conversationId: CONVERSATION_ID,
        envelopeJson: transport(wrapped[0].data),
        keyStore: bobStore,
    });

    assert.deepEqual(
        new Uint8Array(unwrapped),
        rawKey,
    );
});

test("own device is never wrapped (no (me, me) ratchet)", async () => {
    const rawKey = randomFileKey();

    const wrapped = await encryptBytesForDevices({
        conversationId: CONVERSATION_ID,
        bytes: rawKey,
        devices: [aliceBundle, bobBundle],
        keyStore: aliceStore,
    });

    const deviceIds = wrapped.map((entry) => entry.device_id);
    assert.deepEqual(deviceIds, [BOB_DEVICE_ID]);
});

test("reordered delivery: file envelope first, text handshake second", async () => {
    // Send flow: text envelope (handshake) then file-key
    // envelope, both before the relay. But the attachment
    // event reaches the peer BEFORE the message relay, so the
    // peer decrypts the file key first.
    const text = await encryptForConversation({
        conversationId: CONVERSATION_ID,
        plaintext: "image coming",
        remoteDevices: [bobBundle],
        keyStore: aliceStore,
    });

    const rawKey = randomFileKey();

    const wrapped = await encryptBytesForDevices({
        conversationId: CONVERSATION_ID,
        bytes: rawKey,
        devices: [bobBundle],
        keyStore: aliceStore,
    });

    // 1) File key arrives first: no session yet -> must throw.
    await assert.rejects(
        decryptEnvelopeBytes({
            conversationId: CONVERSATION_ID,
            envelopeJson: transport(wrapped[0].data),
            keyStore: bobStore,
        }),
    );

    // 2) Text handshake lands: builds the session.
    const bobPlain = await decryptMessage({
        conversationId: CONVERSATION_ID,
        ciphertext: transport(text.ciphertext),
        keyStore: bobStore,
    });
    assert.equal(bobPlain, "image coming");

    // 3) Retry the file key: session now exists -> unwraps.
    const unwrapped = await decryptEnvelopeBytes({
        conversationId: CONVERSATION_ID,
        envelopeJson: transport(wrapped[0].data),
        keyStore: bobStore,
    });

    assert.deepEqual(
        new Uint8Array(unwrapped),
        rawKey,
    );
});

function SignalEnvelopeLike(json) {
    return JSON.parse(json);
}
});

// ───────────────────────────────────────────────────────────
// source: tests/signal/chatService.test.js
// ───────────────────────────────────────────────────────────
describe("suite: chatService", () => {
    const decryptMessage = decryptMessage__ces_signalChatService_js;
// ==========================================================
// Integration test: signalChatService end-to-end
//
// Simulates two users on two separate devices (separate
// IndexedDB stores via fake-indexeddb):
//
//   Alice (device "alice-dev-1")  <->  Bob (device "bob-dev-1")
//
// Exercises the exact service entrypoints the chat UI uses:
//   encryptForConversation()  ->  decryptMessage()
// across the X3DH handshake AND the established double-ratchet
// session, with the ciphertext JSON surviving a "transport"
// round trip (JSON.parse/stringify like the backend would).
//
// Run: node --test tests/signal/
// ==========================================================











// ----------------------------------------------------------
// Fixtures: one store + registered device per user
// ----------------------------------------------------------

let aliceStore;
let bobStore;
let bobBundle; // published to the server, fetched by Alice
let aliceBundle; // published to the server, fetched by Bob

const CONVERSATION_ID = "conv-42";
const ALICE_DEVICE_ID = "alice-dev-1";
const BOB_DEVICE_ID = "bob-dev-1";

function transport(serializable) {
    return JSON.parse(JSON.stringify(serializable));
}

beforeEach(async () => {
    aliceStore = new SignalKeyStore("test-alice");
    bobStore = new SignalKeyStore("test-bob");

    // fake-indexeddb databases persist across tests in one
    // process; wipe so each test starts from a clean slate.
    await aliceStore.clearAll();
    await bobStore.clearAll();

    const alice = generateDeviceIdentity({});
    const aliceOpks = generateOneTimePrekeys({ startId: 1, count: 3 });
    await aliceStore.saveIdentity({
        deviceId: ALICE_DEVICE_ID,
        identityKeyPrivate: b64encode(alice.identity.privateKey),
        identityKeyPublic: b64encode(alice.identity.publicKey),
        x25519IdentityKeyPublic: b64encode(alice.identity.x25519Public),
    });
    await aliceStore.saveMeta({ deviceId: ALICE_DEVICE_ID });
    await aliceStore.saveOneTimePrekeys(
        aliceOpks.map((opk) => ({
            keyId: opk.keyId,
            publicKey: b64encode(opk.publicKey),
            privateKey: b64encode(opk.privateKey),
        })),
    );

    // The bundle Bob would fetch from GET /devices/{id}/bundle
    aliceBundle = createKeyBundle({
        deviceId: ALICE_DEVICE_ID,
        identityKeyPrivate: alice.identity.privateKey,
        signedPrekeyPrivate: alice.signedPrekey.privateKey,
        signedPrekeyId: alice.signedPrekey.keyId,
        oneTimePrekeys: aliceOpks,
    });

    const bob = generateDeviceIdentity({});
    const bobOpks = generateOneTimePrekeys({ startId: 1, count: 3 });
    const bobSpk = bob.signedPrekey;

    await bobStore.saveIdentity({
        deviceId: BOB_DEVICE_ID,
        identityKeyPrivate: b64encode(bob.identity.privateKey),
        identityKeyPublic: b64encode(bob.identity.publicKey),
        x25519IdentityKeyPublic: b64encode(bob.identity.x25519Public),
    });
    await bobStore.saveMeta({ deviceId: BOB_DEVICE_ID });
    await bobStore.saveSignedPrekey({
        keyId: bobSpk.keyId,
        publicKey: b64encode(bobSpk.publicKey),
        signature: b64encode(bobSpk.signature),
        privateKey: b64encode(bobSpk.privateKey),
    });
    await bobStore.saveOneTimePrekeys(
        bobOpks.map((opk) => ({
            keyId: opk.keyId,
            publicKey: b64encode(opk.publicKey),
            privateKey: b64encode(opk.privateKey),
        })),
    );

    // The bundle Alice would fetch from GET /devices/{id}/bundle
    bobBundle = createKeyBundle({
        deviceId: BOB_DEVICE_ID,
        identityKeyPrivate: bob.identity.privateKey,
        signedPrekeyPrivate: bobSpk.privateKey,
        signedPrekeyId: bobSpk.keyId,
        oneTimePrekeys: bobOpks,
    });
});

test("full round trip: X3DH handshake then ratcheted messages", async () => {
    // ---- Alice sends the first message (handshake) ----
    const first = await encryptForConversation({
        conversationId: CONVERSATION_ID,
        plaintext: "Hello Bob, this is Alice!",
        remoteDevices: [bobBundle],
        keyStore: aliceStore,
    });
    assert.equal(first.type, "prekey");

    // Transport: the ciphertext the backend would store/forward
    const transported = {
        ciphertext: transport(first.ciphertext),
    };

    const bobPlain = await decryptMessage({
        conversationId: CONVERSATION_ID,
        ciphertext: transported.ciphertext,
        keyStore: bobStore,
    });
    assert.equal(bobPlain, "Hello Bob, this is Alice!");

    // Bob's one-time prekey is single use
    assert.equal(await bobStore.getOneTimePrekeyCount(), 2);

    // ---- Bob replies (established session) ----
    const bobReply = await encryptForConversation({
        conversationId: CONVERSATION_ID,
        otherUserId: "user-alice",
        plaintext: "Got it, Alice!",
        remoteDevices: [aliceBundle],
        keyStore: bobStore,
    });
    assert.equal(bobReply.type, "data");

    const alice = await decryptMessage({
        conversationId: CONVERSATION_ID,
        ciphertext: transport(bobReply.ciphertext),
        keyStore: aliceStore,
    });
    assert.equal(alice, "Got it, Alice!");

    // ---- 5 messages each way over the ratchet ----
    for (let i = 0; i < 5; i++) {
        const a = await encryptForConversation({
            conversationId: CONVERSATION_ID,
            plaintext: `A${i}`,
            keyStore: aliceStore,
        });
        const ra = await decryptMessage({
            conversationId: CONVERSATION_ID,
            ciphertext: transport(a.ciphertext),
            keyStore: bobStore,
        });
        assert.equal(ra, `A${i}`);

        const b = await encryptForConversation({
            conversationId: CONVERSATION_ID,
            plaintext: `B${i}`,
            keyStore: bobStore,
        });
        const rb = await decryptMessage({
            conversationId: CONVERSATION_ID,
            ciphertext: transport(b.ciphertext),
            keyStore: aliceStore,
        });
        assert.equal(rb, `B${i}`);
    }
});

test("peer device identity is pinned after first handshake", async () => {
    // First handshake pins bob-dev-1 for the conversation.
    // Subsequent sends MUST NOT re-run X3DH (no OPK consumed).
    const first = await encryptForConversation({
        conversationId: CONVERSATION_ID,
        plaintext: "pin me",
        remoteDevices: [bobBundle],
        keyStore: aliceStore,
    });
    await decryptMessage({
        conversationId: CONVERSATION_ID,
        ciphertext: transport(first.ciphertext),
        keyStore: bobStore,
    });

    // OPK consumed by Bob during the handshake
    assert.equal(await bobStore.getOneTimePrekeyCount(), 2);

    // Second send: established session, no new OPK touched
    const second = await encryptForConversation({
        conversationId: CONVERSATION_ID,
        plaintext: "second",
        keyStore: aliceStore,
    });
    assert.equal(second.type, "data");
    const got = await decryptMessage({
        conversationId: CONVERSATION_ID,
        ciphertext: transport(second.ciphertext),
        keyStore: bobStore,
    });
    assert.equal(got, "second");

    // Still only the one OPK from the original handshake
    assert.equal(await bobStore.getOneTimePrekeyCount(), 2);
});

test("attacker with no session cannot decrypt", async () => {
    const attackerStore = new SignalKeyStore("test-eve");
    const eve = generateDeviceIdentity({});
    await attackerStore.saveIdentity({
        deviceId: "eve-dev-1",
        identityKeyPrivate: b64encode(eve.identity.privateKey),
        identityKeyPublic: b64encode(eve.identity.publicKey),
        x25519IdentityKeyPublic: b64encode(eve.identity.x25519Public),
    });
    await attackerStore.saveMeta({ deviceId: "eve-dev-1" });

    const aliceEnv = await encryptForConversation({
        conversationId: CONVERSATION_ID,
        plaintext: "classified",
        remoteDevices: [bobBundle],
        keyStore: aliceStore,
    });

    await assert.rejects(
        decryptMessage({
            conversationId: CONVERSATION_ID,
            ciphertext: transport(aliceEnv.ciphertext),
            keyStore: attackerStore,
        }),
    );
});

test("non-Signal ciphertext rejects via decryptMessage", async () => {
    await assert.rejects(
        decryptMessage({
            conversationId: CONVERSATION_ID,
            ciphertext: "not-an-envelope",
            keyStore: aliceStore,
        }),
    );
});

test("TOFU: a swapped peer identity key aborts the session", async () => {
    // First contact pins bob-dev-1's real identity.
    await encryptForConversation({
        conversationId: CONVERSATION_ID,
        plaintext: "first",
        remoteDevices: [bobBundle],
        keyStore: aliceStore,
    });

    // The server now serves bob-dev-1 with a DIFFERENT identity
    // key (compromised server / MITM): the send must abort.
    const swappedIdentity = generateDeviceIdentity({});
    const swappedOpks = generateOneTimePrekeys({ startId: 10, count: 1 });
    const swappedBundle = createKeyBundle({
        deviceId: BOB_DEVICE_ID,
        identityKeyPrivate: swappedIdentity.identity.privateKey,
        signedPrekeyPrivate: swappedIdentity.signedPrekey.privateKey,
        signedPrekeyId: swappedIdentity.signedPrekey.keyId,
        oneTimePrekeys: swappedOpks,
    });

    await assert.rejects(
        encryptForConversation({
            conversationId: CONVERSATION_ID,
            plaintext: "must not go out",
            remoteDevices: [swappedBundle],
            keyStore: aliceStore,
        }),
        /Identity key changed/,
    );
});

test("TOFU: responder rejects a handshake with a swapped sender identity", async () => {
    // Bob sees Alice's real bundle first -> pins alice-dev-1.
    await encryptForConversation({
        conversationId: CONVERSATION_ID,
        plaintext: "hi alice",
        remoteDevices: [aliceBundle],
        keyStore: bobStore,
    });

    // An imposter store claims alice's device id with a fresh
    // identity and sends a prekey envelope to Bob.
    const imposterStore = new SignalKeyStore("test-imposter");
    const imposter = generateDeviceIdentity({});
    await imposterStore.saveIdentity({
        deviceId: ALICE_DEVICE_ID,
        identityKeyPrivate: b64encode(imposter.identity.privateKey),
        identityKeyPublic: b64encode(imposter.identity.publicKey),
        x25519IdentityKeyPublic: b64encode(imposter.identity.x25519Public),
    });
    await imposterStore.saveMeta({ deviceId: ALICE_DEVICE_ID });

    const forged = await encryptForConversation({
        conversationId: "conv-forged",
        plaintext: "I am Alice",
        remoteDevices: [bobBundle],
        keyStore: imposterStore,
    });

    await assert.rejects(
        decryptMessage({
            conversationId: "conv-forged",
            ciphertext: transport(forged.ciphertext),
            keyStore: bobStore,
        }),
        /Identity key changed/,
    );
});
});

// ───────────────────────────────────────────────────────────
// source: tests/signal/identity.test.js
// ───────────────────────────────────────────────────────────
describe("suite: identity", () => {
// ==========================================================
// Device identity / registration payload tests
// Run: node --test tests/signal/
// ==========================================================








test("device identity generation", () => {
    const { identity, signedPrekey } = generateDeviceIdentity({ signedPrekeyId: 7 });
    assert.equal(identity.publicKey.length, 32);
    assert.equal(identity.privateKey.length, 32);
    assert.equal(identity.x25519Public.length, 32);
    assert.equal(signedPrekey.keyId, 7);
    assert.equal(signedPrekey.publicKey.length, 32);
    assert.equal(signedPrekey.signature.length, 64);
});

test("signed prekey signature verifies under identity key", () => {
    const { identity, signedPrekey } = generateDeviceIdentity();
    assert.equal(
        ed25519Verify(
            identity.publicKey,
            signedPrekey.signature,
            signedPrekey.publicKey,
        ),
        true,
    );
});

test("one-time prekeys batch", () => {
    const opks = generateOneTimePrekeys({ startId: 10, count: 5 });
    assert.equal(opks.length, 5);
    assert.deepEqual(opks.map((o) => o.keyId), [10, 11, 12, 13, 14]);
    for (const opk of opks) {
        assert.equal(opk.publicKey.length, 32);
        assert.equal(opk.privateKey.length, 32);
    }
});

test("default batch size is 100", () => {
    assert.equal(OPK_BATCH_SIZE, 100);
    assert.equal(generateOneTimePrekeys().length, 100);
});

test("register payload shape matches backend RegisterDeviceRequest", () => {
    const deviceId = generateDeviceId();
    const { identity, signedPrekey } = generateDeviceIdentity();
    const oneTimePrekeys = generateOneTimePrekeys({ count: 2 });

    const payload = buildRegisterPayload({
        deviceId,
        platform: "web",
        deviceName: "My Browser",
        platformVersion: "Chrome 120",
        appVersion: "1.0.0",
        identity,
        signedPrekey,
        oneTimePrekeys,
    });

    assert.equal(payload.device_id, deviceId);
    assert.equal(payload.platform, "web");
    assert.equal(payload.device_name, "My Browser");
    assert.ok(payload.identity_key_public);
    assert.ok(payload.identity_key_x25519);
    assert.equal(payload.identity_key_private_encrypted, undefined);
    assert.ok(payload.signed_prekey_public);
    assert.equal(payload.signed_prekey_private_encrypted, undefined);
    assert.equal(payload.signed_prekey_id, 1);
    assert.ok(payload.signed_prekey_signature);
    assert.equal(payload.one_time_prekeys.length, 2);
    for (const opk of payload.one_time_prekeys) {
        assert.equal(typeof opk.key_id, "number");
        assert.ok(opk.public_key);
        assert.equal(opk.private_key_encrypted, undefined);
    }

    // public keys re-encode to 32 raw bytes
    assert.equal(b64decode(payload.identity_key_public).length, 32);
    assert.equal(b64decode(payload.identity_key_x25519).length, 32);

    // device id fits backend constraint (8..64 chars)
    assert.ok(deviceId.length >= 8 && deviceId.length <= 64);
});

test("device id generation is unique", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateDeviceId()));
    assert.equal(ids.size, 20);
});
});

// ───────────────────────────────────────────────────────────
// source: tests/signal/keyStorage.test.js
// ───────────────────────────────────────────────────────────
describe("suite: keyStorage", () => {
// ==========================================================
// Account RSA key storage (IndexedDB) tests
// Run: node --test tests/signal/
// ==========================================================








// Node has no localStorage; the module only touches it for the
// one-time legacy migration. Stub it before the first open.
const ls = new Map();
globalThis.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: (k) => ls.delete(k),
    clear: () => ls.clear(),
};

// Seed legacy values BEFORE the first DB open so the migration
// test (below) observes the lift.
localStorage.setItem("nexara_public_key", "legacy-pub");
localStorage.setItem("nexara_private_key", "legacy-priv");

test("legacy localStorage values migrate on first open", async () => {
    assert.equal(await getPrivateKey(), "legacy-priv");
    assert.equal(await getPublicKey(), "legacy-pub");

    // LocalStorage copies are removed once migrated.
    assert.equal(localStorage.getItem("nexara_public_key"), null);
    assert.equal(localStorage.getItem("nexara_private_key"), null);

    await clearKeyPair();
});

test("keys roundtrip through IndexedDB", async () => {
    await saveKeyPair("pub-abc", "priv-xyz");

    assert.equal(await getPublicKey(), "pub-abc");
    assert.equal(await getPrivateKey(), "priv-xyz");
    assert.equal((await loadKeyPair()).publicKey, "pub-abc");
    assert.equal((await loadKeyPair()).privateKey, "priv-xyz");
    assert.equal(await hasKeyPair(), true);

    await clearKeyPair();
    assert.equal(await getPublicKey(), null);
    assert.equal(await getPrivateKey(), null);
    assert.equal(await hasKeyPair(), false);
});

test("keys are NOT written to localStorage", async () => {
    await saveKeyPair("pub-no-ls", "priv-no-ls");

    assert.equal(localStorage.getItem("nexara_public_key"), null);
    assert.equal(localStorage.getItem("nexara_private_key"), null);

    await clearKeyPair();
});
});

// ───────────────────────────────────────────────────────────
// source: tests/signal/keyStore.test.js
// ───────────────────────────────────────────────────────────
describe("suite: keyStore", () => {
// ==========================================================
// Key store tests (Node with fake-indexeddb)
// Run: node --test tests/signal/
// ==========================================================







let store;

beforeEach(() => {
    store = new SignalKeyStore();
});

test("identity roundtrip", async () => {
    await store.saveIdentity({
        deviceId: "web-abc",
        identityKeyPrivate: "priv",
        identityKeyPublic: "pub",
        x25519IdentityKeyPublic: "xpub",
    });
    const identity = await store.getIdentity();
    assert.equal(identity.deviceId, "web-abc");
    assert.equal(identity.identityKeyPublic, "pub");
    assert.equal(identity.x25519IdentityKeyPublic, "xpub");
});

test("signed prekey roundtrip and clear", async () => {
    await store.saveSignedPrekey({
        keyId: 1,
        publicKey: "spk-pub",
        signature: "sig",
        privateKey: "spk-priv",
    });
    const spk = await store.getSignedPrekey(1);
    assert.equal(spk.privateKey, "spk-priv");

    await store.saveSignedPrekey({
        keyId: 2,
        publicKey: "spk-pub-2",
        signature: "sig2",
        privateKey: "spk-priv-2",
    });
    const all = await store.getAllSignedPrekeys();
    assert.equal(all.length, 2);
    assert.equal(all[1].keyId, 2);

    await store.clearSignedPrekeys();
    assert.equal((await store.getAllSignedPrekeys()).length, 0);
});

test("one-time prekeys roundtrip, count and removal", async () => {
    await store.saveOneTimePrekeys([
        { keyId: 1, publicKey: "p1", privateKey: "k1" },
        { keyId: 2, publicKey: "p2", privateKey: "k2" },
    ]);
    assert.equal(await store.getOneTimePrekeyCount(), 2);

    await store.removeOneTimePrekey(1);
    assert.equal(await store.getOneTimePrekeyCount(), 1);
    const remaining = await store.getAllOneTimePrekeys();
    assert.equal(remaining[0].keyId, 2);

    await store.clearOneTimePrekeys();
    assert.equal(await store.getOneTimePrekeyCount(), 0);
});

test("sessions roundtrip and delete", async () => {
    const key = {
        ourDeviceId: "web-a",
        remoteDeviceId: "web-b",
        conversationId: "conv-1",
    };
    const state = { root_key: "hex", sending_chain: { key: "x", index: 2 } };

    assert.equal(await store.getSession(key), null);
    await store.saveSession(key, state);
    assert.deepEqual(await store.getSession(key), state);

    const other = { ...key, remoteDeviceId: "web-c" };
    assert.equal(await store.getSession(other), null);

    await store.deleteSession(key);
    assert.equal(await store.getSession(key), null);
});

test("meta roundtrip and clearAll wipes everything", async () => {
    await store.saveMeta({ deviceId: "web-xyz", isPrimary: true });
    const meta = await store.getMeta();
    assert.equal(meta.deviceId, "web-xyz");
    assert.equal(meta.isPrimary, true);

    await store.saveIdentity({
        deviceId: "web-xyz",
        identityKeyPrivate: "p",
        identityKeyPublic: "q",
        x25519IdentityKeyPublic: "r",
    });
    await store.saveOneTimePrekeys([{ keyId: 9, publicKey: "x", privateKey: "y" }]);
    await store.saveSession(
        { ourDeviceId: "a", remoteDeviceId: "b", conversationId: "c" },
        { root_key: "1" },
    );

    await store.clearAll();
    assert.equal(await store.getMeta(), null);
    assert.equal(await store.getIdentity(), null);
    assert.equal(await store.getOneTimePrekeyCount(), 0);
    assert.equal(
        await store.getSession({ ourDeviceId: "a", remoteDeviceId: "b", conversationId: "c" }),
        null,
    );
});
});

// ───────────────────────────────────────────────────────────
// source: tests/signal/prekeyManager.test.js
// ───────────────────────────────────────────────────────────
describe("suite: prekeyManager", () => {
// ==========================================================
// One-Time PreKey manager tests (Node + fake-indexeddb)
// Run: node --test tests/signal/
// ==========================================================








let store;
let uploads;

beforeEach(async () => {
    store = new SignalKeyStore("test-replenish");
    await store.clearAll();
    uploads = [];
});

function noopUpload(payload) {
    uploads.push(payload);
    return payload;
}

test("replenishes when the pool is below the threshold", async () => {
    const result = await replenishOneTimePrekeys({
        keyStore: store,
        threshold: 3,
        batchSize: 5,
        upload: noopUpload,
    });

    assert.equal(result.replenished, 5);
    assert.equal(result.count, 5);
    assert.equal(result.uploaded, 5);
    assert.equal(await store.getOneTimePrekeyCount(), 5);

    // Uploaded payload matches the local keys
    const local = await store.getAllOneTimePrekeys();
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].length, 5);
    assert.equal(uploads[0][0].key_id, local[0].keyId);
    assert.equal(uploads[0][0].public_key, local[0].publicKey);
});

test("does nothing while the pool is healthy", async () => {
    await replenishOneTimePrekeys({
        keyStore: store,
        threshold: 3,
        batchSize: 5,
        upload: noopUpload,
    });
    uploads.length = 0;

    const result = await replenishOneTimePrekeys({
        keyStore: store,
        threshold: 3,
        batchSize: 5,
        upload: noopUpload,
    });

    assert.equal(result.replenished, 0);
    assert.equal(result.uploaded, 0);
    assert.equal(uploads.length, 0);
    assert.equal(await store.getOneTimePrekeyCount(), 5);
});

test("continues key numbering after partial consumption", async () => {
    await replenishOneTimePrekeys({
        keyStore: store,
        threshold: 2,
        batchSize: 5,
        upload: noopUpload,
    });

    // Consume four: pool 5 -> 1 (below threshold)
    const local = await store.getAllOneTimePrekeys();
    for (const opk of local.slice(0, 4)) {
        await store.removeOneTimePrekey(opk.keyId);
    }
    assert.equal(await store.getOneTimePrekeyCount(), 1);

    const result = await replenishOneTimePrekeys({
        keyStore: store,
        threshold: 3,
        batchSize: 5,
        upload: noopUpload,
    });

    assert.equal(result.replenished, 5);
    assert.equal(uploads.at(-1)[0].key_id, 6); // ids continue past 5
    assert.equal(await store.getOneTimePrekeyCount(), 6);

    // No duplicate private keys ever stored
    const keys = (await store.getAllOneTimePrekeys())
        .flatMap((opk) => [opk.privateKey]);
    assert.equal(new Set(keys).size, keys.length);
});

test("keeps local keys even when the upload fails", async () => {
    const result = await replenishOneTimePrekeys({
        keyStore: store,
        threshold: 3,
        batchSize: 5,
        upload: () => { throw new Error("network down"); },
    });

    assert.equal(result.replenished, 5);
    assert.equal(result.uploaded, 0);
    assert.equal(await store.getOneTimePrekeyCount(), 5);
});

test("empty pool with no registered device is a no-op", async () => {
    const result = await replenishOneTimePrekeys({
        keyStore: new SignalKeyStore("test-empty"),
        threshold: 3,
        batchSize: 5,
        upload: noopUpload,
    });

    assert.equal(result.replenished, 5);
    assert.equal(uploads.length, 1);
});
});

// ───────────────────────────────────────────────────────────
// source: tests/signal/session.test.js
// ───────────────────────────────────────────────────────────
describe("suite: session", () => {
// ==========================================================
// JS mirror of backend/tests/test_signal_session.py
// Run: node --test tests/signal/
// ==========================================================










const utf8 = (s) => new TextEncoder().encode(s);

function makeBundle(bobIk, bobSpk, bobOpk, deviceId = "bob-device-1") {
    return createKeyBundle({
        deviceId,
        identityKeyPrivate: bobIk,
        signedPrekeyPrivate: bobSpk,
        signedPrekeyId: 1,
        oneTimePrekeys: [{ keyId: 7, privateKey: bobOpk }],
    });
}

test("full session flow (X3DH handshake + double ratchet)", async () => {
    // --- Bob's keys + bundle ---
    const bob = generateEd25519Keypair();
    const bobSpk = generateX25519Keypair();
    const bobOpk = generateX25519Keypair();
    const bundle = makeBundle(bob.privateKey, bobSpk.privateKey, bobOpk.privateKey);

    const alice = generateEd25519Keypair();

    const aliceMgr = new SignalSessionManager(new InMemorySessionStore());
    const bobMgr = new SignalSessionManager(new InMemorySessionStore());

    // --- Alice first message (X3DH) ---
    const env1 = await aliceMgr.encryptFirst({
        ourDeviceId: "alice-device-1",
        ourUserId: "user-alice",
        ourIdentityPrivate: alice.privateKey,
        theirDeviceId: "bob-device-1",
        theirBundle: bundle,
        conversationId: "conv-1",
        plaintext: utf8("Hello Bob, this is Alice!"),
    });
    assert.equal(env1.type, "prekey");

    const res1 = await bobMgr.decryptFirst({
        envelope: env1,
        ourDeviceId: "bob-device-1",
        ourIdentityKey: bob.privateKey,
        signedPrekey: {
            key_id: 1,
            private_key: b64encode(bobSpk.privateKey),
        },
        oneTimePrekey: {
            key_id: 7,
            private_key: b64encode(bobOpk.privateKey),
        },
        conversationId: "conv-1",
    });
    assert.deepEqual(res1.plaintext, utf8("Hello Bob, this is Alice!"));
    assert.equal(res1.newSession, true);

    // --- Bob replies ---
    const env2 = await bobMgr.encrypt({
        ourDeviceId: "bob-device-1",
        ourUserId: "user-bob",
        remoteDeviceId: "alice-device-1",
        conversationId: "conv-1",
        plaintext: utf8("Hello Alice, message received!"),
    });
    const res2 = await aliceMgr.decrypt({
        envelope: env2,
        ourDeviceId: "alice-device-1",
        conversationId: "conv-1",
    });
    assert.deepEqual(res2.plaintext, utf8("Hello Alice, message received!"));

    // --- 10 more messages each way ---
    for (let i = 0; i < 10; i++) {
        const env = await aliceMgr.encrypt({
            ourDeviceId: "alice-device-1",
            ourUserId: "user-alice",
            remoteDeviceId: "bob-device-1",
            conversationId: "conv-1",
            plaintext: utf8(`A${i}`),
        });
        const ra = await bobMgr.decrypt({
            envelope: env,
            ourDeviceId: "bob-device-1",
            conversationId: "conv-1",
        });
        assert.deepEqual(ra.plaintext, utf8(`A${i}`));

        const env2 = await bobMgr.encrypt({
            ourDeviceId: "bob-device-1",
            ourUserId: "user-bob",
            remoteDeviceId: "alice-device-1",
            conversationId: "conv-1",
            plaintext: utf8(`B${i}`),
        });
        const rb = await aliceMgr.decrypt({
            envelope: env2,
            ourDeviceId: "alice-device-1",
            conversationId: "conv-1",
        });
        assert.deepEqual(rb.plaintext, utf8(`B${i}`));
    }
});

test("session state persistence", async () => {
    const bob = generateEd25519Keypair();
    const bobSpk = generateX25519Keypair();
    const bobOpk = generateX25519Keypair();
    const bundle = makeBundle(bob.privateKey, bobSpk.privateKey, bobOpk.privateKey);
    const alice = generateEd25519Keypair();

    const aliceStore = new InMemorySessionStore();
    const bobStore = new InMemorySessionStore();
    const aliceMgr = new SignalSessionManager(aliceStore);
    const bobMgr = new SignalSessionManager(bobStore);

    const env1 = await aliceMgr.encryptFirst({
        ourDeviceId: "a-1",
        ourUserId: "u-a",
        ourIdentityPrivate: alice.privateKey,
        theirDeviceId: "b-1",
        theirBundle: bundle,
        conversationId: "c-1",
        plaintext: utf8("first"),
    });
    await bobMgr.decryptFirst({
        envelope: env1,
        ourDeviceId: "b-1",
        ourIdentityKey: bob.privateKey,
        signedPrekey: { key_id: 1, private_key: b64encode(bobSpk.privateKey) },
        oneTimePrekey: { key_id: 7, private_key: b64encode(bobOpk.privateKey) },
        conversationId: "c-1",
    });

    // Restore from serialized state
    const saved = await aliceStore.get("a-1", "b-1", "c-1");
    const restored = RatchetState.fromDict(
        JSON.parse(JSON.stringify(saved.toDict())),
    );
    assert.deepEqual(restored.rootKey, saved.rootKey);

    // Messages still work after restore
    const env = await aliceMgr.encrypt({
        ourDeviceId: "a-1",
        ourUserId: "u-a",
        remoteDeviceId: "b-1",
        conversationId: "c-1",
        plaintext: utf8("after restart"),
    });
    const res = await bobMgr.decrypt({
        envelope: env,
        ourDeviceId: "b-1",
        conversationId: "c-1",
    });
    assert.deepEqual(res.plaintext, utf8("after restart"));
});

test("no session raises", async () => {
    const mgr = new SignalSessionManager(new InMemorySessionStore());
    await assert.rejects(
        mgr.encrypt({
            ourDeviceId: "a",
            ourUserId: "u1",
            remoteDeviceId: "b-1",
            conversationId: "c-1",
            plaintext: utf8("hi"),
        }),
    );
});
});

// ───────────────────────────────────────────────────────────
// source: tests/signal/signalProtocol.test.js
// ───────────────────────────────────────────────────────────
describe("suite: signalProtocol", () => {
// ==========================================================
// JS mirror of backend/tests/test_signal_protocol.py
// Run: node --test tests/signal/
// ==========================================================









const utf8 = (s) => new TextEncoder().encode(s);

// ==========================================================
// Primitives
// ==========================================================

test("x25519 DH matches both sides", () => {
    const a = generateX25519Keypair();
    const b = generateX25519Keypair();
    assert.deepEqual(x25519Dh(a.privateKey, b.publicKey), x25519Dh(b.privateKey, a.publicKey));
});

test("ed25519 sign/verify", () => {
    const { privateKey, publicKey } = generateEd25519Keypair();
    const sig = ed25519Sign(privateKey, utf8("hello"));
    assert.equal(ed25519Verify(publicKey, sig, utf8("hello")), true);
    assert.equal(ed25519Verify(publicKey, sig, utf8("tampered")), false);
});

test("kdf root chain lengths", () => {
    const root = new Uint8Array(32).fill(0x52); // b"R"*32
    const dh = new Uint8Array(32).fill(0x44);   // b"D"*32
    const { rootKey, chainKey } = kdfRootChain(root, dh);
    assert.equal(rootKey.length, 32);
    assert.equal(chainKey.length, 32);
});

test("kdf chain key distinct outputs", () => {
    const ck = new Uint8Array(32).fill(0x43);
    const { nextChainKey, messageKey } = kdfChainKey(ck);
    assert.equal(nextChainKey.length, 32);
    assert.equal(messageKey.length, 32);
    assert.notDeepEqual(nextChainKey, messageKey);
});

test("aes-gcm roundtrip", () => {
    const key = generateSymmetricKey();
    const nonce = generateNonce();
    const ad = utf8("AD");
    const { ciphertext, nonce: used } = aesGcmEncrypt(key, utf8("secret"), ad, nonce);
    assert.deepEqual(aesGcmDecrypt(key, ciphertext, ad, used), utf8("secret"));
});

test("aes-gcm tamper fails", () => {
    const key = generateSymmetricKey();
    const nonce = generateNonce();
    const { ciphertext, nonce: used } = aesGcmEncrypt(key, utf8("secret"), utf8("AD"), nonce);
    const tampered = slice(ciphertext);
    tampered[tampered.length - 1] ^= 1;
    assert.throws(() => aesGcmDecrypt(key, tampered, utf8("AD"), used));
});

// ==========================================================
// Double Ratchet
// ==========================================================

test("message key derivation deterministic", () => {
    const mk = new TextEncoder().encode("MKMKMKMKMKMKMKMK"); // b"MK"*16
    const e1 = deriveMessageKeys(mk);
    const e2 = deriveMessageKeys(mk);
    assert.deepEqual(e1.encKey, e2.encKey);
    assert.deepEqual(e1.authKey, e2.authKey);
    assert.equal(e1.encKey.length, 32);
    assert.equal(e1.authKey.length, 32);
});

test("ratchet state roundtrip", () => {
    const state = new RatchetState({
        rootKey: new Uint8Array(32).fill(0x52),
        ourDhPair: DHKeyPair.new(),
        theirDhPublic: new Uint8Array(32).fill(0x54),
        sendingChain: new Chain(new Uint8Array(32).fill(0x53), 5),
        receivingChain: new Chain(new Uint8Array(32).fill(0x43), 3),
        skippedMessageKeys: {},
        associatedData: new Uint8Array(64).fill(0x41),
    });
    const state2 = RatchetState.fromDict(JSON.parse(JSON.stringify(state.toDict())));
    assert.deepEqual(state2.rootKey, state.rootKey);
    assert.deepEqual(state2.ourDhPair.publicRaw, state.ourDhPair.publicRaw);
    assert.equal(state2.sendingChain.index, 5);
});

test("bidirectional ratchet", () => {
    const shared = new Uint8Array(32).fill(0x53);
    const ad = new Uint8Array(64).fill(0x41);
    const alice = new DoubleRatchetCore(shared, ad);
    const bob = new DoubleRatchetCore(shared, ad);

    alice.theirDhPublic = bob.ourDhPair.publicRaw;
    alice.initializeInitiator();

    let { header, payload } = alice.encrypt_message(utf8("Hello"));
    assert.deepEqual(bob.decrypt_message(header, payload), utf8("Hello"));

    let r = bob.encrypt_message(utf8("Hi"));
    assert.deepEqual(alice.decrypt_message(r.header, r.payload), utf8("Hi"));

    for (let i = 0; i < 20; i++) {
        const a = alice.encrypt_message(utf8(`A${i}`));
        assert.deepEqual(bob.decrypt_message(a.header, a.payload), utf8(`A${i}`));
        const b = bob.encrypt_message(utf8(`B${i}`));
        assert.deepEqual(alice.decrypt_message(b.header, b.payload), utf8(`B${i}`));
    }
});

test("out-of-order delivery", () => {
    const shared = new Uint8Array(32).fill(0x53);
    const ad = new Uint8Array(64).fill(0x41);
    const alice = new DoubleRatchetCore(shared, ad);
    const bob = new DoubleRatchetCore(shared, ad);
    alice.theirDhPublic = bob.ourDhPair.publicRaw;
    alice.initializeInitiator();

    const msgs = [];
    for (let i = 0; i < 5; i++) {
        msgs.push(alice.encrypt_message(utf8(`M${i}`)));
    }
    for (const i of [2, 0, 1, 4, 3]) {
        assert.deepEqual(bob.decrypt_message(msgs[i].header, msgs[i].payload), utf8(`M${i}`));
    }
    // replay rejected
    assert.throws(() => bob.decrypt_message(msgs[0].header, msgs[0].payload));
});

test("state save/restore", () => {
    const ad = new Uint8Array(64).fill(0x41);
    const alice = new DoubleRatchetCore(new Uint8Array(32).fill(0x53), ad);
    const bob = new DoubleRatchetCore(new Uint8Array(32).fill(0x53), ad);
    alice.theirDhPublic = bob.ourDhPair.publicRaw;
    alice.initializeInitiator();

    for (let i = 0; i < 3; i++) {
        const m = alice.encrypt_message(utf8(`M${i}`));
        bob.decrypt_message(m.header, m.payload);
    }

    const restored = DoubleRatchetCore.fromState(
        RatchetState.fromDict(JSON.parse(JSON.stringify(alice.state().toDict()))),
    );
    const m = restored.encrypt_message(utf8("M3"));
    assert.deepEqual(bob.decrypt_message(m.header, m.payload), utf8("M3"));
});

// ==========================================================
// Envelope
// ==========================================================

test("prekey envelope roundtrip", () => {
    const ek = generateX25519Keypair();
    const ik = generateEd25519Keypair();
    const env = buildPrekeyMessage({
        deviceId: "d1",
        senderId: "u1",
        ourIdentityPrivate: ik.privateKey,
        ourEphemeralPrivate: ek.privateKey,
        ratchetHeader: { pn: 0, n: 0, dh: "ab".repeat(32) },
        ciphertext: new Uint8Array([1, 2]),
        signedPrekeyId: 1,
        oneTimePrekeyId: 3,
    });
    const env2 = SignalEnvelope.fromJson(env.toJson());
    const info = parsePrekeyMessage(env2);
    assert.equal(info.signedPrekeyId, 1);
    assert.equal(info.oneTimePrekeyId, 3);
});

test("malformed envelope rejected", () => {
    assert.throws(() => SignalEnvelope.fromJson("not json"), EnvelopeError);
    assert.throws(
        () =>
            SignalEnvelope.fromJson(
                JSON.stringify({
                    type: "data",
                    version: 99,
                    device_id: "d",
                    sender_id: "s",
                    ratchet: {},
                    ciphertext: "",
                }),
            ),
        EnvelopeError,
    );
});

// ==========================================================
// Helpers
// ==========================================================

function slice(bytes) {
    return Uint8Array.from(bytes);
}
});

// ───────────────────────────────────────────────────────────
// source: tests/signal/syncCrypto.test.js
// ───────────────────────────────────────────────────────────
describe("suite: syncCrypto", () => {
// ==========================================================
// Account sync crypto: recovery code wrap + sync copies
// ==========================================================

test("normalizeRecoveryCode strips formatting and uppercases", () => {
    assert.equal(
        normalizeRecoveryCode("abcd12-efgh34-ijkl56-mnop78"),
        "ABCD12EFGH34IJKL56MNOP78",
    );
});

test("deriveWrapKeyFromCode is deterministic per code+salt", () => {
    const salt = btoa("0123456789abcdef");
    const a = deriveWrapKeyFromCode("ABCDEF", salt);
    const b = deriveWrapKeyFromCode("ABCDEF", salt);
    const c = deriveWrapKeyFromCode("ABCDEG", salt);
    const d = deriveWrapKeyFromCode("ABCDEF", btoa("0123456789abcdeg"));
    assert.deepEqual(a, b);
    assert.equal(a.length, SYNC_KEY_SIZE);
    assert.notDeepEqual(a, c, "different code -> different key");
    assert.notDeepEqual(a, d, "different salt -> different key");
});

test("unwrapSyncSecret roundtrip with a valid code", () => {
    const salt = btoa("0123456789abcdef");
    const wrapped = (() => {
        // Simulate the server wrap: PBKDF2 key + AES-GCM(secret).
        // Built with the same module so the roundtrip is honest.
        const key = deriveWrapKeyFromCode("SECRETCODE1", salt);
        const nonce = new Uint8Array(12).fill(7);
        const secret = new Uint8Array(32).fill(9);
        const data = gcm(key, nonce).encrypt(secret);
        return { nonce: btoa(String.fromCharCode(...nonce)), data: btoa(String.fromCharCode(...data)) };
    })();

    const secret = unwrapSyncSecret("SECRETCODE1", salt, wrapped);
    assert.ok(secret, "valid code unlocks the secret");
    assert.equal(secret.length, 44, "32 bytes -> base64 length 44");
});

test("unwrapSyncSecret rejects a wrong code", () => {
    const salt = btoa("0123456789abcdef");
    const key = deriveWrapKeyFromCode("GOODCODE123", salt);
    const nonce = new Uint8Array(12);
    const data = gcm(key, nonce).encrypt(new Uint8Array(32).fill(1));
    const wrapped = { nonce: btoa(String.fromCharCode(...nonce)), data: btoa(String.fromCharCode(...data)) };

    assert.equal(
        unwrapSyncSecret("WRONGCODE!!", salt, wrapped),
        null,
        "wrong code fails the GCM tag",
    );
});

test("sync copies: text and bytes roundtrip after unlocking", async () => {
    const salt = btoa("0123456789abcdef");
    const key = deriveWrapKeyFromCode("ROUNDTRIP9", salt);
    const nonce = new Uint8Array(12).fill(3);
    const secret = new Uint8Array(32).fill(5);
    const data = gcm(key, nonce).encrypt(secret);

    await signalKeyStore.saveSyncSecret(
        btoa(String.fromCharCode(...secret)),
    );

    const env = await encryptSyncText("hello from the account", "cipher-fp");
    assert.equal(env.ciphertext, "cipher-fp");
    assert.equal(
        await decryptSyncText(env),
        "hello from the account",
    );

    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const blob = await encryptSyncBytes(bytes);
    assert.deepEqual(
        await decryptSyncBytes(blob),
        bytes,
    );

    // Tampered data must not decrypt.
    const tampered = { ...env, data: "AAAA" + env.data.slice(4) };
    assert.equal(
        await decryptSyncText(tampered),
        null,
    );
});

test("sync copies without a stored secret return null", async () => {
    await signalKeyStore.saveSyncSecret("");
    clearSyncKeyCache();
    const env = { nonce: "AAAA", data: "BBBB" };
    assert.equal(await encryptSyncText("x"), null);
    assert.equal(await decryptSyncText(env), null);
    assert.equal(await decryptSyncBytes(env), null);
});
});

// ───────────────────────────────────────────────────────────
// source: Phase 0.3 — WebSocket offline queue
// ───────────────────────────────────────────────────────────
describe("suite: websocketOfflineQueue", () => {
    test("messages are queued when socket is null", () => {
        const svc = {
            socket: null,
            _pendingQueue: [],
            _pendingQueueMax: 100,
            _enqueue(msg) {
                this._pendingQueue.push({ ...msg, _queuedAt: Date.now() });
                if (this._pendingQueue.length > this._pendingQueueMax) {
                    this._pendingQueue.shift();
                }
            },
            _flushPendingQueue() {
                const queue = [...this._pendingQueue];
                this._pendingQueue = [];
                for (const msg of queue) {
                    if (!this.socket || this.socket.readyState !== 1) {
                        this._pendingQueue.push(msg);
                        continue;
                    }
                    this.socket.send(JSON.stringify(msg));
                }
            },
        };

        svc._enqueue({ event: "message", conversation_id: "c1", ciphertext: "enc1" });
        svc._enqueue({ event: "message", conversation_id: "c2", ciphertext: "enc2" });

        assert.equal(svc._pendingQueue.length, 2);
        assert.equal(svc._pendingQueue[0].event, "message");
        assert.equal(svc._pendingQueue[0].conversation_id, "c1");
        assert.equal(svc._pendingQueue[1].conversation_id, "c2");
    });

    test("queue drops oldest when exceeding max", () => {
        const svc = {
            socket: null,
            _pendingQueue: [],
            _pendingQueueMax: 3,
            _enqueue(msg) {
                this._pendingQueue.push({ ...msg, _queuedAt: Date.now() });
                if (this._pendingQueue.length > this._pendingQueueMax) {
                    this._pendingQueue.shift();
                }
            },
        };

        svc._enqueue({ event: "message", id: 1 });
        svc._enqueue({ event: "message", id: 2 });
        svc._enqueue({ event: "message", id: 3 });
        svc._enqueue({ event: "message", id: 4 });

        assert.equal(svc._pendingQueue.length, 3);
        assert.equal(svc._pendingQueue[0].id, 2);
        assert.equal(svc._pendingQueue[2].id, 4);
    });

    test("flush sends queued messages and clears queue", () => {
        const sent = [];
        const svc = {
            socket: { readyState: 1, send(data) { sent.push(JSON.parse(data)); } },
            _pendingQueue: [],
            _pendingQueueMax: 100,
            _enqueue(msg) {
                this._pendingQueue.push({ ...msg, _queuedAt: Date.now() });
                if (this._pendingQueue.length > this._pendingQueueMax) {
                    this._pendingQueue.shift();
                }
            },
            _flushPendingQueue() {
                const queue = [...this._pendingQueue];
                this._pendingQueue = [];
                for (const msg of queue) {
                    if (!this.socket || this.socket.readyState !== 1) {
                        this._pendingQueue.push(msg);
                        continue;
                    }
                    const { _queuedAt: _, ...payload } = msg;
                    this.socket.send(JSON.stringify(payload));
                }
            },
        };

        svc._enqueue({ event: "message", id: 1 });
        svc._enqueue({ event: "edit", id: 2 });

        svc._flushPendingQueue();

        assert.equal(svc._pendingQueue.length, 0);
        assert.equal(sent.length, 2);
        assert.equal(sent[0].event, "message");
        assert.equal(sent[1].event, "edit");
    });

    test("flush re-queues messages when socket is closed", () => {
        const svc = {
            socket: { readyState: 3 },
            _pendingQueue: [],
            _pendingQueueMax: 100,
            _enqueue(msg) {
                this._pendingQueue.push({ ...msg, _queuedAt: Date.now() });
                if (this._pendingQueue.length > this._pendingQueueMax) {
                    this._pendingQueue.shift();
                }
            },
            _flushPendingQueue() {
                const queue = [...this._pendingQueue];
                this._pendingQueue = [];
                for (const msg of queue) {
                    if (!this.socket || this.socket.readyState !== 1) {
                        this._pendingQueue.push(msg);
                        continue;
                    }
                    this.socket.send(JSON.stringify(msg));
                }
            },
        };

        svc._enqueue({ event: "message", id: 1 });
        svc._flushPendingQueue();

        assert.equal(svc._pendingQueue.length, 1);
        assert.equal(svc._pendingQueue[0].id, 1);
    });

    test("_queuedAt is stripped during flush", () => {
        const sent = [];
        const svc = {
            socket: { readyState: 1, send(data) { sent.push(JSON.parse(data)); } },
            _pendingQueue: [],
            _pendingQueueMax: 100,
            _enqueue(msg) {
                this._pendingQueue.push({ ...msg, _queuedAt: 12345 });
            },
            _flushPendingQueue() {
                const queue = [...this._pendingQueue];
                this._pendingQueue = [];
                for (const msg of queue) {
                    if (!this.socket || this.socket.readyState !== 1) {
                        this._pendingQueue.push(msg);
                        continue;
                    }
                    const { _queuedAt: _, ...payload } = msg;
                    this.socket.send(JSON.stringify(payload));
                }
            },
        };

        svc._enqueue({ event: "message", id: 1 });
        svc._flushPendingQueue();

        assert.equal(sent.length, 1);
        assert.equal(sent[0]._queuedAt, undefined);
        assert.equal(sent[0].event, "message");
    });
});
