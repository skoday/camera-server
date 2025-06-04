const socket = io();

// Elementos del DOM
const clientCountSpan = document.getElementById('clientCount');
const connectionStatusSpan = document.getElementById('connectionStatus');
const serverCameraImg = document.getElementById('serverCamera');
const cameraPlaceholder = document.getElementById('cameraPlaceholder');
const statusDiv = document.getElementById('status');
const promptTextarea = document.getElementById('prompt');
const responseTextarea = document.getElementById('response');
const responsesTableBody = document.getElementById('responsesTable').getElementsByTagName('tbody')[0];
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const secondsInput = document.getElementById('seconds');

// Estado local
let isCapturing = false;
let responses = [];

// Función para actualizar la tabla de respuestas
function updateResponsesTable() {
    responsesTableBody.innerHTML = '';
    responses.forEach(resp => {
        const row = responsesTableBody.insertRow();
        row.insertCell(0).textContent = resp.id;
        row.insertCell(1).textContent = resp.timestamp;
        row.insertCell(2).textContent = resp.prompt;
        const respCell = row.insertCell(3);
        const truncated = resp.response.length > 100 ? resp.response.substring(0, 100) + '...' : resp.response;
        respCell.textContent = truncated;
        respCell.title = resp.fullResponse;
    });
}

// Función para actualizar el estado de conexión
function updateConnectionStatus(connected) {
    if (connected) {
        connectionStatusSpan.textContent = 'Conectado';
        connectionStatusSpan.className = 'status-connected';
    } else {
        connectionStatusSpan.textContent = 'Desconectado';
        connectionStatusSpan.className = 'status-disconnected';
    }
}

// Función para actualizar el estado de captura
function updateCaptureStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
}

// Eventos de Socket.io
socket.on('connect', () => {
    updateConnectionStatus(true);
});

socket.on('disconnect', () => {
    updateConnectionStatus(false);
    updateCaptureStatus('⏸️ Captura automática pausada', 'paused');
    isCapturing = false;
});

socket.on('stateUpdate', (state) => {
    isCapturing = state.isCapturing;
    secondsInput.value = state.intervalSeconds;
    promptTextarea.value = state.prompt;
    clientCountSpan.textContent = `Clientes conectados: ${state.connectedClients}`;
    
    if (isCapturing) {
        updateCaptureStatus('✅ Captura automática activa', 'running');
        startBtn.disabled = true;
        stopBtn.disabled = false;
        secondsInput.disabled = true;
    } else {
        updateCaptureStatus('⏸️ Captura automática pausada', 'paused');
        startBtn.disabled = false;
        stopBtn.disabled = true;
        secondsInput.disabled = false;
    }
});

socket.on('liveImage', (base64Image) => {
    if (base64Image) {
        serverCameraImg.src = `data:image/jpeg;base64,${base64Image}`;
        serverCameraImg.style.display = 'block';
        cameraPlaceholder.style.display = 'none';
    } else {
        serverCameraImg.style.display = 'none';
        cameraPlaceholder.style.display = 'flex';
    }
});

socket.on('newResponse', (responseEntry) => {
    responses.push(responseEntry);
    updateResponsesTable();
    responseTextarea.value = responseEntry.response;
});

socket.on('responsesHistory', (history) => {
    responses = history;
    updateResponsesTable();
    if (responses.length > 0) {
        responseTextarea.value = responses[responses.length - 1].response;
    } else {
        responseTextarea.value = 'Esperando primera respuesta...';
    }
});

socket.on('error', (errorMessage) => {
    updateCaptureStatus(`❌ ${errorMessage}`, 'warning');
});

// Eventos de botones
startBtn.addEventListener('click', () => {
    const seconds = parseInt(secondsInput.value) || 5;
    const prompt = promptTextarea.value.trim() || 'What is in this picture?';
    socket.emit('startCapture', { seconds, prompt });
});

stopBtn.addEventListener('click', () => {
    socket.emit('stopCapture');
});

clearBtn.addEventListener('click', () => {
    socket.emit('clearHistory');
    responseTextarea.value = 'Esperando primera respuesta...';
});

// Actualizar prompt en el servidor cuando cambia
promptTextarea.addEventListener('blur', () => {
    const prompt = promptTextarea.value.trim();
    if (prompt) {
        socket.emit('updatePrompt', prompt);
    }
});

// Inicializar estado de botones
stopBtn.disabled = true;
