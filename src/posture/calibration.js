import { computeMetrics } from "./metrics.js";

export function median(values){
    const sorted = [...values].sort((a,b) => a-b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }

    return sorted[mid];
};

const KEYS = ["neckRatio", "headRatio", "headTiltDeg", "shoulderTiltDeg", "shoulderWidth", "shoulderY"];

export function computeBaseline(samples){
    const baseline = {};
    for (const key of KEYS){
        const values = samples.map((s) => s[key]);
        baseline[key] = median(values);
    };

    return baseline; 
};

export function calibrate(frames){
    if(frames.length < 5){
        return { ok: false, reason: "no_frames", message: "The camera isn't sending anything yet. Check if it's on, then try again."};
    }

    const withPerson = frames.filter((f) => f.landmarks);
    if (withPerson.length / frames.length < 0.6){
        return { ok: false, reason: "no_person", message: "We could not see you. Sit in front of the camera and try again."};
    }

    const samples = withPerson.map(computeMetrics).filter((m) => m !== null);
    if (samples.length / frames.length < 0.6){
        return {ok: false, reason: "low_visibility", message: "We can't see your head and shoulders clearly. Sit back a little, face a light, and try again."};
    }

    return {ok: true, baseline: computeBaseline(samples)};
}