// Simplified head movement control system - uses default camera only
class HeadControl {
    constructor(tetrisGame, onCalibrationComplete, onFaceStatusChange) {
        this.onFaceStatusChange = onFaceStatusChange;
        this.isFaceDetected = false;
        this.lastFaceDetectionStatus = false;
        this.calibrationCompletedNotified = false;
        this.tetrisGame = tetrisGame;
        this.onCalibrationComplete = onCalibrationComplete;
        this.faceMesh = null;
        this.camera = null;
        this.isActive = false;
        
        // Control parameters (adjustable)
        this.headTiltThreshold = 0.15; // Left/right tilt threshold (based on eye line angle)
        this.mouthOpenThreshold = 0.02; // Mouth open detection threshold
        
        // Debounce parameters
        this.lastAction = '';
        this.actionCooldown = 300;
        this.lastActionTime = 0;
        
        // Left/right movement state tracking
        this.currentTiltState = 'center';
        this.lastTiltState = 'center';
        
        // Baseline position
        this.baselineNose = null;
        this.baselineMouth = null;
        this.calibrationFrames = 0;
        this.maxCalibrationFrames = 30;
        
        // Mouth state tracking
        this.mouthWasOpen = false;
        
        // Continuous movement detection
        this.continuousMoveStartTime = 0;
        this.continuousMoveThreshold = 1000;
        this.continuousMoveInterval = 150;
        this.lastContinuousMoveTime = 0;
        this.isInContinuousMode = false;
        this.isInFastMoveMode = false;
        this.fastMoveStartTime = 0;
        
        // Fast movement detection (large tilt)
        this.fastMoveThreshold = 0.22;
        this.fastMoveInterval = 90;
        
        // Nod acceleration drop detection (modified to nod action detection)
        this.nodStartTime = 0;
        this.nodThreshold = 0.03; // Nod detection threshold
        this.isNodding = false;
        this.lastNodTime = 0;
        this.nodCooldown = 300; // Nod cooldown time, prevent repeated detection
        
        // Nod state tracking
        this.nosePositionHistory = [];
        this.maxNoseHistory = 10;
        this.dynamicBaseline = null;
        this.baselineUpdateInterval = 30;
        this.frameCount = 0;
        this.lastNoseY = 0;
        this.nodDirection = 'none'; // 'down', 'up', 'none'
        this.nodPhase = 'waiting'; // 'waiting', 'going_down', 'going_up', 'completed'
        
        // Status display control
        this.showDetailedStatus = true; // Can be set to false to show mini status
        
        // Calibration complete prompt control
        this.calibrationCompleteTime = 0;
        this.showCalibrationComplete = false;
        
        this.initMediaPipe();
    }
    
    async initMediaPipe() {
        try {
            this.faceMesh = new FaceMesh({
                locateFile: (file) => {
                    return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
                }
            });
            
            this.faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            
            this.faceMesh.onResults(this.onResults.bind(this));
            
            console.log('MediaPipe Face Mesh initialized successfully');
        } catch (error) {
            console.error('MediaPipe initialization failed:', error);
        }
    }
    
