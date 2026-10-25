export function ramp(dev, ok, max){
    const s = (dev - ok) / (max - ok);
    return Math.min(1, Math.max(0, s))
};

export function computeSeverities(m, baseline, k = 1){
    const neckDrop = (baseline.neckRatio - m.neckRatio) / baseline.neckRatio;
    const headGrow = (m.headRatio - baseline.headRatio) / baseline.headRatio;
    const forwardHead = Math.max(ramp(neckDrop / k, 0.06, 0.26), ramp(headGrow / k, 0.04, 0.17)); 
    const shoulderDrop = m.shoulderY - baseline.shoulderY;
    const slouching = ramp(shoulderDrop / k, 0.02, 0.09);
    const headTilt = ramp(Math.abs(m.headTiltDeg - baseline.headTiltDeg) / k, 4, 17);
    const unevenShoulders = ramp(Math.abs(m.shoulderTiltDeg - baseline.shoulderTiltDeg) / k, 2.5, 11);
    const tooClose = ramp((m.shoulderWidth / baseline.shoulderWidth - 1) / k, 0.1, 0.43);

    // Leaning in toward the screen also makes the neck look shorter and the shoulders sit lower,
    // which fakes forward head and slouching. When someone is too close, trust "too close" and
    // turn those two down: trust is 1 at normal distance, 0 when fully too close.
    const trust = 1 - tooClose;

    return {
        forward_head: forwardHead * trust,
        slouching: slouching * trust,
        head_tilt: headTilt,
        uneven_shoulders: unevenShoulders,
        too_close: tooClose,
    };
};

export function computeScore(sev){
    const penalty = 
    0.6 * sev.forward_head + 
    0.6 * sev.slouching + 
    0.35 * sev.head_tilt + 
    0.35 * sev.uneven_shoulders + 
    0.3 * sev.too_close;
    return Math.round( 100 * (1 - Math.min(1, penalty)));
};