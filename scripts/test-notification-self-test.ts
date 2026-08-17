#!/usr/bin/env node
import assert from "node:assert/strict";
import {
    NOTIFICATION_SELF_TEST_DELAY_SECONDS,
    scheduleNotificationSelfTest,
    type NotificationSelfTestMessage,
} from "../src/systems/notificationSelfTest.ts";

const calls: string[] = [];
let submitted: NotificationSelfTestMessage | null = null;
const result = await scheduleNotificationSelfTest(
    {
        cancel: async (notificationId) => {
            calls.push(`cancel:${notificationId}`);
        },
        submit: async (message) => {
            calls.push(`submit:${message.notificationId}`);
            submitted = message;
            return { results: [{ channel: "local", status: "scheduled" }] };
        },
    },
    {
        title: "Test alert",
        body: "Close RUN now.",
        notificationId: "game-settings-alert-test",
        payload: { screen: "settings" },
    },
);

assert.equal(result, "scheduled");
assert.deepEqual(calls, ["cancel:game-settings-alert-test", "submit:game-settings-alert-test"]);
assert.equal(submitted?.delaySeconds, NOTIFICATION_SELF_TEST_DELAY_SECONDS);
assert.deepEqual(submitted?.channels, ["local"]);
assert.equal(submitted?.collapseKey, "game-settings-alert-test");

const rejected = await scheduleNotificationSelfTest(
    {
        cancel: async () => undefined,
        submit: async () => ({ results: [{ channel: "local", status: "failed" }] }),
    },
    {
        title: "Test alert",
        body: "Close RUN now.",
        notificationId: "game-settings-alert-test",
        payload: {},
    },
);
assert.equal(rejected, "failed");

console.log("notification self-test: cancel-first local alert schedules after 5 seconds");