    async startCamera() {
        try {
            const video = document.getElementById('input_video');
            const canvas = document.getElementById('output_canvas');
            
            // Reset calibration state
            this.resetCalibration();
            
            // Use default camera, simple configuration
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: 320,
                    height: 240
                }
            });
            
            video.srcObject = stream;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            
            // Wait for video to load
            await new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    video.play().then(resolve);
                };
            });
            
            // Create MediaPipe Camera
            this.camera = new Camera(video, {
                onFrame: async () => {
                    try {
                        if (this.faceMesh && video.readyState === 4) {
                            await this.faceMesh.send({image: video});
                        }
                    } catch (error) {
                        console.error('Frame processing error:', error);
                    }
                },
                width: 320,
                height: 240
            });
            
            await this.camera.start();
            this.isActive = true;
            console.log('Default camera started successfully');
            
            // Display initial status
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.fillStyle = '#4ecdc4';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const line1 = 'Camera started';
            const line2 = 'Waiting for face detection...';
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;

            ctx.fillText(line1, centerX, centerY - 15);
            ctx.fillText(line2, centerX, centerY + 15);
            
        } catch (error) {
            console.error('Camera startup failed:', error);
            let errorMessage = 'Cannot access camera';
            
            if (error.name === 'NotAllowedError') {
                errorMessage = 'Camera permission denied, please check browser settings';
            } else if (error.name === 'NotReadableError') {
                errorMessage = 'Camera is in use by another application';
            }
            
            alert(errorMessage);
            throw error;
        }
    }
    
    onResults(results) {
        try {
            const canvas = document.getElementById('output_canvas');
            const ctx = canvas.getContext('2d');
            
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw video frame
            if (results.image) {
                ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
            }
            
            if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                this.isFaceDetected = true; // Face detected
                const landmarks = results.multiFaceLandmarks[0];
                
                // Draw face landmarks
                this.drawLandmarks(ctx, landmarks);
                
                // Calibrate baseline position
                if (this.calibrationFrames < this.maxCalibrationFrames) {
                    this.calibrateBaseline(landmarks);
                    this.calibrationFrames++;
                    
                    // Display calibration progress
                    this.drawCalibrationProgress(ctx);
                    return;
                }
                
                // Display calibration complete status (disappears after 5 seconds)
                const now = Date.now();
                if (this.showCalibrationComplete && (now - this.calibrationCompleteTime < 5000)) {
                    this.drawCalibrationComplete(ctx);
                } else if (this.showCalibrationComplete && (now - this.calibrationCompleteTime >= 5000)) {
                    this.showCalibrationComplete = false;
                }
                
                // Detect head movements
                this.detectHeadMovements(landmarks);
                
                // Display control status (detail level controlled by showDetailedStatus)
                if (this.showDetailedStatus !== false) {
                    this.drawControlStatus(ctx, landmarks);
                } else {
                    this.drawMiniStatus(ctx, landmarks);
                }
            } else {
                // No face detected
                // Draw "Please face the camera" message
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                ctx.fillStyle = '#ff6b6b'; // Red color for warning
                ctx.font = 'bold 18px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                ctx.fillText('Please face the camera', canvas.width / 2, canvas.height / 2);
            }
            // Check if status changed and notify
            if (this.isFaceDetected !== this.lastFaceDetectionStatus) {
                this.lastFaceDetectionStatus = this.isFaceDetected;
                if (this.onFaceStatusChange) {
                    this.onFaceStatusChange(this.isFaceDetected);
                }
            }
        } catch (error) {
            console.error('onResults processing error:', error);
        }
    }
    
    calibrateBaseline(landmarks) {
        try {
            const nose = landmarks[1];
            const upperLip = landmarks[13] || landmarks[12];
            const lowerLip = landmarks[14] || landmarks[15];
            
            if (!nose || !upperLip || !lowerLip) {
                return;
            }
            
            if (!this.baselineNose) {
                this.baselineNose = {x: 0, y: 0, z: 0};
                this.baselineMouth = {distance: 0};
            }
            
            this.baselineNose.x += nose.x;
            this.baselineNose.y += nose.y;
            this.baselineNose.z += nose.z;
            
            const mouthDistance = Math.abs(upperLip.y - lowerLip.y);
            this.baselineMouth.distance += mouthDistance;
            
            if (this.calibrationFrames === this.maxCalibrationFrames - 1) {
                this.baselineNose.x /= this.maxCalibrationFrames;
                this.baselineNose.y /= this.maxCalibrationFrames;
                this.baselineNose.z /= this.maxCalibrationFrames;
                this.baselineMouth.distance /= this.maxCalibrationFrames;
                
                // Record calibration completion time
                this.calibrationCompleteTime = Date.now();
                this.showCalibrationComplete = true;
                
                console.log('Calibration complete!');

                if (this.onCalibrationComplete) {
                    this.onCalibrationComplete();
                    this.calibrationCompletedNotified = true; // Prevent multiple calls
                }
            }
        } catch (error) {
            console.error('Calibration process error:', error);
        }
    }
    
    resetCalibration() {
        this.calibrationFrames = 0;
        this.baselineNose = null;
        this.baselineMouth = null;
        this.mouthWasOpen = false;
        this.currentTiltState = 'center';
        this.lastTiltState = 'center';
        this.continuousMoveStartTime = 0;
        this.isInContinuousMode = false;
        this.isInFastMoveMode = false;
        this.fastMoveStartTime = 0;
        this.nodStartTime = 0;
        this.isNodding = false;
        this.lastNodTime = 0;
        this.lastAction = '';
        this.lastActionTime = 0;
        
        // Reset calibration complete prompt
        this.calibrationCompleteTime = 0;
        this.showCalibrationComplete = false;
        
        // Reset nod detection system
        this.nosePositionHistory = [];
        this.dynamicBaseline = null;
        this.frameCount = 0;
        this.lastNoseY = 0;
        this.nodDirection = 'none';
        this.nodPhase = 'waiting';

        // Reset face detection status
        this.isFaceDetected = false;
        this.lastFaceDetectionStatus = false;
        this.calibrationCompletedNotified = false; // New property
    }
    
    // Simplified head movement detection
    detectHeadMovements(landmarks) {
        if (!this.baselineNose || !this.baselineMouth) {
            return;
        }
        
        const now = Date.now();
        if (now - this.lastActionTime < this.actionCooldown) return;
        
        try {
            const nose = landmarks[1];
            const upperLip = landmarks[13] || landmarks[12];
            const lowerLip = landmarks[14] || landmarks[15];
            
            if (!nose || !upperLip || !lowerLip) {
                return;
            }
            
            // Calculate head tilt
            const tiltX = this.calculateHeadTilt(landmarks);
            const noseY = nose.y;
            
            // Calculate mouth open degree
            const mouthDistance = Math.abs(upperLip.y - lowerLip.y);
            const mouthOpen = mouthDistance - this.baselineMouth.distance;
            const isMouthOpen = mouthOpen > this.mouthOpenThreshold;
            
            let action = '';
            
            // Update current tilt state
            if (tiltX > this.headTiltThreshold) {
                this.currentTiltState = 'right';
            } else if (tiltX < -this.headTiltThreshold) {
                this.currentTiltState = 'left';
            } else {
                this.currentTiltState = 'center';
            }
            
            // Detect mouth open for rotation
            if (isMouthOpen && !this.mouthWasOpen) {
                action = 'rotate';
            }
            // Detect left/right tilt (not disabled during nod, as nod is instantaneous)
            else if (this.currentTiltState !== 'center') {
                const isFastTilt = Math.abs(tiltX) > this.fastMoveThreshold;
                
                if (this.lastTiltState === 'center') {
                    action = this.currentTiltState;
                    this.continuousMoveStartTime = now;
                    this.isInContinuousMode = false;
                    
                    if (isFastTilt) {
                        this.fastMoveStartTime = now;
                        this.isInFastMoveMode = true;
                    } else {
                        this.isInFastMoveMode = false;
                    }
                } else if (this.currentTiltState === this.lastTiltState) {
                    const holdTime = now - this.continuousMoveStartTime;
                    
                    if (isFastTilt && this.isInFastMoveMode) {
                        if (now - this.lastContinuousMoveTime >= this.fastMoveInterval) {
                            action = this.currentTiltState;
                            this.lastContinuousMoveTime = now;
                        }
                    } else if (holdTime >= this.continuousMoveThreshold && !this.isInContinuousMode) {
                        this.isInContinuousMode = true;
                        this.lastContinuousMoveTime = now;
                        action = this.currentTiltState;
                    } else if (this.isInContinuousMode && 
                              now - this.lastContinuousMoveTime >= this.continuousMoveInterval) {
                        action = this.currentTiltState;
                        this.lastContinuousMoveTime = now;
                    }
                    
                    if (isFastTilt && !this.isInFastMoveMode) {
                        this.isInFastMoveMode = true;
                        this.fastMoveStartTime = now;
                    } else if (!isFastTilt && this.isInFastMoveMode) {
                        this.isInFastMoveMode = false;
                    }
                }
            } else {
                if (this.isInContinuousMode || this.isInFastMoveMode) {
                    console.log('Head returned to center, ending move mode');
                }
                this.continuousMoveStartTime = 0;
                this.isInContinuousMode = false;
                this.isInFastMoveMode = false;
                this.fastMoveStartTime = 0;
            }
            
            // Detect nod for accelerated drop
            if (this.tetrisGame.gameRunning) {
                this.checkNodAcceleration(noseY);
            }
            
            this.mouthWasOpen = isMouthOpen;
            this.lastTiltState = this.currentTiltState;
            
            // Execute action
            if (action) {
                if (action === 'rotate' || action !== this.lastAction) {
                    this.executeAction(action);
                    this.lastAction = action;
                    this.lastActionTime = now;
                    
                    setTimeout(() => {
                        this.lastAction = '';
                    }, this.actionCooldown);
                }
            }
        } catch (error) {
            console.error('Action detection error:', error);
        }
    }
    
    // Nod detection (detects full nod action: down then up, or up then down)
    checkNodAcceleration(noseY) {
        const now = Date.now();

        this.updateNosePositionHistory(noseY);

        if (!this.dynamicBaseline) return false;

        // Calculate position relative to baseline
        const relativePosition = noseY - this.dynamicBaseline;
        const nodDownThreshold = this.nodThreshold;
        const nodUpThreshold = -this.nodThreshold; // Upward movement is negative

        const currentDirection = relativePosition > nodDownThreshold ? 'down' :
            relativePosition < nodUpThreshold ? 'up' : 'center';

        // Nod/Head-up state machine
        switch (this.nodPhase) {
            case 'waiting':
                if (currentDirection === 'down') {
                    this.nodPhase = 'going_down';
                    this.nodStartTime = now;
                    console.log('Starting nod - downward phase');
                } else if (currentDirection === 'up') {
                    this.nodPhase = 'going_up';
                    this.nodStartTime = now;
                    console.log('Starting head-up - upward phase');
                }
                break;

            case 'going_down':
                // If returning from downward phase, complete one "down-up" head shake
                if (currentDirection === 'up' || currentDirection === 'center') {
                    if (now - this.nodStartTime > 100) { // Debounce
                        this.nodPhase = 'completed';
                        console.log('Head shake (down-up) completed, triggering drop');
                        this.triggerNodDrop();
                    } else {
                        this.nodPhase = 'waiting'; // Action too fast, reset
                    }
                } else if (now - this.nodStartTime > 1000) {
                    // Timeout reset
                    this.nodPhase = 'waiting';
                }
                break;

            case 'going_up':
                // If returning from upward phase, complete one "up-down" head shake
                if (currentDirection === 'down' || currentDirection === 'center') {
                    if (now - this.nodStartTime > 100) { // Debounce
                        this.nodPhase = 'completed';
                        console.log('Head shake (up-down) completed, triggering drop');
                        this.triggerNodDrop();
                    } else {
                        this.nodPhase = 'waiting'; // Action too fast, reset
                    }
                } else if (now - this.nodStartTime > 1000) {
                    // Timeout reset
                    this.nodPhase = 'waiting';
                }
                break;

            case 'completed':
                // Wait for head to return to center position, prepare for next detection
                if (currentDirection === 'center') {
                    this.nodPhase = 'waiting';
                } else if (now - this.nodStartTime > 2000) {
                    // Timeout force reset
                    this.nodPhase = 'waiting';
                }
                break;
        }

        return false; // No continuous acceleration needed
    }
    
    // Trigger nod drop
    triggerNodDrop() {
        const now = Date.now();

        // Cooldown check, prevent too frequent
        if (now - this.lastNodTime < this.nodCooldown) {
            return;
        }

        this.lastNodTime = now;

        if (this.tetrisGame.gameRunning && this.tetrisGame.currentPiece) {
            console.log('Nod/Head shake triggered, performing 3-cell drop');

            for (let i = 0; i < 3; i++) {
                // Attempt drop
                if (!this.tetrisGame.movePiece(0, 1)) {
                    // If any drop fails, it means the piece has hit bottom
                    console.log(`Drop ${i + 1} cell failed, piece hit bottom and locked immediately`);
                    this.tetrisGame.dropTime = this.tetrisGame.dropInterval; // Force immediate lock
                    break; // Stop attempting further drops
                }
            }
        }
    }
    
    updateNosePositionHistory(noseY) {
        this.nosePositionHistory.push(noseY);
        if (this.nosePositionHistory.length > this.maxNoseHistory) {
            this.nosePositionHistory.shift();
        }
        
        this.frameCount++;
        
        if (this.frameCount % this.baselineUpdateInterval === 0 && this.nosePositionHistory.length >= 10) {
            const sortedHistory = [...this.nosePositionHistory].sort((a, b) => a - b);
            const medianIndex = Math.floor(sortedHistory.length / 2);
            this.dynamicBaseline = sortedHistory[medianIndex];
        }
    }
    
    calculateHeadTilt(landmarks) {
        const leftEye = landmarks[33];
        const rightEye = landmarks[362];
        
        if (!leftEye || !rightEye) {
            const nose = landmarks[1];
            return nose.x - this.baselineNose.x;
        }
        
        const eyeLineAngle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
        return Math.sin(eyeLineAngle);
    }
    
    executeAction(action) {
        if (!this.tetrisGame.gameRunning) return;
        
        // Only disable move operations in accelerated state, allow rotation
        if (this.isAcceleratingDrop && (action === 'left' || action === 'right')) {
            console.log('Move operation disabled in accelerated state:', action);
            return;
        }
        
        switch (action) {
            case 'left':
                this.tetrisGame.movePiece(1, 0);
                break;
            case 'right':
                this.tetrisGame.movePiece(-1, 0);
                break;
            case 'rotate':
                this.tetrisGame.rotatePiece();
                break;
        }
    }
    
    drawLandmarks(ctx, landmarks) {
        const canvasWidth = ctx.canvas.width;
        const canvasHeight = ctx.canvas.height;
        
        // First draw face fill for beautification
        this.drawFaceFill(ctx, landmarks, canvasWidth, canvasHeight);
        
        // Draw beautified face contour
        this.drawBeautifiedFaceContour(ctx, landmarks, canvasWidth, canvasHeight);
        
        // Draw beautified eyes
        this.drawBeautifiedEyes(ctx, landmarks, canvasWidth, canvasHeight);
        
        // Draw beautified mouth
        this.drawBeautifiedMouth(ctx, landmarks, canvasWidth, canvasHeight);
        
        // Draw beautified nose
        this.drawBeautifiedNose(ctx, landmarks, canvasWidth, canvasHeight);
        
        // Draw beautified eyebrows
        this.drawBeautifiedEyebrows(ctx, landmarks, canvasWidth, canvasHeight);
        
        // Add face highlight effect
        this.drawFaceHighlights(ctx, landmarks, canvasWidth, canvasHeight);
    }
    
    // Draw natural face highlight effect
    drawFaceHighlights(ctx, landmarks, width, height) {
        // Subtle nose bridge highlight
        const noseHighlight = landmarks[9];
        if (noseHighlight) {
            const x = noseHighlight.x * width;
            const y = noseHighlight.y * height;
            
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, 4);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
            gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // Natural blush on cheeks
        const leftCheek = landmarks[116];
        const rightCheek = landmarks[345];
        
        if (leftCheek) {
            this.drawNaturalBlush(ctx, leftCheek.x * width, leftCheek.y * height);
        }
        if (rightCheek) {
            this.drawNaturalBlush(ctx, rightCheek.x * width, rightCheek.y * height);
        }
    }
    
    // Draw natural blush
    drawNaturalBlush(ctx, x, y) {
        // Main blush gradient - natural pink
        const blushGradient = ctx.createRadialGradient(x, y, 0, x, y, 12);
        blushGradient.addColorStop(0, 'rgba(255, 182, 193, 0.2)'); // Light pink center
        blushGradient.addColorStop(0.4, 'rgba(255, 192, 203, 0.15)'); // Light pink
        blushGradient.addColorStop(0.7, 'rgba(255, 218, 185, 0.1)'); // Peach color
        blushGradient.addColorStop(1, 'rgba(255, 228, 225, 0)');
        
        ctx.fillStyle = blushGradient;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    // Draw cheek highlight
    drawCheekHighlight(ctx, x, y) {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, 15);
        gradient.addColorStop(0, 'rgba(255, 182, 193, 0.2)'); // Light pink
        gradient.addColorStop(0.5, 'rgba(255, 192, 203, 0.1)');
        gradient.addColorStop(1, 'rgba(255, 192, 203, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    // Draw calibration progress
    drawCalibrationProgress(ctx) {
        const progress = this.calibrationFrames / this.maxCalibrationFrames;
        const canvasWidth = ctx.canvas.width;
        const canvasHeight = ctx.canvas.height;
        
        // Draw translucent background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        
        // Responsive calibration box size
        const boxWidth = Math.min(canvasWidth * 0.9, 250);
        const boxHeight = Math.min(canvasHeight * 0.6, 100);
        const boxX = (canvasWidth - boxWidth) / 2;
        const boxY = (canvasHeight - boxHeight) / 2;
        
        // Background box
        ctx.fillStyle = 'rgba(78, 205, 196, 0.2)';
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        
        // Border
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 2;
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
        
        // Title
        ctx.fillStyle = '#4ecdc4';
        ctx.font = `bold ${Math.min(16, boxWidth / 15)}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText('🎯 Calibrating', canvasWidth / 2, boxY + boxHeight * 0.3);
        
        // Progress bar background
        const progressBarWidth = boxWidth * 0.8;
        const progressBarHeight = Math.min(16, boxHeight * 0.2);
        const progressBarX = (canvasWidth - progressBarWidth) / 2;
        const progressBarY = boxY + boxHeight * 0.5;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(progressBarX, progressBarY, progressBarWidth, progressBarHeight);
        
        // Progress bar
        const progressWidth = progressBarWidth * progress;
        const gradient = ctx.createLinearGradient(progressBarX, 0, progressBarX + progressWidth, 0);
        gradient.addColorStop(0, '#4ecdc4');
        gradient.addColorStop(1, '#45b7d1');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(progressBarX, progressBarY, progressWidth, progressBarHeight);
        
        // Progress bar边框
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 1;
        ctx.strokeRect(progressBarX, progressBarY, progressBarWidth, progressBarHeight);
        
        // Progress percentage
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.min(14, boxWidth / 18)}px Arial`;
        ctx.fillText(`${Math.round(progress * 100)}%`, canvasWidth / 2, progressBarY + progressBarHeight - 2);
        
        // Hint text
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.min(12, boxWidth / 20)}px Arial`;
        ctx.fillText('Face the camera', canvasWidth / 2, boxY + boxHeight * 0.85);
        
        // Reset text alignment
        ctx.textAlign = 'left';
    }
    
    // Draw calibration complete prompt
    drawCalibrationComplete(ctx) {
        const canvasWidth = ctx.canvas.width;
        const canvasHeight = ctx.canvas.height;

        // --- New Design ---
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const text = '✅ Calibration Complete!';
        const textMetrics = ctx.measureText(text);
        const textWidth = textMetrics.width;

        const paddingX = 20;
        const paddingY = 10;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = 14 + paddingY * 2; // 14 is font size

        const boxX = (canvasWidth - boxWidth) / 2;
        const boxY = canvasHeight - boxHeight - 10; // Position 10px from bottom

        // Draw the background box with a gradient
        const gradient = ctx.createLinearGradient(boxX, boxY, boxX + boxWidth, boxY + boxHeight);
        gradient.addColorStop(0, 'rgba(78, 205, 196, 0.9)');
        gradient.addColorStop(1, 'rgba(69, 183, 209, 0.9)');
        ctx.fillStyle = gradient;
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

        // Draw a thin white border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

        // Draw the text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, canvasWidth / 2, boxY + boxHeight / 2);

        // Reset alignment for other functions
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
    
    // Draw mini status indicator (top-right small icon)
    drawMiniStatus(ctx, landmarks) {
        if (!this.baselineNose || !landmarks) return;
        
        const canvasWidth = ctx.canvas.width;
        const iconSize = 20;
        const spacing = 25;
        let iconX = canvasWidth - 30;
        const iconY = 15;
        
        ctx.font = '16px Arial';
        
        // Tilt status icon
        let tiltIcon = '↔';
        if (this.currentTiltState === 'left') {
            tiltIcon = '←';
        } else if (this.currentTiltState === 'right') {
            tiltIcon = '→';
        }
        ctx.fillText(tiltIcon, iconX, iconY);
        iconX -= spacing;
        
        // Nod status icon
        if (this.nodPhase === 'going_down') {
            ctx.fillText('↓', iconX, iconY);
            iconX -= spacing;
        } else if (this.nodPhase === 'completed') {
            ctx.fillText('⚡', iconX, iconY);
            iconX -= spacing;
        }
        
        // Move mode icon
        if (this.isInFastMoveMode) {
            ctx.fillText('⚡', iconX, iconY);
            iconX -= spacing;
        } else if (this.isInContinuousMode) {
            ctx.fillText('H', iconX, iconY); // Changed from ↻ to H
            iconX -= spacing;
        }
        
        // Mouth status icon
        const upperLip = landmarks[13] || landmarks[12];
        const lowerLip = landmarks[14] || landmarks[15];
        if (upperLip && lowerLip && this.baselineMouth) {
            const mouthDistance = Math.abs(upperLip.y - lowerLip.y);
            const mouthOpen = mouthDistance - this.baselineMouth.distance;
            const isMouthOpen = mouthOpen > this.mouthOpenThreshold;
            
            if (isMouthOpen) {
                ctx.fillText('↻', iconX, iconY);
            }
        }
    }
    
    // Draw natural face fill (remove excessive whitening)
    drawFaceFill(ctx, landmarks, width, height) {
        const faceOval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
        
        ctx.beginPath();
        for (let i = 0; i < faceOval.length; i++) {
            const point = landmarks[faceOval[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        
        // Natural skin tone, referencing Rei Ayanami's actual skin color
        const centerX = width / 2;
        const centerY = height / 2;
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.min(width, height) / 2);
        gradient.addColorStop(0, 'rgba(245, 235, 225, 0.4)'); // Natural skin tone center
        gradient.addColorStop(0.4, 'rgba(240, 228, 218, 0.3)'); // Warm skin tone
        gradient.addColorStop(0.7, 'rgba(235, 220, 210, 0.2)'); // Natural transition
        gradient.addColorStop(1, 'rgba(230, 215, 205, 0.1)'); // Soft edge
        
        ctx.fillStyle = gradient;
        ctx.fill();
    }

    // Draw natural and delicate face contour (referencing Rei Ayanami style)
    drawBeautifiedFaceContour(ctx, landmarks, width, height) {
        const faceOval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
        
        // Main contour line - natural skin tone boundary
        ctx.strokeStyle = 'rgba(160, 140, 120, 0.5)'; // Natural skin tone contour
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < faceOval.length; i++) {
            const point = landmarks[faceOval[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        ctx.stroke();
        
        // Inner delicate lines - soft shadow definition
        ctx.strokeStyle = 'rgba(140, 120, 100, 0.3)'; // Light brown shadow
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = 0; i < faceOval.length; i++) {
            const point = landmarks[faceOval[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        ctx.stroke();
    }
    
    // Draw beautified eyes
    drawBeautifiedEyes(ctx, landmarks, width, height) {
        // Left eye contour
        const leftEye = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
        // Right eye contour
        const rightEye = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
        
        // Draw eye fill
        this.drawEyeFill(ctx, landmarks, leftEye, width, height);
        this.drawEyeFill(ctx, landmarks, rightEye, width, height);
        
        // Draw eye contour - soft outer layer
        ctx.strokeStyle = 'rgba(69, 183, 209, 0.4)';
        ctx.lineWidth = 3;
        this.drawEyeContour(ctx, landmarks, leftEye, width, height);
        this.drawEyeContour(ctx, landmarks, rightEye, width, height);
        
        // Draw eye contour - clear inner layer
        ctx.strokeStyle = '#45b7d1';
        ctx.lineWidth = 1.2;
        this.drawEyeContour(ctx, landmarks, leftEye, width, height);
        this.drawEyeContour(ctx, landmarks, rightEye, width, height);
        
        // Draw beautified pupils
        this.drawBeautifiedPupils(ctx, landmarks, width, height);
    }
    
    // Draw eye fill
    drawEyeFill(ctx, landmarks, eyePoints, width, height) {
        ctx.beginPath();
        for (let i = 0; i < eyePoints.length; i++) {
            const point = landmarks[eyePoints[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        
        // 眼部白色填充
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fill();
    }
    
    // 绘制眼部轮廓
    drawEyeContour(ctx, landmarks, eyePoints, width, height) {
        ctx.beginPath();
        for (let i = 0; i < eyePoints.length; i++) {
            const point = landmarks[eyePoints[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        ctx.stroke();
    }
    
    // Draw beautified pupils
    drawBeautifiedPupils(ctx, landmarks, width, height) {
        const leftPupil = landmarks[468]; // 左眼中心
        const rightPupil = landmarks[473]; // 右眼中心
        
        if (leftPupil) {
            this.drawPupil(ctx, leftPupil.x * width, leftPupil.y * height);
        }
        if (rightPupil) {
            this.drawPupil(ctx, rightPupil.x * width, rightPupil.y * height);
        }
    }
    
    // Draw natural blue pupils (referencing Rei Ayanami)
    drawPupil(ctx, x, y) {
        // Iris - natural blue gradient
        const irisGradient = ctx.createRadialGradient(x, y, 0, x, y, 6);
        irisGradient.addColorStop(0, 'rgba(70, 130, 180, 0.8)'); // Steel blue center
        irisGradient.addColorStop(0.5, 'rgba(100, 149, 237, 0.7)'); // Cornflower blue
        irisGradient.addColorStop(0.8, 'rgba(65, 105, 225, 0.6)'); // Royal blue
        irisGradient.addColorStop(1, 'rgba(30, 60, 120, 0.5)'); // Dark blue edge
        
        ctx.fillStyle = irisGradient;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, 2 * Math.PI);
        ctx.fill();
        
        // Pupil
        ctx.fillStyle = 'rgba(20, 20, 60, 0.9)'; // Dark pupil
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
        ctx.fill();
        
        // Natural highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(x - 1, y - 1, 1.2, 0, 2 * Math.PI);
        ctx.fill();
        
        // Secondary highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.arc(x + 1.5, y + 1.5, 0.6, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    // Draw beautified mouth
    drawBeautifiedMouth(ctx, landmarks, width, height) {
        // Mouth outer contour
        const mouthOuter = [61, 84, 17, 314, 405, 320, 307, 375, 321, 308, 324, 318];
        // Mouth inner contour
        const mouthInner = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324];
        
        // Draw lip fill
        ctx.beginPath();
        for (let i = 0; i < mouthOuter.length; i++) {
            const point = landmarks[mouthOuter[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        
        // Rei Ayanami style delicate lip gradient
        const mouthCenter = landmarks[13];
        if (mouthCenter) {
            const centerX = mouthCenter.x * width;
            const centerY = mouthCenter.y * height;
            
            // Main lip gradient - more delicate pink
            const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 18);
            gradient.addColorStop(0, 'rgba(255, 192, 203, 0.8)'); // Light pink center
            gradient.addColorStop(0.4, 'rgba(255, 182, 193, 0.6)'); // Light pink
            gradient.addColorStop(0.7, 'rgba(255, 160, 180, 0.4)'); // Medium pink
            gradient.addColorStop(1, 'rgba(255, 140, 160, 0.2)'); // Edge pink
            
            ctx.fillStyle = gradient;
            ctx.fill();
            
            // Lip highlight - anime style gloss
            const highlightGradient = ctx.createLinearGradient(centerX - 10, centerY - 3, centerX + 10, centerY + 3);
            highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
            highlightGradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)');
            highlightGradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.4)');
            highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.fillStyle = highlightGradient;
            ctx.beginPath();
            ctx.ellipse(centerX, centerY - 2, 8, 2, 0, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // Outer contour - soft halo
        ctx.strokeStyle = 'rgba(255, 107, 107, 0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < mouthOuter.length; i++) {
            const point = landmarks[mouthOuter[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        ctx.stroke();
        
        // Inner contour - clear lines
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < mouthOuter.length; i++) {
            const point = landmarks[mouthOuter[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        ctx.stroke();
        
        // Lip demarcation line
        ctx.strokeStyle = 'rgba(255, 138, 138, 0.8)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = 0; i < mouthInner.length; i++) {
            const point = landmarks[mouthInner[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        ctx.stroke();
    }
    
    // Draw beautified nose
    drawBeautifiedNose(ctx, landmarks, width, height) {
        // Nose bridge
        const noseBridge = [6, 8, 9, 10, 151];
        
        // Nose bridge外层光晕
        ctx.strokeStyle = 'rgba(255, 165, 0, 0.3)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < noseBridge.length; i++) {
            const point = landmarks[noseBridge[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
        
        // Nose bridge内层线条
        ctx.strokeStyle = 'rgba(255, 165, 0, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < noseBridge.length; i++) {
            const point = landmarks[noseBridge[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
        
        // Nose tip highlight
        const noseTip = landmarks[1];
        if (noseTip) {
            const x = noseTip.x * width;
            const y = noseTip.y * height;
            
            // Outer halo
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, 6);
            gradient.addColorStop(0, 'rgba(255, 165, 0, 0.6)');
            gradient.addColorStop(0.7, 'rgba(255, 165, 0, 0.3)');
            gradient.addColorStop(1, 'rgba(255, 165, 0, 0.1)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, 2 * Math.PI);
            ctx.fill();
            
            // Inner highlight
            ctx.fillStyle = 'rgba(255, 200, 100, 0.8)';
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // Nostrils - more natural color
        const leftNostril = landmarks[220];
        const rightNostril = landmarks[305];
        
        if (leftNostril) {
            this.drawNostril(ctx, leftNostril.x * width, leftNostril.y * height);
        }
        if (rightNostril) {
            this.drawNostril(ctx, rightNostril.x * width, rightNostril.y * height);
        }
    }
    
    // Draw nostrils
    drawNostril(ctx, x, y) {
        // Outer shadow
        ctx.fillStyle = 'rgba(139, 69, 19, 0.3)';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
        
        // Inner nostril
        ctx.fillStyle = 'rgba(139, 69, 19, 0.6)';
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    // Draw beautified eyebrows
    drawBeautifiedEyebrows(ctx, landmarks, width, height) {
        // Left eyebrow key points
        const leftEyebrow = [46, 53, 52, 51, 48];
        // Right eyebrow key points
        const rightEyebrow = [276, 283, 282, 295, 285];
        
        // Draw left eyebrow
        this.drawEyebrow(ctx, landmarks, leftEyebrow, width, height);
        // Draw right eyebrow
        this.drawEyebrow(ctx, landmarks, rightEyebrow, width, height);
    }
    
    // Draw single eyebrow
    drawEyebrow(ctx, landmarks, eyebrowPoints, width, height) {
        // Outer halo
        ctx.strokeStyle = 'rgba(139, 69, 19, 0.4)';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        for (let i = 0; i < eyebrowPoints.length; i++) {
            const point = landmarks[eyebrowPoints[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
        
        // Inner eyebrow
        ctx.strokeStyle = 'rgba(101, 67, 33, 0.8)';
        ctx.lineWidth = 2;
        
        ctx.beginPath();
        for (let i = 0; i < eyebrowPoints.length; i++) {
            const point = landmarks[eyebrowPoints[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
        
        // Eyebrow hair effect
        ctx.strokeStyle = 'rgba(139, 69, 19, 0.6)';
        ctx.lineWidth = 0.8;
        
        for (let i = 0; i < eyebrowPoints.length - 1; i++) {
            const point1 = landmarks[eyebrowPoints[i]];
            const point2 = landmarks[eyebrowPoints[i + 1]];
            
            if (point1 && point2) {
                const x1 = point1.x * width;
                const y1 = point1.y * height;
                const x2 = point2.x * width;
                const y2 = point2.y * height;
                
                // Draw a few hair lines
                for (let j = 0; j < 3; j++) {
                    const t = j / 2;
                    const x = x1 + (x2 - x1) * t;
                    const y = y1 + (y2 - y1) * t;
                    
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + (Math.random() - 0.5) * 4, y - 2 - Math.random() * 3);
                    ctx.stroke();
                }
            }
        }
    }
    
    drawControlStatus(ctx, landmarks) {
        if (!this.baselineNose || !landmarks) return;

        const canvasWidth = ctx.canvas.width;
        const statusX = 5;
        let statusY = 5;
        const lineHeight = 15; // Line height for vertical layout
        const padding = 5;
        ctx.font = 'bold 12px Arial'; // Larger font

        // --- Step 1: Collect all status items to be drawn ---
        const items = [];
        items.push({ text: '▶ Status', color: '#4ecdc4' }); // Title

        // 1. Tilt Status
        let tiltIcon = '↔';
        let tiltColor = '#FFF';
        if (this.currentTiltState === 'left') {
            tiltIcon = '←';
            tiltColor = '#ff6b6b';
        } else if (this.currentTiltState === 'right') {
            tiltIcon = '→';
            tiltColor = '#45b7d1';
        }
        items.push({ text: `${tiltIcon} Tilt`, color: tiltColor });

        // 2. Nod Status
        if (this.nodPhase === 'going_down' || this.nodPhase === 'completed') {
            items.push({ text: '↓ Nod', color: '#ffcc00' });
        }

        // 3. Mouth Status
        const upperLip = landmarks[13] || landmarks[12];
        const lowerLip = landmarks[14] || landmarks[15];
        if (upperLip && lowerLip && this.baselineMouth) {
            const mouthDistance = Math.abs(upperLip.y - lowerLip.y);
            const mouthOpen = mouthDistance - this.baselineMouth.distance;
            if (mouthOpen > this.mouthOpenThreshold) {
                items.push({ text: '↻ Rotate', color: '#ff6b6b' });
            }
        }

        // 4. Continuous/Fast Move Status
        if (this.isInFastMoveMode) {
            items.push({ text: '⚡ Fast', color: '#ff6b6b' });
        } else if (this.isInContinuousMode) {
            items.push({ text: 'H Hold', color: '#45b7d1' });
        }

        // --- Step 2: Calculate box size and draw background ---
        const boxHeight = items.length * lineHeight + padding * 2;
        let maxTextWidth = 0;
        items.forEach(item => {
            const width = ctx.measureText(item.text).width;
            if (width > maxTextWidth) {
                maxTextWidth = width;
            }
        });
        const boxWidth = maxTextWidth + padding * 2;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(statusX, statusY, boxWidth, boxHeight);

        // --- Step 3: Draw the text items vertically ---
        ctx.textBaseline = 'top';
        items.forEach((item, index) => {
            ctx.fillStyle = item.color;
            ctx.fillText(item.text, statusX + padding, statusY + padding + (index * lineHeight));
        });
    }
    
    resetDropSpeed() {
        // Nod is an instantaneous action, no need to reset continuous state
        this.nodPhase = 'waiting';
        this.nodStartTime = 0;
    }
    
    updateSensitivity(tiltThreshold, nodThreshold, mouthThreshold) {
        this.headTiltThreshold = tiltThreshold;
        this.nodThreshold = nodThreshold;
        this.mouthOpenThreshold = mouthThreshold;
    }
    
    stop() {
        if (this.camera) {
            this.camera.stop();
        }
        
        const video = document.getElementById('input_video');
        if (video && video.srcObject) {
            const tracks = video.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            video.srcObject = null;
        }
        
        this.isActive = false;
        this.resetCalibration();
    }
}