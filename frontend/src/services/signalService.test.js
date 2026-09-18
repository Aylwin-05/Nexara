import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
    saveIdentity: vi.fn(),
    saveSignedPrekey: vi.fn(),
    saveOneTimePrekeys: vi.fn(),
    saveMeta: vi.fn(),
    getMeta: vi.fn(),
    getSyncSecret: vi.fn(),
    getSyncRecord: vi.fn(),
    clearDeviceMaterial: vi.fn(),
    listDevices: vi.fn(),
    registerDevice: vi.fn(),
    deviceCounter: 0,
}));

vi.mock("../crypto/signal/keyStore", () => ({
    signalKeyStore: {
        getMeta: mocks.getMeta,
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
}));

const identity = vi.hoisted(() => ({
    generateDeviceId: vi.fn(),
    generateDeviceIdentity: vi.fn(),
    generateOneTimePrekeys: vi.fn(),
    buildRegisterPayload: vi.fn(),
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
        mocks.getSyncSecret.mockResolvedValue(null);
        mocks.getSyncRecord.mockResolvedValue(null);
        mocks.saveIdentity.mockResolvedValue(undefined);
        mocks.saveSignedPrekey.mockResolvedValue(undefined);
        mocks.saveOneTimePrekeys.mockResolvedValue(undefined);
        mocks.saveMeta.mockResolvedValue(undefined);
        mocks.listDevices.mockResolvedValue({ devices: [] });
        mocks.registerDevice.mockResolvedValue({ success: true, is_primary: true });

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

});