import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SlackService } from "nestjs-slack";
import { AligoAlertStateRepository } from "./aligo-alert-state.repository";
import { AligoBalanceAlertService } from "./aligo-balance-alert.service";
import { AlimtalkService } from "./alimtalk.service";

const NOW = new Date("2026-11-15T03:00:00Z");

describe("AligoBalanceAlertService", () => {
  const alimtalk = { fetchBalance: jest.fn() };
  const state = { clear: jest.fn(), claimAlert: jest.fn() };
  const slack = { sendText: jest.fn() };
  const env: Record<string, string | undefined> = {};
  const service = new AligoBalanceAlertService(
    alimtalk as unknown as AlimtalkService,
    state as unknown as AligoAlertStateRepository,
    { get: (key: string) => env[key] } as unknown as ConfigService,
    slack as unknown as SlackService,
  );
  let spies: jest.SpyInstance[];

  beforeEach(() => {
    jest.resetAllMocks();
    for (const key of Object.keys(env)) delete env[key];
    env.ALIGO_LOW_BALANCE_THRESHOLD = "100";
    slack.sendText.mockResolvedValue(undefined);
    spies = [
      jest.spyOn(Logger.prototype, "warn").mockImplementation(),
      jest.spyOn(Logger.prototype, "error").mockImplementation(),
    ];
  });
  afterEach(() => spies.forEach((spy) => spy.mockRestore()));

  it("reads the threshold and treats a blank or invalid value as off", () => {
    expect(service.getThreshold()).toBe(100);
    env.ALIGO_LOW_BALANCE_THRESHOLD = " ";
    expect(service.getThreshold()).toBeNull();
    env.ALIGO_LOW_BALANCE_THRESHOLD = "abc";
    expect(service.getThreshold()).toBeNull();
    delete env.ALIGO_LOW_BALANCE_THRESHOLD;
    expect(service.getThreshold()).toBeNull();
  });

  it("does nothing when the threshold is not set", async () => {
    delete env.ALIGO_LOW_BALANCE_THRESHOLD;

    expect(await service.check(NOW)).toBe("skipped");
    expect(alimtalk.fetchBalance).not.toHaveBeenCalled();
  });

  it("does nothing when aligo is not configured", async () => {
    alimtalk.fetchBalance.mockResolvedValue({ status: "not_configured" });

    expect(await service.check(NOW)).toBe("skipped");
    expect(state.claimAlert).not.toHaveBeenCalled();
  });

  it("does not treat a failed lookup as low balance", async () => {
    alimtalk.fetchBalance.mockResolvedValue({ status: "error", error: "x" });

    expect(await service.check(NOW)).toBe("error");
    expect(state.claimAlert).not.toHaveBeenCalled();
    expect(state.clear).not.toHaveBeenCalled();
    expect(slack.sendText).not.toHaveBeenCalled();
  });

  it("returns error when the response has nothing to compare", async () => {
    alimtalk.fetchBalance.mockResolvedValue({
      status: "ok",
      amount: null,
      counts: { sms_cnt: 1 },
    });

    expect(await service.check(NOW)).toBe("error");
  });

  it("clears the state when the balance is above the threshold", async () => {
    alimtalk.fetchBalance.mockResolvedValue({
      status: "ok",
      amount: 1,
      counts: { alt_cnt: 101 },
    });

    expect(await service.check(NOW)).toBe("ok");
    expect(state.clear).toHaveBeenCalled();
    expect(state.claimAlert).not.toHaveBeenCalled();
  });

  it("compares the amount when there is no alimtalk count", async () => {
    alimtalk.fetchBalance.mockResolvedValue({
      status: "ok",
      amount: 500,
      counts: {},
    });

    expect(await service.check(NOW)).toBe("ok");
  });

  it("alerts Slack once when the balance is at or below the threshold", async () => {
    alimtalk.fetchBalance.mockResolvedValue({
      status: "ok",
      amount: 900,
      counts: { alt_cnt: 100 },
    });
    state.claimAlert.mockResolvedValue(true);

    expect(await service.check(NOW)).toBe("alerted");

    expect(state.claimAlert).toHaveBeenCalledWith(
      NOW,
      new Date("2026-11-14T03:00:00Z"),
    );
    expect(slack.sendText).toHaveBeenCalledTimes(1);
    expect(slack.sendText.mock.calls[0][0]).toContain("[ALIGO LOW BALANCE]");
    expect(slack.sendText.mock.calls[0][0]).toContain("alt_cnt 100");
  });

  it("does not alert again within 24 hours", async () => {
    alimtalk.fetchBalance.mockResolvedValue({
      status: "ok",
      amount: 0,
      counts: { alt_cnt: 5 },
    });
    state.claimAlert.mockResolvedValue(false);

    expect(await service.check(NOW)).toBe("already_alerted");
    expect(slack.sendText).not.toHaveBeenCalled();
  });

  it("survives a Slack failure", async () => {
    alimtalk.fetchBalance.mockResolvedValue({
      status: "ok",
      amount: 0,
      counts: { alt_cnt: 5 },
    });
    state.claimAlert.mockResolvedValue(true);
    slack.sendText.mockRejectedValue(new Error("slack down"));

    await expect(service.check(NOW)).resolves.toBe("alerted");
  });
});
