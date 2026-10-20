// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthError, Session } from "@supabase/supabase-js";

const { signInWithOtp, verifyOtp, isNative } = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  isNative: { current: false },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signInWithOtp, verifyOtp } },
}));

vi.mock("@/frontend/lib/native", () => ({
  authRedirectOrigin: () =>
    isNative.current ? "https://wizz-kohl.vercel.app" : window.location.origin,
}));

import { EmailCodeLogin } from "./EmailCodeLogin";

const noBack = () => {};

function authError(message: string): AuthError {
  return { message, status: 400, name: "AuthApiError" } as AuthError;
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => {
  signInWithOtp.mockReset();
  verifyOtp.mockReset();
  isNative.current = false;
  window.localStorage.clear();
});

afterEach(cleanup);

describe("EmailCodeLogin — request step", () => {
  it("sends a code for a valid email and advances to the verify step", async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    render(<EmailCodeLogin mode="signin" onBack={noBack} />);

    type(screen.getByPlaceholderText("Email"), "Fan@Example.com");
    fireEvent.click(screen.getByRole("button", { name: /email me a code/i }));

    await waitFor(() =>
      expect(signInWithOtp).toHaveBeenCalledWith({
        email: "fan@example.com", // normalized to lowercase/trimmed
        options: { shouldCreateUser: false, emailRedirectTo: expect.any(String) },
      }),
    );
    await waitFor(() => expect(screen.getByPlaceholderText(/digit code/i)).toBeTruthy());
    expect(screen.getByText(/code sent to fan@example\.com/i)).toBeTruthy();
  });

  it("passes shouldCreateUser: true and full_name in signup mode", async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    render(<EmailCodeLogin mode="signup" name="  Alex  " onBack={noBack} />);

    type(screen.getByPlaceholderText("Email"), "new@example.com");
    fireEvent.click(screen.getByRole("button", { name: /create account with code/i }));

    await waitFor(() =>
      expect(signInWithOtp).toHaveBeenCalledWith({
        email: "new@example.com",
        options: {
          shouldCreateUser: true,
          emailRedirectTo: expect.any(String),
          data: { full_name: "Alex" },
        },
      }),
    );
  });

  it("rejects an invalid email without touching the network", async () => {
    render(<EmailCodeLogin mode="signin" onBack={noBack} />);

    type(screen.getByPlaceholderText("Email"), "not-an-email");
    fireEvent.click(screen.getByRole("button", { name: /email me a code/i }));

    await waitFor(() => expect(screen.getByText(/valid email/i)).toBeTruthy());
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("surfaces GoTrue's send error", async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: authError("Rate limit exceeded") });
    render(<EmailCodeLogin mode="signin" onBack={noBack} />);

    type(screen.getByPlaceholderText("Email"), "a@b.io");
    fireEvent.click(screen.getByRole("button", { name: /email me a code/i }));

    await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeTruthy());
  });

  it("calls onBack from the request step", async () => {
    const onBack = vi.fn();
    render(<EmailCodeLogin mode="signin" onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("EmailCodeLogin — verify step", () => {
  async function reachVerify() {
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    const utils = render(<EmailCodeLogin mode="signin" onBack={noBack} />);
    type(screen.getByPlaceholderText("Email"), "fan@example.com");
    fireEvent.click(screen.getByRole("button", { name: /email me a code/i }));
    await waitFor(() => expect(screen.getByPlaceholderText(/digit code/i)).toBeTruthy());
    return utils;
  }

  it("verifies a pasted code with separators stripped", async () => {
    verifyOtp.mockResolvedValue({ data: { session: {} as Session, user: null }, error: null });
    await reachVerify();

    type(screen.getByPlaceholderText(/digit code/i), "123 456");
    fireEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));

    await waitFor(() =>
      expect(verifyOtp).toHaveBeenCalledWith({
        email: "fan@example.com",
        token: "123456",
        type: "email",
      }),
    );
  });

  it("does not call verifyOtp for an incomplete code", async () => {
    await reachVerify();
    type(screen.getByPlaceholderText(/digit code/i), "123");
    fireEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));

    await waitFor(() => expect(screen.getByText(/6–8 digits/i)).toBeTruthy());
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("on a wrong code: shows the expiry message, counts a strike, clears the input", async () => {
    verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: authError("Token has expired or is invalid"),
    });
    await reachVerify();

    const input = screen.getByPlaceholderText(/digit code/i) as HTMLInputElement;
    type(input, "000000");
    fireEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));

    await waitFor(() => expect(screen.getByText(/didn't work/i)).toBeTruthy());
    expect(screen.getByText(/attempts? left before a cooldown/i)).toBeTruthy();
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("locks out after repeated failures", async () => {
    verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: authError("Token has expired or is invalid"),
    });
    await reachVerify();

    for (let i = 0; i < 3; i++) {
      type(screen.getByPlaceholderText(/digit code/i), "000000");
      fireEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));
      await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(i + 1));
    }
    // Fourth try is blocked before the network.
    fireEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));
    await waitFor(() => expect(screen.getByText(/locked for/i)).toBeTruthy());
    expect(verifyOtp).toHaveBeenCalledTimes(3);
  });

  it("disables resend during the cooldown with a countdown label", async () => {
    await reachVerify();
    // The countdown effect commits after mount; wait for the disabled state
    // rather than racing the first paint (which shows the enabled button).
    await waitFor(
      () => {
        const btn = screen.getByRole("button", { name: /resend/i }) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toMatch(/Resend in (60|59)s/);
      },
      { timeout: 2000 },
    );
  });

  it("calls onBack from the verify step", async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    const onBack = vi.fn();
    render(<EmailCodeLogin mode="signin" onBack={onBack} />);
    type(screen.getByPlaceholderText("Email"), "a@b.io");
    fireEvent.click(screen.getByRole("button", { name: /email me a code/i }));
    await waitFor(() => expect(screen.getByPlaceholderText(/digit code/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(onBack).toHaveBeenCalled();
  });
});
