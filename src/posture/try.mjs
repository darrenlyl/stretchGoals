import { makeFakeFrame } from "./fake-frames.js";
console.log("upright ear:", makeFakeFrame().landmarks[7]);
console.log("dropped ear:", makeFakeFrame({ neckDrop: 0.2 }).landmarks[7]);