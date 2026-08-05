/**
 * Convert host viewport insets into offsets local to the playable frame.
 *
 * #app-frame is letterboxed (centered, capped by --game-w), so on any viewport
 * wider than the frame the host's raw insets overpad it: a notch that falls
 * entirely inside the letterbox gutter is not over the frame at all. The
 * offsets are SIGNED — negative means the frame edge already sits beyond the
 * safe boundary — so a consumer that pads must clamp at zero, while a consumer
 * that reaches outward (full-bleed HUD art) can use the sign.
 */
export interface EdgeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface FrameBounds {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
}

export interface ViewportSize {
    width: number;
    height: number;
}

function finite(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

export function safeAreaOffsetsForFrame(
    safeArea: Readonly<EdgeInsets>,
    frame: Readonly<FrameBounds>,
    viewport: Readonly<ViewportSize>,
): EdgeInsets {
    const safeRight = viewport.width - Math.max(0, safeArea.right);
    const safeBottom = viewport.height - Math.max(0, safeArea.bottom);
    return {
        top: finite(Math.max(0, safeArea.top) - frame.top),
        right: finite(frame.right - safeRight),
        bottom: finite(frame.bottom - safeBottom),
        left: finite(Math.max(0, safeArea.left) - frame.left),
    };
}
