import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
    saveIdentity: vi.fn(),
    saveSignedPrekey: vi.fn(),
    saveOneTimePrekeys: vi.fn(),
    saveMeta: vi.fn(),
    getMeta: vi.fn(),
    getIdentity: vi.fn(),
    getAllSignedPrekeys: vi.fn(),
    getSyncSecret: vi.fn(),
    getSyncRecord: vi.fn(),
    clearDeviceMaterial: vi.fn(),
    listDevices: vi.fn(),
    registerDevice: vi.fn(),
    rotateSignedPrekey: vi.fn(),
    deviceCounter: 0,
}));

vi.mock("../crypto/signal/keyStore", () => ({
    signalKeyStore: {
        getMeta: mocks.getMeta,
        getIdentity: mocks.getIdentity,
        getAllSignedPrekeys: mocks.getAllSignedPrekeys,
        saveIdentity: mocks.saveIdentity,
        saveSignedPrekey: mocks.saveSignedPrekey,
        saveOneTimePrekeys: mocks.saveOneTimePrekeys,
        saveMeta: mocks.saveMeta,
        getSyncSecret: mocks.getSyncSecret,
        getSyncRecord: mocks.getSyncRecord,
        clearDeviceMaterial: mocks.clearDeviceMaterial,
    },
}));

