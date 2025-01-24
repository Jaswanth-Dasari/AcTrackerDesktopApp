let currentProjectId = null;

function formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString();
}

function createVideoElement(recording) {
    const videoItem = document.createElement('div');
    videoItem.className = 'video-item';
    
    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-wrapper';
    
    const video = document.createElement('video');
    video.className = 'video-player';
    video.controls = false;
    video.preload = 'none';
    
    const playOverlay = document.createElement('div');
    playOverlay.className = 'play-overlay';
    
    const playButton = document.createElement('button');
    playButton.className = 'play-button';
    playButton.innerHTML = '<i class="fas fa-play"></i>';
    playOverlay.appendChild(playButton);
    
    const info = document.createElement('div');
    info.className = 'info';
    
    // Format the timestamp nicely
    const timestamp = new Date(recording.timestamp);
    const formattedDate = timestamp.toLocaleDateString();
    const formattedTime = timestamp.toLocaleTimeString();
    info.textContent = `${formattedDate} ${formattedTime}`;
    
    let isLoading = false;
    
    function handleVideoError(error) {
        console.error('Video error:', error);
        playButton.innerHTML = '<i class="fas fa-exclamation-circle"></i>';
        info.textContent = 'Error loading video. Click to retry.';
        info.style.color = '#ff4444'; // Red color for error
        isLoading = false;
    }
    
    function updateInfoDisplay(isError = false) {
        if (!isError) {
            // Show timestamp for successfully loaded video
            const timestamp = new Date(recording.timestamp);
            const formattedDate = timestamp.toLocaleDateString();
            const formattedTime = timestamp.toLocaleTimeString();
            info.textContent = `${formattedDate} ${formattedTime}`;
            info.style.color = 'white'; // Reset color
        }
    }
    
    async function loadVideo() {
        try {
            if (isLoading) return;
            isLoading = true;
            
            playButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            
            // Set video source and load
            video.src = recording.url;
            
            const loadPromise = new Promise((resolve, reject) => {
                video.onloadeddata = () => {
                    console.log('Video loaded successfully:', recording.url);
                    updateInfoDisplay(false); // Update info with timestamp
                    resolve();
                };
                
                video.onerror = (e) => {
                    console.error('Video load error:', e);
                    reject(new Error('Failed to load video'));
                };
            });

            await loadPromise;
            
            playButton.innerHTML = '<i class="fas fa-play"></i>';
            isLoading = false;
            return true;
        } catch (error) {
            handleVideoError(error);
            return false;
        }
    }
    
    let isPlaying = false;
    
    async function togglePlay(e) {
        e.stopPropagation();
        
        if (!video.src) {
            const loaded = await loadVideo();
            if (!loaded) return;
        }
        
        if (isPlaying) {
            video.pause();
            playButton.innerHTML = '<i class="fas fa-play"></i>';
            playOverlay.style.opacity = '1';
        } else {
            // Pause all other videos
            document.querySelectorAll('.video-player').forEach(v => {
                if (v !== video && !v.paused) {
                    v.pause();
                    const otherOverlay = v.parentElement.querySelector('.play-overlay');
                    if (otherOverlay) {
                        otherOverlay.style.opacity = '1';
                        const otherButton = otherOverlay.querySelector('.play-button');
                        if (otherButton) {
                            otherButton.innerHTML = '<i class="fas fa-play"></i>';
                        }
                    }
                }
            });
            
            try {
                await video.play();
                playButton.innerHTML = '<i class="fas fa-pause"></i>';
                playOverlay.style.opacity = '0';
            } catch (error) {
                handleVideoError(error);
                return;
            }
        }
        isPlaying = !isPlaying;
    }
    
    // Event listeners
    playButton.addEventListener('click', togglePlay);
    playOverlay.addEventListener('click', togglePlay);
    
    video.addEventListener('ended', () => {
        isPlaying = false;
        playButton.innerHTML = '<i class="fas fa-play"></i>';
        playOverlay.style.opacity = '1';
        updateInfoDisplay(false); // Show timestamp when video ends
    });
    
    video.addEventListener('error', (e) => {
        handleVideoError(e.target.error);
    });
    
    // Initial load attempt
    loadVideo().then(() => {
        console.log('Video ready to play:', recording.url);
    });
    
    videoWrapper.appendChild(video);
    videoWrapper.appendChild(playOverlay);
    videoWrapper.appendChild(info);
    videoItem.appendChild(videoWrapper);
    
    return videoItem;
}

function updateRecordingsGrid(newRecordings) {
    if (!newRecordings || newRecordings.length === 0) return;

    const grid = document.getElementById('recordings-grid');
    const emptyMessage = document.querySelector('.video-empty-message');
    
    // Hide empty message if we have recordings
    emptyMessage.style.display = 'none';
    grid.style.display = 'grid';

    // Create a Map to store recordings by URL with their timestamps
    const recordingsMap = new Map();

    // Add existing recordings to the map
    Array.from(grid.querySelectorAll('.video-item')).forEach(item => {
        const url = item.dataset.videoUrl;
        const timestamp = item.dataset.timestamp;
        if (url && timestamp) {
            recordingsMap.set(url, {
                timestamp: new Date(timestamp),
                element: item
            });
        }
    });

    // Process new recordings
    newRecordings.forEach(recording => {
        if (!recording?.url) return;

        const newTimestamp = new Date(recording.timestamp);
        const existing = recordingsMap.get(recording.url);

        if (!existing || newTimestamp > existing.timestamp) {
            // Remove existing element if it's older
            if (existing) {
                existing.element.remove();
            }

            const videoElement = createVideoElement(recording);
            videoElement.dataset.videoUrl = recording.url;
            videoElement.dataset.timestamp = recording.timestamp;
            recordingsMap.set(recording.url, {
                timestamp: newTimestamp,
                element: videoElement
            });
        }
    });

    // Clear the grid
    grid.innerHTML = '';

    // Sort and add recordings to grid
    const sortedRecordings = Array.from(recordingsMap.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 7); // Keep only latest 7 recordings

    sortedRecordings.forEach(({element}) => {
        grid.appendChild(element);
    });
}

