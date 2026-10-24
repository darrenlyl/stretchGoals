const width = 640;
const height = 480; 

const UPRIGHT = {
    0: [320, 215],
    2: [340, 200], 
    5: [300, 200],
    7: [360, 216],
    8: [280, 216],
    11: [416, 384],
    12: [224, 384],
};

const HEAD = [0, 2, 5, 7, 8];
const NECK_LENGTH = 384 - 216;

export function makeFakeFrame({neckDrop = 0} = {}){
    const landmarks = Array.from({length: 33}, () => ({x: 0.5, y: 0.95, z: 0, visibility: 0.1}));

    for (const index in UPRIGHT){
        let [px, py] = UPRIGHT[index];

        if (HEAD.includes(Number(index))){
            py += neckDrop * NECK_LENGTH;
        }

        landmarks[index] = {x: px / width, y: py / height, z: 0, visibility: 0.99};
    }
    
    return {timestamp: 0, width, height, landmarks};
}