vi.mock("./deviceService", () => ({
    default: {
        listDevices: mocks.listDevices,
        registerDevice: mocks.registerDevice,
        rotateSignedPrekey: mocks.rotateSignedPrekey,
        uploadPreKeys: vi.fn().mockResolvedValue({}),
        removeDevice: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock("./recoveryService", () => ({
    default: {
        unlockFromRegistration: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock("../crypto/keyStorage", () => ({
    clearKeyPair: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../crypto/signal/prekeyManager", () => ({
    replenishOneTimePrekeys: vi.fn().mockResolvedValue({
        replenished: 0,
        count: 0,
        uploaded: 0,
    }),
}));

vi.mock("../crypto/signal/bytes", () => ({
    b64encode: (x) => String(x),
    b64decode: (x) => x,
}));

const identity = vi.hoisted(() => ({
    generateDeviceId: vi.fn(),
    generateDeviceIdentity: vi.fn(),
    generateOneTimePrekeys: vi.fn(),
    buildRegisterPayload: vi.fn(),
    generateSignedPrekey: vi.fn(),
}));

vi.mock("../crypto/signal/identity", () => identity);

import {
    ensureDeviceRegistered,
} from "./signalService";

describe("ensureDeviceRegistered", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.deviceCounter = 0;
        mocks.getMeta.mockResolvedValue(null);
        mocks.getIdentity.mockResolvedValue(null);
        mocks.getAllSignedPrekeys.mockResolvedValue(null);
        mocks.getSyncSecret.mockResolvedValue(null);
        mocks.getSyncRecord.mockResolvedValue(null);
        mocks.saveIdentity.mockResolvedValue(undefined);
        mocks.saveSignedPrekey.mockResolvedValue(undefined);
        mocks.saveOneTimePrekeys.mockResolvedValue(undefined);
        mocks.saveMeta.mockResolvedValue(undefined);
        mocks.listDevices.mockResolvedValue({ devices: [] });
        mocks.registerDevice.mockResolvedValue({ success: true, is_primary: true });
        mocks.rotateSignedPrekey.mockResolvedValue({ success: true });

        identity.generateDeviceId.mockImplementation(
            () => `web-dev-${++mocks.deviceCounter}`
        );
        identity.generateDeviceIdentity.mockReturnValue({
            identity: {
                privateKey: "id-priv",
                publicKey: "id-pub",
                x25519Public: "id-x",
            },
            signedPrekey: {
                keyId: 7,
                publicKey: "spk-pub",
                signature: "sig",
                privateKey: "spk-priv",
            },
        });
        identity.generateOneTimePrekeys.mockReturnValue([
            { keyId: 1, publicKey: "opk-1-pub", privateKey: "opk-1-priv" },
        ]);
        identity.buildRegisterPayload.mockImplementation(
            (p) => ({ device_id: p.deviceId })
        );
        identity.generateSignedPrekey.mockImplementation(
            ({ identityPrivateKey, keyId }) => ({
                keyId,
                publicKey: "spk-new-pub",
                privateKey: "spk-new-priv",
                signature: "spk-new-sig",
            })
        );
    });

    it("registers a brand-new device when the server has none", async () => {

        const result = await ensureDeviceRegistered({ email: "a@b.c" });

        expect(mocks.registerDevice).toHaveBeenCalledTimes(1);
        expect(mocks.saveMeta).toHaveBeenCalledTimes(1);
        expect(result.generated).toBe(true);

    });

    it("keeps an existing device when the server still lists it", async () => {

        mocks.getMeta.mockResolvedValue({
            deviceId: "web-dev-existing",
            isPrimary: true,
        });
        mocks.listDevices.mockResolvedValue({
            devices: [{ device_id: "web-dev-existing" }],
        });

        const result = await ensureDeviceRegistered();

        expect(mocks.listDevices).toHaveBeenCalledTimes(1);
        expect(mocks.registerDevice).not.toHaveBeenCalled();
        expect(mocks.clearDeviceMaterial).not.toHaveBeenCalled();
        expect(result).toEqual({
            deviceId: "web-dev-existing",
            isPrimary: true,
            generated: false,
        });

    });

    it("re-registers when the server lost the device (stale local meta)", async () => {

        mocks.getMeta.mockResolvedValue({
            deviceId: "web-dev-stale",
            isPrimary: true,
        });
        mocks.listDevices.mockResolvedValue({
            devices: [{ device_id: "web-dev-other" }],
        });

        const result = await ensureDeviceRegistered();

        // The stale device id must be wiped so a fresh
        // registration runs (this is the send-404 fix).
        expect(mocks.clearDeviceMaterial).toHaveBeenCalledTimes(1);
        expect(mocks.registerDevice).toHaveBeenCalledTimes(1);
        expect(result.generated).toBe(true);
        expect(result.deviceId).not.toBe("web-dev-stale");

    });

    it("does NOT wipe the device when the server check fails transiently", async () => {

        mocks.getMeta.mockResolvedValue({
            deviceId: "web-dev-existing",
            isPrimary: true,
        });
        mocks.listDevices.mockRejectedValue(
            new Error("network down")
        );

        const result = await ensureDeviceRegistered();

        expect(mocks.clearDeviceMaterial).not.toHaveBeenCalled();
        expect(mocks.registerDevice).not.toHaveBeenCalled();
        expect(result.deviceId).toBe("web-dev-existing");
        expect(result.generated).toBe(false);

    });

    it("rotates an expired signed prekey so the device stays reachable", async () => {

        // No spkIssuedAt = legacy device. Its 30-day signed
        // prekey is surely expired server-side, so the boot
        // must replace it (the send-404 regression).
        mocks.getMeta.mockResolvedValue({
            deviceId: "web-dev-expired",
            isPrimary: true,
        });
        mocks.getIdentity.mockResolvedValue({
            identityKeyPrivate: "id-priv-legacy",
        });
        mocks.getAllSignedPrekeys.mockResolvedValue([
            { keyId: 7, publicKey: "spk-pub", privateKey: "spk-priv", signature: "sig" },
        ]);
        mocks.listDevices.mockResolvedValue({
            devices: [{ device_id: "web-dev-expired" }],
        });

        const result = await ensureDeviceRegistered();

        expect(result.generated).toBe(false);
        expect(mocks.registerDevice).not.toHaveBeenCalled();
        expect(mocks.rotateSignedPrekey).toHaveBeenCalledTimes(1);
        const uploaded = mocks.rotateSignedPrekey.mock.calls[0][0];
        expect(uploaded).toMatchObject({
            device_id: "web-dev-expired",
            key_id: 8,
            public_key: "spk-new-pub",
        });
        expect(mocks.saveSignedPrekey).toHaveBeenCalledWith(
            expect.objectContaining({ keyId: 8 })
        );
        expect(mocks.saveMeta).toHaveBeenCalledWith(
            expect.objectContaining({
                deviceId: "web-dev-expired",
                spkIssuedAt: expect.any(Number),
            })
        );

    });

    it("does NOT rotate a freshly-issued signed prekey", async () => {

        mocks.getMeta.mockResolvedValue({
            deviceId: "web-dev-fresh",
            isPrimary: true,
            spkIssuedAt: Date.now(),
        });
        mocks.listDevices.mockResolvedValue({
            devices: [{ device_id: "web-dev-fresh" }],
        });

        const result = await ensureDeviceRegistered();

        expect(result.generated).toBe(false);
        expect(mocks.rotateSignedPrekey).not.toHaveBeenCalled();

    });

});
