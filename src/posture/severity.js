export function ramp(dev, ok, max){
    const s = (dev - ok) / (max - ok);
    return Math.min(1, Math.max(0, s))
};

export function computeSeverities(m, baseline){
    const neckDrop = (baseline.neckRatio - m.neckRatio) / baseline.neckRatio;
    const headGrow = (m.headRatio - baseline.headRatio) / baseline.headRatio;
    const forwardHead = Math.max(ramp(neckDrop, 0.06, 0.26), ramp(headGrow, 0.04, 0.17)); 
    const shoulderDrop = m.shoulderY - baseline.shoulderY;
    const slouching = ramp(shoulderDrop, 0.02, 0.09);
    const headTilt = ramp(Math.abs(m.headTiltDeg - baseline.headTiltDeg), 4, 17);
    const unevenShoulders = ramp(Math.abs(m.shoulderTiltDeg - baseline.shoulderTiltDeg), 2.5, 11);
    const tooClose = ramp((m.shoulderWidth / baseline.shoulderWidth - 1), 0.1, 0.43);

    return { 
        forward_head: forwardHead,
        slouching: slouching,
        head_tilt: headTilt,
        uneven_shoulders: unevenShoulders,
        too_close: tooClose,
    };
};