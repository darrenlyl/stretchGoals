const px = (frame, i) => {
  const p = frame.landmarks[i];
  if (p.visibility < 0.5) return null; 
  return { x: p.x * frame.width, y: p.y * frame.height };
};

export function computeMetrics(frame){
    if (!frame.landmarks) return null;

    const leftEar = px(frame, 7);
    const rightEar = px(frame, 8);
    const leftShoulder = px(frame, 11)
    const rightShoulder = px(frame, 12)

    if(!leftShoulder || !rightShoulder) return null;

    let headLeft = leftEar;
    let headRight = rightEar;
    if(!headLeft || !headRight){
        headLeft = px(frame, 2)
        headRight = px(frame, 5) 
    };

    if (!headLeft || !headRight) return null;

    const E = { x: (headLeft.x + headRight.x) / 2, y: (headLeft.y + headRight.y)/2}
    const S = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y)/2}
    const W = Math.hypot(rightShoulder.x - leftShoulder.x, leftShoulder.y - rightShoulder.y);    
    const neckRatio = (S.y - E.y) / W; 

    const headWidth = Math.hypot(headLeft.x - headRight.x, headLeft.y - headRight.y);
    const headRatio = headWidth / W;
    const shoulderWidth = W / frame.width;
    const shoulderY = S.y / frame.height;

    const DEG = 180 / Math.PI;
    const headTiltDeg = Math.atan2(headLeft.y - headRight.y, headLeft.x - headRight.x) * DEG;
    const shoulderTiltDeg = Math.atan2(leftShoulder.y - rightShoulder.y, leftShoulder.x - rightShoulder.x) * DEG

    return { neckRatio, headRatio, headTiltDeg, shoulderTiltDeg, shoulderWidth, shoulderY };}