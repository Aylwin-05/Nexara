// ==========================================================
// Nexara frame encryption worker
//
// A classic (non-module) Web Worker loaded by RTCRtpScriptTransform.
// Encrypts/decrypts WebRTC audio/video frames with AES-256-GCM.
//
// The key material arrives only over the structured-clone of the
// RTCRtpScriptTransform options — it is derived on the main thread
// from the user's account sync secret and never crosses the network.
//
// Frame payload format (after decrypt / before encrypt):
//   [ original_length : 2 bytes BE ]
//   [ payload padded to 4-byte alignment ]
// The 12-byte AES-GCM nonce is derived from RTP metadata
// (sequence number + timestamp + SSRC), which both peers observe
// identically, so no counter state needs to travel in-band.
// ==========================================================

let key = null;
let operation = "encrypt";
let aad = null;

function bytesToUint16BE(value) {
    return [(value >> 8) & 0xff, value & 0xff];
}

function buildNonce(meta) {
    const nonce = new Uint8Array(12);
    const seq = meta.sequenceNumber ?? 0;
    const ts = meta.timestamp ?? 0;
    const ssrc = meta.synchronizationSource ?? 0;

    // sequenceNumber (2), timestamp (4), SSRC (4), zero (2)
    nonce[0] = (seq >> 8) & 0xff;
    nonce[1] = seq & 0xff;
    nonce[2] = (ts >>> 24) & 0xff;
    nonce[3] = (ts >>> 16) & 0xff;
    nonce[4] = (ts >>> 8) & 0xff;
    nonce[5] = ts & 0xff;
    nonce[6] = (ssrc >>> 24) & 0xff;
    nonce[7] = (ssrc >>> 16) & 0xff;
    nonce[8] = (ssrc >>> 8) & 0xff;
    nonce[9] = ssrc & 0xff;
    nonce[10] = 0;
    nonce[11] = 0;
    return nonce;
}

function padPayload(data) {
    const length = data.length;
    const paddedLength = Math.ceil(length / 4) * 4;
    const out = new Uint8Array(2 + paddedLength);
    out[0] = (length >> 8) & 0xff;
    out[1] = length & 0xff;
    out.set(data, 2);
    return out;
}

async function encryptFrame(frame) {
    const data = new Uint8Array(frame.data);
    const payload = padPayload(data);
    const nonce = buildNonce(frame.getMetadata());

    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: nonce,
                additionalData: aad,
            },
            key,
            payload,
        )
    );

    frame.data = ciphertext;
}

async function decryptFrame(frame) {
    const data = new Uint8Array(frame.data);
    const nonce = buildNonce(frame.getMetadata());

    let plaintext;

    try {
        plaintext = new Uint8Array(
            await crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: nonce,
                    additionalData: aad,
                },
                key,
                data,
            )
        );
    }
    catch (e) {
        // A frame we cannot open (e.g. an unencrypted peer or a
        // dropped auth tag) cannot be decoded safely — drop it.
        return null;
    }

    const originalLength =
        (plaintext[0] << 8) | plaintext[1];

    frame.data = plaintext.subarray(2, 2 + originalLength);
}

self.onmessage = async (event) => {
    const options = event.data;

    if (!options || !options.key) {
        return;
    }

    operation = options.operation || "encrypt";
    aad = options.aad || null;
    key = null;

    const keyBytes = new Uint8Array(options.key);

    try {
        key = await crypto.subtle.importKey(
            "raw",
            keyBytes,
            { name: "AES-GCM" },
            false,
            ["encrypt", "decrypt"],
        );
    }
    catch (e) {
        self.postMessage({ error: String(e) });
        return;
    }

    const transformer = event.transformer;

    if (!transformer) {
        return;
    }

    const transform = new TransformStream({
        async transform(frame, controller) {
            try {
                if (operation === "encrypt") {
                    await encryptFrame(frame);
                }
                else {
                    frame = await decryptFrame(frame);
                    if (frame === null) {
                        return;
                    }
                }
            }
            catch (e) {
                return;
            }

            controller.enqueue(frame);
        },
    });

    transformer.readable
        .pipeThrough(transform)
        .pipeTo(transformer.writable)
        .catch(() => {});
};