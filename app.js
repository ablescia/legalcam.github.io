const video = document.getElementById('video');
const cameraSelect = document.getElementById('cameraSelect');
const qualitySelect = document.getElementById('qualitySelect');
const captureBtn = document.getElementById('captureBtn');
const canvas = document.getElementById('canvas');
const downloadLink = document.getElementById('downloadLink');
const jsonLink = document.getElementById('jsonLink');
const metaOutput = document.getElementById('metaOutput');
const downloadSection = document.getElementById('download-section');

let currentStream = null;
let gpsPosition = { lat: 'N/A', lon: 'N/A' };

const OTS = window.OpenTimestamps;

async function getCameraDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(device => device.kind === 'videoinput');
}

async function startStream(deviceId) {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
  }

  const constraints = {
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 9999 },
      height: { ideal: 9999 }
    },
    audio: false
  };

  try {
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = currentStream;
  } catch (err) {
    alert('Unable to access the camera: ' + err.message);
  }
}

async function init() {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (err) {
    alert('Camera permission is required.');
    return;
  }

  const cameras = await getCameraDevices();
  cameraSelect.innerHTML = '';
  cameras.forEach((cam, index) => {
    const opt = document.createElement('option');
    opt.value = cam.deviceId;
    opt.text = cam.label || `Camera ${index + 1}`;
    cameraSelect.appendChild(opt);
  });

  if (cameras.length > 0) {
    startStream(cameras[0].deviceId);
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      gpsPosition.lat = pos.coords.latitude.toFixed(6);
      gpsPosition.lon = pos.coords.longitude.toFixed(6);
    },
    (err) => {
      console.warn('GPS not available:', err.message);
    }
  );
}

async function computeHash(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hashBuffer);
}

function generateMetadata(hashHex) {
  return {
    timestamp_utc: new Date().toISOString(),
    gps: gpsPosition,
    hash_sha256: hashHex,
    user_agent: navigator.userAgent,
    platform: navigator.platform,
    timezone_offset_min: new Date().getTimezoneOffset(),
    image_resolution: {
      width: canvas.width,
      height: canvas.height
    }
  };
}

function showConfirmationMessage(text) {
  const messageDiv = document.createElement('div');
  messageDiv.textContent = text;
  messageDiv.style.position = 'fixed';
  messageDiv.style.top = '20px';
  messageDiv.style.left = '50%';
  messageDiv.style.transform = 'translateX(-50%)';
  messageDiv.style.backgroundColor = '#2e7d32';
  messageDiv.style.color = 'white';
  messageDiv.style.padding = '10px 20px';
  messageDiv.style.borderRadius = '8px';
  messageDiv.style.zIndex = '1000';
  messageDiv.style.fontSize = '1rem';
  messageDiv.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
  document.body.appendChild(messageDiv);

  setTimeout(() => {
    messageDiv.remove();
  }, 3000);
}

cameraSelect.addEventListener('change', () => {
  startStream(cameraSelect.value);
});

captureBtn.addEventListener('click', () => {
  const quality = parseFloat(qualitySelect.value);
  const width = video.videoWidth * quality;
  const height = video.videoHeight * quality;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);

  // Watermark styling
  const fontSize = Math.round(height * 0.035);
  const marginX = width * 0.02;
  const lineHeight = fontSize * 1.4;
  const timestamp = new Date().toISOString();
  const lines = [
    `Timestamp (UTC): ${timestamp}`,
    `Latitude: ${gpsPosition.lat}`,
    `Longitude: ${gpsPosition.lon}`
  ];

  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'black';
  ctx.shadowBlur = 2;

  const padding = fontSize * 0.4;
  const boxWidth = Math.max(...lines.map(line => ctx.measureText(line).width)) + padding * 2;
  const boxHeight = lines.length * lineHeight + padding * 2;
  const boxX = marginX;
  const boxY = height - boxHeight - marginX;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

  ctx.fillStyle = 'white';
  lines.forEach((line, i) => {
    ctx.fillText(line, boxX + padding, boxY + padding + i * lineHeight);
  });

  canvas.toBlob(async (blob) => {
    // Clean previous
    downloadSection.innerHTML = '';

    // Compute hash
    const hashBytes = await computeHash(blob);
    const hashHex = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    // Generate OTS
    const op = new OTS.Ops.OpSHA256();
    const detached = OTS.DetachedTimestampFile.fromHash(op, hashBytes);
    await OTS.stamp(detached);
    const otsBytes = detached.serializeToBytes();
    const otsBlob = new Blob([otsBytes], { type: 'application/octet-stream' });

    // Generate Metadata
    const metadata = generateMetadata(hashHex);
    const jsonBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });

    // Create ZIP button
    const zipBtn = document.createElement('a');
    zipBtn.href = '#';
    zipBtn.textContent = '⬇️ Download All as ZIP';
    zipBtn.className = 'download-button';

    zipBtn.onclick = async () => {
      const zip = new JSZip();
      zip.file('evidence.png', blob);
      zip.file('metadata.json', jsonBlob);
      zip.file('evidence.ots', otsBlob);

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipUrl = URL.createObjectURL(zipBlob);

      const timestampUTC = metadata.timestamp_utc;
      const safeTimestamp = timestampUTC.replace(/:/g, '-');

      const link = document.createElement('a');
      link.href = zipUrl;
      link.download = `${safeTimestamp}.zip`;
      link.click();
    };

    downloadSection.appendChild(zipBtn);

    // Show metadata
    metaOutput.textContent = JSON.stringify(metadata, null, 2);

    // Notify user
    showConfirmationMessage("✅ Photo captured and packaged.");
    document.getElementById('metadata-section').scrollIntoView({ behavior: 'smooth' });
  });

});

// Initialize
init();
