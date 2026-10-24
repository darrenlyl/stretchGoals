// stretchGoals shared contracts (owner: Darren).
// Every track codes against these shapes and names. To change one, post in the
// group chat first (TEAM_GUIDE.md, section 3.6). Plain JS, no DOM, safe in Node.

// ---------------------------------------------------------------------------
// 3.1 PoseFrame: Track 1 (camera) -> Track 2 (posture)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Landmark
 * @property {number} x           0–1, fraction of video width (0 = left edge of the RAW, un-mirrored image)
 * @property {number} y           0–1, fraction of video height (0 = top)
 * @property {number} z           rough depth estimate. Noisy, so avoid it
 * @property {number} visibility  0–1, how confident MediaPipe is that this point is visible
 */

/**
 * @typedef {Object} PoseFrame
 * @property {number} timestamp            ms, from performance.now()
 * @property {number} width                video width in pixels (video.videoWidth)
 * @property {number} height               video height in pixels (video.videoHeight)
 * @property {Landmark[] | null} landmarks 33 points in MediaPipe order, or null if nobody is in frame
 */

/** MediaPipe landmark indices we use. "Left" means the PERSON's left. */
export const LANDMARKS = Object.freeze({
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
});

/** Skip a landmark when its visibility is below this. */
export const MIN_VISIBILITY = 0.5;

// ---------------------------------------------------------------------------
// 3.2 Issue IDs (everyone uses these exact strings)
// ---------------------------------------------------------------------------

export const ISSUES = Object.freeze({
  forward_head:     { medical: "Forward head posture",         layman: "Neck too far forward" },
  slouching:        { medical: "Postural kyphosis",            layman: "Hunched over" },
  head_tilt:        { medical: "Lateral cervical flexion",     layman: "Head tilted to one side" },
  uneven_shoulders: { medical: "Shoulder elevation asymmetry", layman: "One shoulder higher than the other" },
  too_close:        { medical: null,                           layman: "Too close to the screen" },
});

/** @typedef {keyof typeof ISSUES} IssueId */

/** The issue IDs as an array, handy for loops. */
export const ISSUE_IDS = Object.freeze(Object.keys(ISSUES));

// ---------------------------------------------------------------------------
// 3.3 PostureState: Track 2 (posture) -> everyone
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Issue
 * @property {IssueId} id
 * @property {string|null} medical
 * @property {string} layman
 * @property {number} severity     0–1 (0 = fine, 1 = as bad as we measure)
 * @property {number} durationSec  how long this issue has been going on
 * @property {boolean} sustained   true once it has lasted past the alert threshold (~5 s). Only alert on sustained issues!
 */

/**
 * @typedef {Object} PostureMetrics
 * Raw-ish numbers for debugging and for Ossie. Every field can be null when we
 * can't measure it (nobody in frame, shoulders hidden, not calibrated yet).
 *
 * @property {Record<IssueId, number>} severity
 *   0–1 for EVERY issue, every frame, even ones that are not in `issues` yet.
 *   Ossie: drive joints from these so he moves smoothly instead of snapping
 *   when an issue switches on.
 * @property {number}      headForward      0–1, same as severity.forward_head
 * @property {number}      slouch           0–1, same as severity.slouching
 * @property {number|null} headTiltDeg      signed degrees vs the calibrated pose. + = head tipped toward the person's LEFT shoulder
 * @property {number|null} shoulderTiltDeg  signed degrees vs the calibrated pose. + = person's LEFT shoulder lower
 * @property {number|null} closeness        shoulder width / calibrated shoulder width (1 = same distance, >1 = closer)
 * @property {number|null} shoulderDrop     how far the shoulders sank since calibration, as a fraction of frame height
 * @property {"ears"|"eyes"|null} headSource which points the head measurements came from (eyes when hair hides the ears)
 * @property {Object}      raw              smoothed absolute values: neckRatio, headRatio, headTiltDeg, shoulderTiltDeg, shoulderWidth, shoulderY
 */

/**
 * @typedef {Object} PostureState
 * @property {number}  timestamp
 * @property {boolean} present              someone is in frame
 * @property {boolean} calibrated           a baseline exists
 * @property {boolean} calibrating          calibration is running right now
 * @property {number}  calibrationProgress  0–1 while calibrating
 * @property {number|null} score            0–100 (100 = matches your calibrated posture); null if not present or not calibrated
 * @property {Issue[]} issues               issues detected right now (may be empty), worst first
 * @property {PostureMetrics} metrics       raw numbers for debugging and for Ossie
 */

/**
 * Result of startCalibration().
 * @typedef {Object} CalibrationResult
 * @property {boolean} ok
 * @property {"no_person"|"low_visibility"|"moved"|"no_frames"|"cancelled"} [reason]  short code, set when ok is false
 * @property {string}  [message]  a friendly sentence the UI can show as-is
 */

// ---------------------------------------------------------------------------
// 3.4 Module APIs (for reference; each owner implements their own)
// ---------------------------------------------------------------------------
//   src/camera/index.js     Jordan  startCamera(videoEl, canvasEl) -> Promise, stopCamera(), onPoseFrame(cb) -> unsubscribe, setOverlayVisible(bool)
//   src/posture/index.js    Darren  analyze(frame) -> PostureState, startCalibration(ms = 3000) -> Promise<CalibrationResult>, resetCalibration(), setSensitivity(0–1)
//   src/voice/index.js      Joseph  voiceCoach.update(state), voiceCoach.setMuted(bool), speakLine(lineId) -> Promise
//   src/stretches/index.js  Joseph  STRETCHES, stretchesFor(issueId) -> Stretch[], startStretch(id), stopStretch(), onStretchEvent(cb) -> unsubscribe
//   src/ossie/index.js      Shawn   ossie.mount(el), ossie.update(state), ossie.playStretch(stretchId), ossie.celebrate()
//   src/debug/fake-posture.js Shawn mountFakePosturePanel(el, onState)
//   src/ui/index.js         Claude  ui.mount(el), ui.update(state)

/**
 * Stretch events from src/stretches.
 * @typedef {Object} StretchEvent
 * @property {"start"|"step"|"tick"|"end"} type
 * @property {string} stretchId
 * @property {number} stepIndex
 * @property {number} secondsLeft
 */

// ---------------------------------------------------------------------------
// 3.5 window.api (Shawn builds it in preload.js)
// ---------------------------------------------------------------------------
//   window.api.tts(text)            -> Promise<Uint8Array> of mp3 bytes (key stays in the main process)
//   window.api.notify(title, body)  native desktop notification
//   window.api.setTrayScore(score)  number, or null to show "–"
//   window.api.onTrayCommand(cb)    cb("pause" | "resume" | "recalibrate" | "show")

/** A PostureState for "nothing to report yet". Handy as a starting value. */
export function emptyPostureState(timestamp = 0) {
  return {
    timestamp,
    present: false,
    calibrated: false,
    calibrating: false,
    calibrationProgress: 0,
    score: null,
    issues: [],
    metrics: {
      severity: Object.fromEntries(ISSUE_IDS.map((id) => [id, 0])),
      headForward: 0,
      slouch: 0,
      headTiltDeg: null,
      shoulderTiltDeg: null,
      closeness: null,
      shoulderDrop: null,
      headSource: null,
      raw: {},
    },
  };
}
