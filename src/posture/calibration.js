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
