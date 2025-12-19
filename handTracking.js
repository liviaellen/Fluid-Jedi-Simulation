/**
 * HandTrackingManager
 *
 * Integrates MediaPipe hand tracking with the fluid simulation.
 * Tracks both hands independently and maps them to the pointers array.
 */
class HandTrackingManager {
    constructor(canvas, pointers) {
        this.canvas = canvas;
        this.pointers = pointers;
        this.hands = null;
        this.camera = null;
        this.isInitialized = false;

        // Track previous positions for velocity calculation
        // Index 0 = left hand, Index 1 = right hand
        this.prevPositions = [null, null];

        // Smoothed positions to reduce jitter
        this.smoothedPositions = [null, null];

        // Smoothing factor (0-1, higher = more responsive, lower = smoother)
        this.smoothingAlpha = 0.4;

        // Video element reference
        this.videoElement = null;
    }

    /**
     * Initialize MediaPipe Hands and camera
     */
    async initialize() {
        try {
            // Get video element
            this.videoElement = document.querySelector('.input_video');

            if (!this.videoElement) {
                throw new Error('Video element not found');
            }

            // Check if MediaPipe Hands is available
            if (typeof Hands === 'undefined') {
                throw new Error('MediaPipe Hands library not loaded');
            }

            // Initialize MediaPipe Hands
            this.hands = new Hands({
                locateFile: (file) => {
                    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`;
                }
            });

            // Configure hand tracking options
            this.hands.setOptions({
                maxNumHands: 2,              // Track both hands
                modelComplexity: 0,          // 0=lite (faster), 1=full (more accurate)
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            // Set up results callback
            this.hands.onResults((results) => this.onResults(results));

            // Initialize camera
            if (typeof Camera === 'undefined') {
                throw new Error('MediaPipe Camera library not loaded');
            }

            this.camera = new Camera(this.videoElement, {
                onFrame: async () => {
                    if (this.hands) {
                        await this.hands.send({ image: this.videoElement });
                    }
                },
                width: 640,
                height: 480
            });

            // Start camera
            await this.camera.start();

            this.isInitialized = true;
            console.log('Hand tracking initialized successfully');

        } catch (error) {
            console.error('Hand tracking initialization failed:', error);
            this.isInitialized = false;
            throw error;
        }
    }

    /**
     * Process hand tracking results from MediaPipe
     */
    onResults(results) {
        if (!results.multiHandLandmarks || !results.multiHandedness) {
            // No hands detected - mark all hand pointers as up
            if (this.pointers[0]) this.pointers[0].down = false;
            if (this.pointers[1]) this.pointers[1].down = false;
            return;
        }

        // Track which hands are currently detected
        const detectedHands = { left: false, right: false };

        // Process each detected hand
        results.multiHandLandmarks.forEach((landmarks, index) => {
            const handedness = results.multiHandedness[index];
            const isLeftHand = handedness.label === 'Left';

            // Map to pointer index: 0 for left, 1 for right
            const pointerIndex = isLeftHand ? 0 : 1;

            // Mark this hand as detected
            detectedHands[isLeftHand ? 'left' : 'right'] = true;

            // Ensure pointer exists
            if (!this.pointers[pointerIndex]) {
                this.pointers[pointerIndex] = new pointerPrototype();
            }

            // Update pointer from hand landmarks
            this.updatePointerFromHand(this.pointers[pointerIndex], landmarks, pointerIndex);
        });

        // Mark undetected hands as up
        if (!detectedHands.left && this.pointers[0]) {
            this.pointers[0].down = false;
        }
        if (!detectedHands.right && this.pointers[1]) {
            this.pointers[1].down = false;
        }
    }

    /**
     * Update a pointer from hand landmark data
     */
    updatePointerFromHand(pointer, landmarks, handIndex) {
        // Use index finger tip (landmark 8) for position
        const indexFingerTip = landmarks[8];

        if (!indexFingerTip) return;

        // Extract raw position (MediaPipe gives 0-1 normalized coords)
        let rawX = indexFingerTip.x;
        let rawY = indexFingerTip.y;

        // Apply mirror flip for natural interaction
        // Without this, moving hand right would move cursor left
        rawX = 1.0 - rawX;

        // Apply smoothing to reduce jitter
        if (this.smoothedPositions[handIndex] === null) {
            // First detection - initialize smoothed position
            this.smoothedPositions[handIndex] = { x: rawX, y: rawY };
        } else {
            // Exponential moving average
            const alpha = this.smoothingAlpha;
            this.smoothedPositions[handIndex].x = alpha * rawX + (1 - alpha) * this.smoothedPositions[handIndex].x;
            this.smoothedPositions[handIndex].y = alpha * rawY + (1 - alpha) * this.smoothedPositions[handIndex].y;
        }

        const smoothedX = this.smoothedPositions[handIndex].x;
        const smoothedY = this.smoothedPositions[handIndex].y;

        // Calculate delta (velocity) from previous frame
        let deltaX = 0;
        let deltaY = 0;

        if (this.prevPositions[handIndex] !== null && pointer.down) {
            // Calculate raw delta
            deltaX = smoothedX - this.prevPositions[handIndex].x;
            deltaY = smoothedY - this.prevPositions[handIndex].y;

            // Apply aspect ratio correction (reuse existing functions from script.js)
            if (typeof correctDeltaX === 'function') {
                deltaX = correctDeltaX(deltaX);
            }
            if (typeof correctDeltaY === 'function') {
                deltaY = correctDeltaY(deltaY);
            }

            // Check if movement is significant enough
            const movementThreshold = 0.001;
            if (Math.abs(deltaX) > movementThreshold || Math.abs(deltaY) > movementThreshold) {
                pointer.moved = true;
            }
        }

        // Update pointer data
        pointer.prevTexcoordX = pointer.texcoordX;
        pointer.prevTexcoordY = pointer.texcoordY;
        pointer.texcoordX = smoothedX;
        pointer.texcoordY = smoothedY;
        pointer.deltaX = deltaX;
        pointer.deltaY = deltaY;

        // Mark pointer as down (hand is detected)
        if (!pointer.down) {
            pointer.down = true;
            // Use red and blue colors for pixelated aesthetic
            pointer.color = handIndex === 0
                ? [0, 0.5, 1.0]     // Bright blue for left hand
                : [1.0, 0, 0.25];   // Bright red for right hand
        }

        // Store current position for next frame's delta calculation
        this.prevPositions[handIndex] = { x: smoothedX, y: smoothedY };
    }

    /**
     * Pause hand tracking (e.g., when page is hidden)
     */
    pause() {
        if (this.camera) {
            this.camera.stop();
        }
    }

    /**
     * Resume hand tracking
     */
    async resume() {
        if (this.camera) {
            await this.camera.start();
        }
    }

    /**
     * Clean up resources
     */
    shutdown() {
        if (this.camera) {
            this.camera.stop();
        }
        if (this.hands) {
            this.hands.close();
        }
        this.isInitialized = false;
    }
}

// Pause/resume tracking when page visibility changes
document.addEventListener('visibilitychange', () => {
    if (window.handTracker && window.handTracker.isInitialized) {
        if (document.hidden) {
            window.handTracker.pause();
        } else {
            window.handTracker.resume();
        }
    }
});