// Add this function to fetch initial recordings
async function fetchInitialRecordings() {
    try {
        console.log('Fetching initial recordings...');
        const userId = window.auth.getUserId();
        const recordings = await window.electronAPI.getRecordings(userId, 7);
        
        if (recordings && recordings.length > 0) {
            // Log the recordings received
            console.log('Received recordings:', recordings);

            // The recordings are already sorted by timestamp in descending order
            updateRecordingsGrid(recordings);
        } else {
            console.log('No initial recordings found');
            const emptyMessage = document.querySelector('.video-empty-message');
            if (emptyMessage) emptyMessage.style.display = 'block';
        }
    } catch (error) {
        console.error('Error fetching initial recordings:', error);
        const emptyMessage = document.querySelector('.video-empty-message');
        if (emptyMessage) emptyMessage.style.display = 'block';
    }
}

// Add a function to handle new recordings
function setupRecordingUpdates() {
    window.electronAPI.onRecordingsUpdated((newRecordings) => {
        if (newRecordings && newRecordings.length > 0) {
            console.log('New recordings received:', newRecordings);
            // Sort new recordings by timestamp before updating
            const sortedNewRecordings = newRecordings.sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
            );
            updateRecordingsGrid(sortedNewRecordings);
        }
    });
}

// Update the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', () => {
    fetchInitialRecordings();
    setupRecordingUpdates();
});

// Update initializeRecordings function
async function initializeRecordings(projectId) {
    const userId = window.auth.getUserId();
    const recordingsGrid = document.getElementById('recordings-grid');
    
    // Function to create video element
    function createVideoElement(recording) {
        const videoItem = document.createElement('div');
        videoItem.className = 'video-item';
        
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'video-wrapper';
        
        const video = document.createElement('video');
        video.className = 'video-player';
        video.src = recording.url;
        video.preload = 'metadata';
        
        // Add play button
        const playButton = document.createElement('button');
        playButton.className = 'play-button';
        playButton.innerHTML = '<i class="fas fa-play"></i>';
        
        // Add video controls
        const controls = document.createElement('div');
        controls.className = 'video-controls';
        
        // Add info overlay
        const info = document.createElement('div');
        info.className = 'info';
        info.textContent = new Date(recording.timestamp).toLocaleString();
        
        // Handle play/pause
        let isPlaying = false;
        
        function togglePlay() {
            if (isPlaying) {
                video.pause();
                playButton.innerHTML = '<i class="fas fa-play"></i>';
            } else {
                // Pause all other videos first
                document.querySelectorAll('.video-player').forEach(v => {
                    if (v !== video) {
                        v.pause();
                        v.parentElement.querySelector('.play-button').innerHTML = '<i class="fas fa-play"></i>';
                    }
                });
                
                video.play();
                playButton.innerHTML = '<i class="fas fa-pause"></i>';
            }
            isPlaying = !isPlaying;
        }
        
        // Add event listeners
        playButton.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlay();
        });
        
        video.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlay();
        });
        
        video.addEventListener('ended', () => {
            isPlaying = false;
            playButton.innerHTML = '<i class="fas fa-play"></i>';
        });
        
        // Assemble the video item
        videoWrapper.appendChild(video);
        videoWrapper.appendChild(playButton);
        videoWrapper.appendChild(controls);
        videoWrapper.appendChild(info);
        videoItem.appendChild(videoWrapper);
        
        return videoItem;
    }
    
    // Listen for new recordings
    window.electronAPI.onRecordingsUpdated((recordings) => {
        recordingsGrid.innerHTML = '';
        if (recordings && recordings.length > 0) {
            recordings.forEach(recording => {
                recordingsGrid.appendChild(createVideoElement(recording));
            });
            recordingsGrid.parentElement.querySelector('.video-empty-message').style.display = 'none';
        } else {
            recordingsGrid.parentElement.querySelector('.video-empty-message').style.display = 'block';
        }
    });
    
    // Initial fetch of recordings
    window.electronAPI.getRecordings(userId, projectId, 5)
        .then(recordings => {
            if (recordings && recordings.length > 0) {
                recordings.forEach(recording => {
                    recordingsGrid.appendChild(createVideoElement(recording));
                });
                recordingsGrid.parentElement.querySelector('.video-empty-message').style.display = 'none';
            } else {
                recordingsGrid.parentElement.querySelector('.video-empty-message').style.display = 'block';
            }
        })
        .catch(error => console.error('Error fetching recordings:', error));
}

function cleanupRecordings() {
    const grid = document.getElementById('recordings-grid');
    const videos = grid.querySelectorAll('video');
    videos.forEach(video => {
        video.pause();
        video.src = '';
        video.load();
    });
} 