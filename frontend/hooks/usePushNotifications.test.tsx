// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  requestPermissions: vi.fn(),
  register: vi.fn(),
  addListener: vi.fn(),
  removeAllListeners: vi.fn(() => Promise.resolve()),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    requestPermissions: mocks.requestPermissions,
    register: mocks.register,
    addListener: mocks.addListener,
    removeAllListeners: mocks.removeAllListeners,
  },
}));

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: { schedule: vi.fn() },
}));

vi.mock("@/backend/api/pushToken.functions", () => ({
  savePushToken: vi.fn(),
}));

vi.mock("@/frontend/hooks/useMessageNotifications", () => ({
  getActiveConvId: () => null,
}));

const { usePushNotifications } = await import("./usePushNotifications");

describe("usePushNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never calls Firebase when the native build has no google-services.json", () => {
    // __WIZZ_FCM_CONFIGURED__ is false for this checkout, which is exactly the
    // APK case: no default FirebaseApp, so register() would throw natively and
    // Capacitor would rethrow it on the main thread.
    renderHook(() => usePushNotifications("user-1"));

    expect(mocks.isNativePlatform).toHaveBeenCalled();
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.addListener).not.toHaveBeenCalled();
  });
});
