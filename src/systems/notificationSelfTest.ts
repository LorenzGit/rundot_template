export const NOTIFICATION_SELF_TEST_DELAY_SECONDS = 5;

export type NotificationSelfTestResult = "scheduled" | "failed";

export interface NotificationSelfTestMessage {
    channels: ["local"];
    title: string;
    body: string;
    delaySeconds: number;
    notificationId: string;
    collapseKey: string;
    payload: Record<string, unknown>;
}

interface NotificationSelfTestPort {
    cancel(notificationId: string): Promise<unknown>;
    submit(message: NotificationSelfTestMessage): Promise<{
        results: Array<{ channel: string; status: string }>;
    }>;
}

/**
 * Cancel-first, five-second local alert probe shared by Settings and tests.
 * This proves only this device's RUN notification permission and scheduler.
 */
export async function scheduleNotificationSelfTest(
    port: NotificationSelfTestPort,
    message: Omit<NotificationSelfTestMessage, "channels" | "delaySeconds" | "collapseKey">,
): Promise<NotificationSelfTestResult> {
    await port.cancel(message.notificationId);
    const result = await port.submit({
        ...message,
        channels: ["local"],
        delaySeconds: NOTIFICATION_SELF_TEST_DELAY_SECONDS,
        collapseKey: message.notificationId,
    });
    return result.results.some((channel) => channel.channel === "local" && channel.status === "scheduled")
        ? "scheduled"
        : "failed";
}
