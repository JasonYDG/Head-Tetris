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
        this.actionCooldown = 150; // Reduced from 300ms to 150ms for faster response
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
        this.fastMoveThreshold = 0.30; // Increased from 0.22 to 0.30 to avoid accidental triggers
        this.fastMoveInterval = 40;

        // Head lift detection using head pitch angle (more accurate)
        this.headLiftAngleThreshold = 5; // Degrees - head pitch angle threshold for fast drop (lowered for easier trigger)
        this.headLiftThreshold = 0.74; // Ratio threshold (when eye-mouth distance < 74% of initial)
        this.headLiftCancelThreshold = 0.74; // Cancel threshold (when distance >= 74% of initial)
        this.headVerticalThreshold = 45; // Degrees - maximum head tilt angle to allow fast drop (only prevent when extremely tilted)
        this.isHeadLifted = false; // Current head lift state (for display)
        this.isHeadLiftTriggered = false; // Whether fast drop is actually triggered
        this.headLiftStartTime = 0; // When head lift started
        this.headLiftTriggerDelay = 500; // 0.5 second delay before triggering
        this.lastFastDropTime = 0;
        this.fastDropInterval = 80; // Fixed fast drop interval (80ms = 12.5 drops per second)
        this.currentPieceId = null; // Track current piece to reset on new piece

        // Eye-mouth distance trend tracking
        this.eyeMouthDistanceHistory = [];
        this.maxDistanceHistory = 10; // Shorter history for more responsive detection
        this.initialEyeMouthDistance = null; // Initial distance when calibration completes
        this.currentEyeMouthDistance = null;

        // Face detection stability tracking
        this.faceDetectionFailureCount = 0;
        this.maxFailureCount = 30; // Allow 30 consecutive failures before showing warning (约1秒)
        this.lastSuccessfulDetection = Date.now();

        // 添加检测质量评估
        this.recentDetectionHistory = []; // 记录最近的检测结果
        this.detectionHistorySize = 10; // 保留最近10帧的检测结果

        // Status display control
        this.showDetailedStatus = true; // Can be set to false to show mini status

        // Calibration complete prompt control
        this.calibrationCompleteTime = 0;
        this.showCalibrationComplete = false;

        // Debug frame counters
        this.frameCounter = 0;
        this.distanceFrameCounter = 0;

        // Baseline face height to width ratio for head lift detection
        this.baselineFaceHeightWidthRatio = null;

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
                refineLandmarks: false, // 关闭精细化地标检测以减少CPU使用
                minDetectionConfidence: 0.5, // 提高检测置信度阈值以减少误报
                minTrackingConfidence: 0.5, // 提高跟踪置信度阈值以提高稳定性
                selfieMode: true, // 启用自拍模式
                staticImageMode: false, // 确保视频模式
                modelComplexity: 0 // 使用最简单的模型以减少GPU负载
            });

            this.faceMesh.onResults(this.onResults.bind(this));

            console.log('MediaPipe Face Mesh initialized successfully');
        } catch (error) {
            console.error('MediaPipe initialization failed:', error);

            // Show user-friendly error message
            const canvas = document.getElementById('output_canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = 'rgba(255, 107, 107, 0.8)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 16px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                ctx.fillText('MediaPipe Error', canvas.width / 2, canvas.height / 2 - 20);
                ctx.font = '12px Arial';
                ctx.fillText('Try refreshing the page', canvas.width / 2, canvas.height / 2 + 10);
            }
        }
    }

    async startCamera() {
        try {
            // Check WebGL support
            const testCanvas = document.createElement('canvas');
            const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
            if (!gl) {
                console.warn('WebGL not supported, MediaPipe may have issues');
                alert('Warning: Your browser may not fully support this feature. Try using Chrome or Edge for better compatibility.');
            }

            const video = document.getElementById('input_video');
            const canvas = document.getElementById('output_canvas');

            // Reset calibration state
            this.resetCalibration();

            // Use default camera with improved resolution for better face detection
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: 640,
                    height: 480,
                    frameRate: { ideal: 30, max: 30 } // 确保稳定的帧率
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

            // Monitor video stream status
            video.addEventListener('ended', () => {
                console.warn('Video stream ended unexpectedly');
                this.handleStreamInterruption();
            });

            video.addEventListener('error', (e) => {
                console.error('Video stream error:', e);
                this.handleStreamInterruption();
            });

            // Create MediaPipe Camera with improved resolution
            this.camera = new Camera(video, {
                onFrame: async () => {
                    try {
                        if (this.faceMesh && video.readyState === 4 && !video.paused && !video.ended) {
                            await this.faceMesh.send({ image: video });
                        } else if (video.readyState !== 4) {
                            console.warn('Video not ready, readyState:', video.readyState);
                        }
                    } catch (error) {
                        console.error('Frame processing error:', error);
                        // Don't throw error, just log it to prevent breaking the camera loop
                    }
                },
                width: 640,
                height: 480
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

            // Draw video frame with error handling
            if (results.image) {
                try {
                    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
                } catch (webglError) {
                    console.warn('WebGL drawing error, using fallback:', webglError);
                    // Fallback: just fill with a solid color
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
            }

            if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                // Face detected successfully
                this.faceDetectionFailureCount = 0;
                this.lastSuccessfulDetection = Date.now();
                this.isFaceDetected = true;
                const landmarks = results.multiFaceLandmarks[0];

                // 更新检测历史记录
                this.recentDetectionHistory.push(true);
                if (this.recentDetectionHistory.length > this.detectionHistorySize) {
                    this.recentDetectionHistory.shift();
                }

                // Debug: Log successful detection every 60 frames (约2秒)
                if (this.frameCounter % 60 === 0) {
                    const successRate = this.recentDetectionHistory.filter(x => x).length / this.recentDetectionHistory.length;
                    console.log(`[人脸检测] 成功检测到人脸，地标点数: ${landmarks.length}，最近成功率: ${(successRate * 100).toFixed(1)}%`);
                }

                // Draw face landmarks every frame
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

                // Detect head lift for accelerated drop (independent of action cooldown)
                if (this.tetrisGame.gameRunning) {
                    this.checkNodAcceleration(landmarks);
                }

                // Display control status (detail level controlled by showDetailedStatus)
                if (this.showDetailedStatus !== false) {
                    this.drawControlStatus(ctx, landmarks);
                } else {
                    this.drawMiniStatus(ctx, landmarks);
                }
            } else {
                // No face detected - increment failure count
                this.faceDetectionFailureCount++;

                // 更新检测历史记录
                this.recentDetectionHistory.push(false);
                if (this.recentDetectionHistory.length > this.detectionHistorySize) {
                    this.recentDetectionHistory.shift();
                }

                // Debug: Log detection failures every 30 frames
                if (this.faceDetectionFailureCount % 30 === 0) {
                    const successRate = this.recentDetectionHistory.filter(x => x).length / this.recentDetectionHistory.length;
                    console.log(`[人脸检测] 连续检测失败 ${this.faceDetectionFailureCount} 帧，最近成功率: ${(successRate * 100).toFixed(1)}%`);
                }

                // 使用更智能的判断逻辑：考虑最近的成功率
                const recentSuccessRate = this.recentDetectionHistory.length > 0 ?
                    this.recentDetectionHistory.filter(x => x).length / this.recentDetectionHistory.length : 0;

                // 只有在连续失败且最近成功率很低时才认为真正丢失人脸
                if (this.faceDetectionFailureCount >= this.maxFailureCount && recentSuccessRate < 0.2) {
                    this.isFaceDetected = false;

                    // Draw "Please face the camera" message
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    ctx.fillStyle = '#ff6b6b'; // Red color for warning
                    ctx.font = 'bold 18px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    const timeSinceLastDetection = Date.now() - this.lastSuccessfulDetection;
                    if (timeSinceLastDetection > 3000) { // 3 seconds - 缩短时间判断
                        ctx.fillText('Face detection lost', canvas.width / 2, canvas.height / 2 - 10);
                        ctx.font = '12px Arial';
                        ctx.fillText('Try adjusting lighting or position', canvas.width / 2, canvas.height / 2 + 15);
                    } else {
                        ctx.fillText('Please face the camera', canvas.width / 2, canvas.height / 2);
                    }
                } else {
                    // Still in grace period, keep previous detection status
                    // Don't change this.isFaceDetected yet
                }
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

            // Increment failure count on processing errors
            this.faceDetectionFailureCount++;

            // If it's a WebGL error, try to continue with basic functionality
            if (error.message && error.message.includes('WebGL')) {
                console.log('WebGL error detected, continuing with basic face detection...');

                // Try to continue with landmarks processing only
                if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                    try {
                        const landmarks = results.multiFaceLandmarks[0];

                        // Reset failure count if we can process landmarks
                        this.faceDetectionFailureCount = 0;
                        this.lastSuccessfulDetection = Date.now();

                        // Skip drawing, just do detection
                        if (this.calibrationFrames < this.maxCalibrationFrames) {
                            this.calibrateBaseline(landmarks);
                            this.calibrationFrames++;
                        } else {
                            this.detectHeadMovements(landmarks);
                            if (this.tetrisGame.gameRunning) {
                                this.checkNodAcceleration(landmarks);
                            }
                        }
                    } catch (detectionError) {
                        console.error('Face detection error:', detectionError);
                        this.faceDetectionFailureCount++;
                    }
                }
            }

            // If too many consecutive errors, try to restart
            if (this.faceDetectionFailureCount > 50) { // 50 consecutive errors
                console.warn('Too many processing errors, attempting camera restart...');
                this.faceDetectionFailureCount = 0;
                this.restartCamera();
            }
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
                this.baselineNose = { x: 0, y: 0, z: 0 };
                this.baselineMouth = { distance: 0 };
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
        this.lastAction = '';
        this.lastActionTime = 0;

        // Reset calibration complete prompt
        this.calibrationCompleteTime = 0;
        this.showCalibrationComplete = false;

        // Reset head lift detection system
        this.eyeMouthDistanceHistory = [];
        this.initialEyeMouthDistance = null;
        this.currentEyeMouthDistance = null;
        this.isHeadLifted = false;
        this.isHeadLiftTriggered = false;
        this.headLiftStartTime = 0;
        this.fastDropPieceId = null; // Track which piece has fast drop active
        this.currentPieceId = null;

        // Reset face detection status
        this.isFaceDetected = false;
        this.lastFaceDetectionStatus = false;
        this.calibrationCompletedNotified = false; // New property
        this.faceDetectionFailureCount = 0;
        this.lastSuccessfulDetection = Date.now();
        this.recentDetectionHistory = []; // 重置检测历史

        // Reset debug counters
        this.frameCounter = 0;
        this.distanceFrameCounter = 0;

        // Reset baseline face ratio
        this.baselineFaceHeightWidthRatio = null;
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
            // Detect left/right tilt (not disabled during head lift)
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



            this.mouthWasOpen = isMouthOpen;
            this.lastTiltState = this.currentTiltState;

            // Execute action
            if (action) {
                // Allow continuous/fast movement to bypass action cooldown
                const isContinuousMove = this.isInContinuousMode || this.isInFastMoveMode;
                const shouldExecute = action === 'rotate' || action !== this.lastAction || isContinuousMove;

                if (shouldExecute) {
                    this.executeAction(action);

                    // Only apply cooldown for non-continuous actions
                    if (!isContinuousMove) {
                        this.lastAction = action;
                        this.lastActionTime = now;

                        setTimeout(() => {
                            this.lastAction = '';
                        }, this.actionCooldown);
                    }
                }
            }
        } catch (error) {
            console.error('Action detection error:', error);
        }
    }

    // Head lift detection using face height to width ratio (simplified algorithm)
    checkNodAcceleration(landmarks) {
        const now = Date.now();

        // Calculate face height (forehead to mouth) and width
        const faceHeight = this.calculateFaceHeight(landmarks);
        const faceWidth = this.calculateHeadWidth(landmarks);

        if (faceHeight === null || faceWidth === null) {
            return false;
        }

        // Calculate current face height to width ratio
        const currentHeightWidthRatio = faceHeight / faceWidth;

        // Set baseline ratio if not set (after calibration)
        if (!this.baselineFaceHeightWidthRatio && this.calibrationFrames >= this.maxCalibrationFrames) {
            this.baselineFaceHeightWidthRatio = currentHeightWidthRatio;
            console.log(`[初始化] 基准面部高宽比: ${this.baselineFaceHeightWidthRatio.toFixed(4)}`);
            return false;
        }

        if (!this.baselineFaceHeightWidthRatio) {
            return false;
        }

        // Calculate ratio compared to baseline (when head lifts, ratio becomes smaller)
        const ratioComparedToBaseline = currentHeightWidthRatio / this.baselineFaceHeightWidthRatio;

        // Debug logging
        if (!this.frameCounter) this.frameCounter = 0;
        this.frameCounter++;

        if (this.frameCounter % 30 === 0) {
            console.log(`[面部比例] 当前高度: ${faceHeight.toFixed(4)}, 宽度: ${faceWidth.toFixed(4)}, 高宽比: ${currentHeightWidthRatio.toFixed(4)}`);
            console.log(`[基准比较] 基准高宽比: ${this.baselineFaceHeightWidthRatio.toFixed(4)}, 当前比例: ${(ratioComparedToBaseline * 100).toFixed(1)}%`);
            console.log(`[状态] 快速下降: ${this.isHeadLiftTriggered ? '开启' : '关闭'}`);
        }

        // Track current piece ID
        if (this.tetrisGame.currentPiece && this.currentPieceId !== this.tetrisGame.currentPiece.id) {
            const oldId = this.currentPieceId;
            this.currentPieceId = this.tetrisGame.currentPiece.id;
            console.log(`[方块变化] ${oldId} -> ${this.currentPieceId}, 快速下降方块: ${this.fastDropPieceId}`);
        }

        // Check if head is severely tilted (face not vertical)
        const headTiltAngle = this.calculateHeadTiltAngle(landmarks);
        const isHeadSeverelyTilted = headTiltAngle !== null && Math.abs(headTiltAngle) > this.headVerticalThreshold;

        // Head lift detection: ratio < 75% of baseline and not severely tilted
        const isCurrentlyLifted = ratioComparedToBaseline < 0.75 && !isHeadSeverelyTilted;

        // Debug logging for head tilt detection
        if (this.frameCounter % 15 === 0) {
            console.log(`[倾斜] 头部倾斜角度: ${headTiltAngle ? headTiltAngle.toFixed(1) : 'N/A'}°, 严重倾斜: ${isHeadSeverelyTilted ? '是' : '否'}`);
            console.log(`[判断] 高宽比例: ${(ratioComparedToBaseline * 100).toFixed(1)}%, 抬头检测: ${isCurrentlyLifted ? '是' : '否'} (阈值: <75%)`);
        }

        // Detect head lift state changes
        const currentPieceId = this.tetrisGame.currentPiece ? this.tetrisGame.currentPiece.id : null;

        if (isCurrentlyLifted) {
            if (!this.isHeadLifted) {
                // Head just lifted - start timing
                this.isHeadLifted = true;
                this.headLiftStartTime = now;
                console.log(`[检测] 面部高宽比缩短到 ${(ratioComparedToBaseline * 100).toFixed(1)}% < 75%，开始计时 0.5秒`);
                console.log(`[状态] 游戏运行: ${this.tetrisGame.gameRunning}, 当前方块ID: ${currentPieceId}`);
            } else if (!this.isHeadLiftTriggered) {
                // Head still lifted - check if delay has passed
                const elapsed = now - this.headLiftStartTime;
                const remaining = Math.max(0, this.headLiftTriggerDelay - elapsed);
                console.log(`[等待] 倒计时: ${(remaining / 1000).toFixed(1)}秒`);

                if (elapsed >= this.headLiftTriggerDelay) {
                    // Check if we have a valid piece and it's not already triggered
                    if (currentPieceId && currentPieceId !== this.fastDropPieceId) {
                        // Can trigger fast drop for this piece
                        this.isHeadLiftTriggered = true;
                        this.fastDropPieceId = currentPieceId;
                        this.lastFastDropTime = 0; // Reset to allow immediate first drop
                        console.log(`[触发] 快速下降激活！方块ID: ${currentPieceId}`);
                    } else if (currentPieceId === this.fastDropPieceId) {
                        console.log(`[跳过] 当前方块(${currentPieceId})已经触发过快速下降`);
                    } else {
                        console.log(`[错误] 无效的方块ID: ${currentPieceId}`);
                    }
                }
            }
        } else {
            // Head lowered or tilted - reset detection state but keep fast drop active
            if (this.isHeadLifted) {
                const reason = isHeadSeverelyTilted ? '头部严重倾斜' : '面部比例恢复';
                console.log(`[停止检测] ${reason}，但快速下降继续 (比例: ${(ratioComparedToBaseline * 100).toFixed(1)}%)`);
            }
            this.isHeadLifted = false;
            this.headLiftStartTime = 0;
            // 注意：不重置 isHeadLiftTriggered，让快速下降继续到方块放置
        }

        // Continuous fast drop while head lift is triggered
        if (this.isHeadLiftTriggered) {
            const currentPieceId = this.tetrisGame.currentPiece ? this.tetrisGame.currentPiece.id : null;

            // 检查当前方块是否是触发快速下降的方块
            if (currentPieceId !== this.fastDropPieceId) {
                console.log(`[停止] 方块已变化，停止快速下降 - 触发方块: ${this.fastDropPieceId}, 当前方块: ${currentPieceId}`);
                this.isHeadLiftTriggered = false;
                this.fastDropPieceId = null;
            } else if (this.tetrisGame.gameRunning && this.tetrisGame.currentPiece) {
                if (now - this.lastFastDropTime >= this.fastDropInterval) {
                    const success = this.triggerContinuousDrop();
                    this.lastFastDropTime = now;
                    if (success) {
                        console.log(`[执行] 快速下降成功 - 方块ID: ${currentPieceId}`);
                    }
                }
            } else {
                console.log(`[警告] 快速下降激活但游戏未运行或无方块 - 游戏运行: ${this.tetrisGame.gameRunning}, 方块存在: ${!!this.tetrisGame.currentPiece}`);
            }
        }

        return false;
    }

    // Trigger continuous drop while head is lifted
    triggerContinuousDrop() {
        if (this.tetrisGame.gameRunning && this.tetrisGame.currentPiece) {
            // 尝试下降一格，如果失败也不停止（让游戏自己处理方块放置）
            const success = this.tetrisGame.movePiece(0, 1);
            return success;
        }
        return false;
    }

    // Reset drop speed when piece is placed (called from game)
    resetDropSpeed() {
        // 重置快速下降状态，新方块需要重新触发
        const wasTriggered = this.isHeadLiftTriggered;
        const oldPieceId = this.fastDropPieceId;

        this.isHeadLiftTriggered = false;
        this.fastDropPieceId = null;
        this.currentPieceId = null;

        // 同时重置头部抬起检测状态，确保新方块需要重新触发
        this.isHeadLifted = false;
        this.headLiftStartTime = 0;

        console.log(`[重置] 快速下降状态重置 - 之前触发: ${wasTriggered}, 方块ID: ${oldPieceId} -> null`);
    }

    // Calculate distance between nose tip and mouth center
    calculateEyeMouthDistance(landmarks) {
        if (!landmarks || landmarks.length < 400) return null;

        // Eye landmarks (using eye centers for stability)
        const leftEye = landmarks[33]; // Left eye center
        const rightEye = landmarks[362]; // Right eye center  
        const upperLip = landmarks[13] || landmarks[12]; // Upper lip center
        const lowerLip = landmarks[14] || landmarks[15]; // Lower lip center

        if (!leftEye || !rightEye || !upperLip || !lowerLip) return null;

        // Calculate eye center (between left and right eyes)
        const eyeCenterX = (leftEye.x + rightEye.x) / 2;
        const eyeCenterY = (leftEye.y + rightEye.y) / 2;

        // Calculate mouth center
        const mouthCenterX = (upperLip.x + lowerLip.x) / 2;
        const mouthCenterY = (upperLip.y + lowerLip.y) / 2;

        // Calculate Euclidean distance between eye center and mouth center
        const dx = eyeCenterX - mouthCenterX;
        const dy = eyeCenterY - mouthCenterY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        return distance;
    }

    // Calculate forehead to chin distance (gets shorter when head lifts up)
    calculateForeheadChinDistance(landmarks) {
        if (!landmarks || landmarks.length < 400) {
            console.log('[距离] 地标点数量不足:', landmarks ? landmarks.length : 0);
            return null;
        }

        // Key landmarks for distance calculation
        const forehead = landmarks[10];      // Forehead center
        const chinTip = landmarks[175];      // Chin tip

        if (!forehead || !chinTip) {
            console.log('[距离] 关键地标点缺失:', {
                forehead: !!forehead,
                chinTip: !!chinTip
            });
            return null;
        }

        // Calculate Euclidean distance between forehead and chin
        const dx = forehead.x - chinTip.x;
        const dy = forehead.y - chinTip.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Debug logging every 60 frames
        if (!this.distanceFrameCounter) this.distanceFrameCounter = 0;
        this.distanceFrameCounter++;
        if (this.distanceFrameCounter % 60 === 0) {
            console.log(`[距离详细] 额头坐标: (${forehead.x.toFixed(3)}, ${forehead.y.toFixed(3)}), 下巴坐标: (${chinTip.x.toFixed(3)}, ${chinTip.y.toFixed(3)}), 距离: ${distance.toFixed(4)}`);
        }

        return distance;
    }

    // Calculate head width (distance between left and right face edges)
    calculateHeadWidth(landmarks) {
        if (!landmarks || landmarks.length < 400) {
            return null;
        }

        // Use ear-to-ear distance for more stable head width measurement
        // These points are more stable than face contour
        const leftEar = landmarks[234];    // Left ear area
        const rightEar = landmarks[454];   // Right ear area

        // Fallback to temple points if ear points not available
        const leftPoint = leftEar || landmarks[172];
        const rightPoint = rightEar || landmarks[397];

        if (!leftPoint || !rightPoint) {
            return null;
        }

        // Calculate horizontal distance between left and right points
        const dx = rightPoint.x - leftPoint.x;
        const dy = rightPoint.y - leftPoint.y;
        const width = Math.sqrt(dx * dx + dy * dy);

        return width;
    }

    // Handle camera stream interruption
    handleStreamInterruption() {
        console.log('Handling camera stream interruption...');
        this.isFaceDetected = false;
        this.faceDetectionFailureCount = this.maxFailureCount; // Force immediate warning

        // Try to restart camera after a short delay
        setTimeout(() => {
            if (this.isActive) {
                console.log('Attempting to restart camera...');
                this.restartCamera();
            }
        }, 2000);
    }

    // Restart camera function
    async restartCamera() {
        try {
            console.log('Restarting camera...');

            // Stop current camera if exists
            if (this.camera) {
                this.camera.stop();
            }

            // Clear any existing video stream
            const video = document.getElementById('input_video');
            if (video && video.srcObject) {
                const tracks = video.srcObject.getTracks();
                tracks.forEach(track => track.stop());
                video.srcObject = null;
            }

            // Wait a moment then restart
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.startCamera();

            console.log('Camera restarted successfully');
        } catch (error) {
            console.error('Failed to restart camera:', error);

            // Show error message to user
            const canvas = document.getElementById('output_canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = 'rgba(255, 107, 107, 0.8)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 16px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                ctx.fillText('Camera Error', canvas.width / 2, canvas.height / 2 - 20);
                ctx.font = '12px Arial';
                ctx.fillText('Please refresh the page', canvas.width / 2, canvas.height / 2 + 10);
            }
        }
    }

    // Calculate face height (distance from forehead to mouth)
    calculateFaceHeight(landmarks) {
        if (!landmarks || landmarks.length < 400) {
            return null;
        }

        // Use forehead center to mouth center for height measurement
        const forehead = landmarks[10];      // Forehead center
        const mouth = landmarks[13];         // Upper lip center (mouth area)

        if (!forehead || !mouth) {
            return null;
        }

        // Calculate vertical distance from forehead to mouth
        const dx = forehead.x - mouth.x;
        const dy = forehead.y - mouth.y;
        const height = Math.sqrt(dx * dx + dy * dy);

        return height;
    }

    // Calculate head tilt angle using eye landmarks
    calculateHeadTiltAngle(landmarks) {
        if (!landmarks || landmarks.length < 400) {
            return null;
        }

        // Use eye landmarks to calculate head tilt
        const leftEye = landmarks[33];  // Left eye center
        const rightEye = landmarks[362]; // Right eye center

        if (!leftEye || !rightEye) {
            return null;
        }

        // Calculate the angle between the two eyes
        const deltaX = rightEye.x - leftEye.x;
        const deltaY = rightEye.y - leftEye.y;

        // Calculate angle in degrees
        // Positive angle means head tilted to the right, negative means tilted to the left
        const angleRadians = Math.atan2(deltaY, deltaX);
        const angleDegrees = angleRadians * (180 / Math.PI);

        return angleDegrees;
    }

    updateEyeMouthDistanceHistory(distance) {
        this.eyeMouthDistanceHistory.push(distance);
        if (this.eyeMouthDistanceHistory.length > this.maxDistanceHistory) {
            this.eyeMouthDistanceHistory.shift();
        }
    }

    getAverageDistance() {
        if (this.eyeMouthDistanceHistory.length === 0) return null;
        const sum = this.eyeMouthDistanceHistory.reduce((a, b) => a + b, 0);
        return sum / this.eyeMouthDistanceHistory.length;
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

        // Only disable move operations when fast drop is active (to avoid interference), allow rotation
        if (this.isHeadLiftTriggered && (action === 'left' || action === 'right')) {
            console.log('Move operation disabled during fast drop:', action);
            return;
        }

        switch (action) {
            case 'left':
                this.tetrisGame.movePiece(-1, 0);
                break;
            case 'right':
                this.tetrisGame.movePiece(1, 0);
                break;
            case 'rotate':
                this.tetrisGame.rotatePiece();
                break;
        }
    }

    drawLandmarks(ctx, landmarks) {
        const canvasWidth = ctx.canvas.width;
        const canvasHeight = ctx.canvas.height;

        // 提高面部亮度和对比度
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'; // 提高亮度50%
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // 增加对比度以显示更多面部细节
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = 'rgba(128, 128, 128, 0.15)'; // 增加对比度
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        ctx.globalCompositeOperation = 'source-over'; // 恢复默认混合模式

        // Draw simplified face contour
        this.drawBeautifiedFaceContour(ctx, landmarks, canvasWidth, canvasHeight);

        // Draw only mouth outline (needed for mouth open detection)
        this.drawBeautifiedMouth(ctx, landmarks, canvasWidth, canvasHeight);

        // Skip nose, eyes and eyebrows to reduce CPU usage
        // this.drawBeautifiedNose(ctx, landmarks, canvasWidth, canvasHeight);
        // this.drawBeautifiedEyes(ctx, landmarks, canvasWidth, canvasHeight);
        // this.drawBeautifiedEyebrows(ctx, landmarks, canvasWidth, canvasHeight);
        // this.drawFaceHighlights(ctx, landmarks, canvasWidth, canvasHeight);
    }

    // Simplified face highlight effect
    drawFaceHighlights(ctx, landmarks, width, height) {
        // 简化的鼻子高光，减少复杂计算
        const noseHighlight = landmarks[9];
        if (noseHighlight) {
            const x = noseHighlight.x * width;
            const y = noseHighlight.y * height;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
        }
        // 移除腮红等复杂效果以减少CPU使用
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

        // 抬头状态图标
        if (this.isHeadLiftTriggered) {
            ctx.fillText('⚡', iconX, iconY); // 闪电表示快速下降激活
            iconX -= spacing;
        } else if (this.isHeadLifted) {
            ctx.fillText('⬆️', iconX, iconY); // 箭头表示检测到抬头但未触发
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

    // Simple brightness adjustment instead of face whitening
    drawFaceFill(ctx, landmarks, width, height) {
        // 简单的亮度提升，不进行复杂的面部美白
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; // 轻微提升亮度
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over'; // 恢复默认混合模式
    }

    // Draw natural and delicate face contour (referencing Rei Ayanami style)
    drawBeautifiedFaceContour(ctx, landmarks, width, height) {
        // 简化的面部轮廓，只绘制基本边框
        const faceOval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

        ctx.strokeStyle = 'rgba(78, 205, 196, 0.6)'; // 简单的青色轮廓
        ctx.lineWidth = 1.5;
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
        // 使用与游戏检测相同的关键点
        const leftCorner = landmarks[61];   // 左嘴角
        const rightCorner = landmarks[291]; // 右嘴角
        const upperLip = landmarks[13];     // 上唇中心（与游戏检测一致）
        const lowerLip = landmarks[14];     // 下唇中心（与游戏检测一致）

        if (leftCorner && rightCorner && upperLip && lowerLip && this.baselineMouth) {
            // 计算嘴部中心点
            const centerX = ((leftCorner.x + rightCorner.x) / 2) * width;
            const centerY = ((upperLip.y + lowerLip.y) / 2) * height;

            // 计算嘴部宽度
            const mouthWidth = Math.abs(rightCorner.x - leftCorner.x) * width;

            // 使用与游戏检测完全相同的逻辑判断嘴部是否张开
            const mouthDistance = Math.abs(upperLip.y - lowerLip.y);
            const mouthOpen = mouthDistance - this.baselineMouth.distance;
            const isMouthOpen = mouthOpen > this.mouthOpenThreshold;

            // 设置绘制样式
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)'; // 红色轮廓
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';

            if (!isMouthOpen) {
                // 嘴部闭合时：绘制贴合下嘴唇的轻微弧线
                const smileWidth = mouthWidth * 0.7; // 缩短长度到70%
                const smileHeight = 1; // 降低弧度高度到1像素
                const lowerLipY = lowerLip.y * height; // 贴合下嘴唇位置

                ctx.beginPath();
                // 绘制轻微弧线：贴合下嘴唇，只是稍微弯曲
                ctx.moveTo(centerX - smileWidth / 2, lowerLipY);
                ctx.quadraticCurveTo(centerX, lowerLipY + smileHeight, centerX + smileWidth / 2, lowerLipY);
                ctx.stroke();

                // 在嘴角添加小点，位置也调整到下嘴唇
                ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
                ctx.beginPath();
                ctx.arc(centerX - smileWidth / 2, lowerLipY, 1, 0, 2 * Math.PI);
                ctx.arc(centerX + smileWidth / 2, lowerLipY, 1, 0, 2 * Math.PI);
                ctx.fill();
            } else {
                // 嘴部张开时：绘制椭圆
                const mouthHeight = Math.abs(lowerLip.y - upperLip.y) * height;

                ctx.beginPath();
                ctx.ellipse(centerX, centerY, mouthWidth / 2, mouthHeight / 2, 0, 0, 2 * Math.PI);
                ctx.stroke();

                // 如果嘴张得很大，添加内部轮廓
                if (mouthOpen > this.mouthOpenThreshold * 2) {
                    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.ellipse(centerX, centerY, (mouthWidth / 2) * 0.7, (mouthHeight / 2) * 0.7, 0, 0, 2 * Math.PI);
                    ctx.stroke();
                }
            }
        } else if (leftCorner && rightCorner && upperLip && lowerLip) {
            // 如果还没有基线，绘制默认的轻微弧线
            const centerX = ((leftCorner.x + rightCorner.x) / 2) * width;
            const mouthWidth = Math.abs(rightCorner.x - leftCorner.x) * width;
            const smileWidth = mouthWidth * 0.7;
            const smileHeight = 1;
            const lowerLipY = lowerLip.y * height; // 贴合下嘴唇位置

            ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.lineWidth = 1;
            ctx.lineCap = 'round';
            ctx.beginPath();
            // 校准期间也显示贴合下嘴唇的轻微弧线
            ctx.moveTo(centerX - smileWidth / 2, lowerLipY);
            ctx.quadraticCurveTo(centerX, lowerLipY + smileHeight, centerX + smileWidth / 2, lowerLipY);
            ctx.stroke();
        }
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

        // 2. Head Lift Status (based on nose-mouth distance)
        if (this.isHeadLiftTriggered) {
            items.push({ text: '⚡ Fast Drop Active', color: '#ff6b6b' });
        } else if (this.isHeadLifted) {
            const elapsed = Date.now() - this.headLiftStartTime;
            const remaining = Math.max(0, this.headLiftTriggerDelay - elapsed);
            items.push({ text: `⬆️ Head Lifted (${(remaining / 1000).toFixed(1)}s)`, color: '#ffcc00' });
        }

        // Distance Ratio Debug Info
        if (this.initialEyeMouthDistance && this.currentEyeMouthDistance) {
            const ratio = this.currentEyeMouthDistance / this.initialEyeMouthDistance;
            const percentage = (ratio * 100).toFixed(1);
            const triggerThreshold = (this.headLiftThreshold * 100).toFixed(0);
            const cancelThreshold = (this.headLiftCancelThreshold * 100).toFixed(0);

            // Show more detailed status
            let statusText = `Eye-Mouth: ${percentage}% (T:${triggerThreshold}%/C:${cancelThreshold}%)`;
            if (ratio < this.headLiftThreshold) {
                statusText += ' [SHOULD TRIGGER]';
            }

            items.push({ text: statusText, color: '#888888' });
        } else if (this.eyeMouthDistanceHistory.length > 0) {
            items.push({ text: `Waiting for baseline... (${this.eyeMouthDistanceHistory.length}/5)`, color: '#ffcc00' });
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



    updateSensitivity(tiltThreshold, headLiftThreshold, mouthThreshold) {
        this.headTiltThreshold = tiltThreshold;
        // Convert old distance threshold to angle threshold (approximate conversion)
        this.headLiftAngleThreshold = headLiftThreshold * 300; // Scale factor to convert to degrees
        this.headLiftThreshold = headLiftThreshold; // Keep for backward compatibility
        this.mouthOpenThreshold = mouthThreshold;

        // 根据倾斜灵敏度调整移动速度
        // 灵敏度越高(数值越小)，移动越快
        const baseContinuousInterval = 150;
        const baseFastInterval = 40;

        // 灵敏度范围 0.05-0.30，反向映射到速度
        const sensitivityFactor = (0.30 - tiltThreshold) / (0.30 - 0.05); // 0-1范围

        // 灵敏度高时速度快，灵敏度低时速度慢
        this.continuousMoveInterval = Math.max(50, baseContinuousInterval - (sensitivityFactor * 100));
        this.fastMoveInterval = Math.max(30, baseFastInterval - (sensitivityFactor * 60));

        console.log(`灵敏度更新: 左右倾斜=${tiltThreshold}, 抬头角度=${this.headLiftAngleThreshold.toFixed(1)}°, 张嘴=${mouthThreshold}, 垂直度阈值=${this.headVerticalThreshold}°`);
        console.log(`移动速度: 连续=${this.continuousMoveInterval}ms, 快速=${this.fastMoveInterval}ms`);
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