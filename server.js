const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const CameraCapture = require('./camera/cameraCapture');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // Configuraciones para evitar problemas con imágenes grandes
    maxHttpBufferSize: 1e8, // 100MB
    pingTimeout: 60000,
    pingInterval: 25000
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Configuración
const API_URL = 'http://192.168.20.103:8000/llava';
const PORT = 3000;
const MAX_IMAGE_SIZE = 800000; // 800KB límite para base64

// Estado global del servidor (SIN referencias circulares)
let serverState = {
    isCapturing: false,
    intervalSeconds: 5,
    prompt: "What is in this picture?",
    connectedClients: 0
};

let responses = [];
let camera = null;
let captureInterval = null;

// Inicializar captura de cámara con manejo de errores
async function initializeCamera() {
    try {
        camera = new CameraCapture();
        console.log('Cámara USB inicializada correctamente');
        return true;
    } catch (error) {
        console.error('Error inicializando cámara:', error.message);
        camera = null;
        return false;
    }
}

// Socket.io eventos
io.on('connection', (socket) => {
    serverState.connectedClients = io.sockets.sockets.size;
    console.log(`Cliente conectado. Total: ${serverState.connectedClients}`);
    
    // Enviar estado actual al cliente (objeto limpio sin referencias circulares)
    const cleanState = {
        isCapturing: serverState.isCapturing,
        intervalSeconds: serverState.intervalSeconds,
        prompt: serverState.prompt,
        connectedClients: serverState.connectedClients
    };
    
    socket.emit('stateUpdate', cleanState);
    socket.emit('responsesHistory', responses);
    
    // Manejar comandos del cliente
    socket.on('startCapture', async (data) => {
        if (!camera) {
            socket.emit('error', 'Cámara no disponible. Verifique conexión USB.');
            return;
        }
        
        serverState.intervalSeconds = data.seconds || 5;
        serverState.prompt = data.prompt || "What is in this picture?";
        await startServerCapture();
        
        const cleanState = {
            isCapturing: serverState.isCapturing,
            intervalSeconds: serverState.intervalSeconds,
            prompt: serverState.prompt,
            connectedClients: serverState.connectedClients
        };
        io.emit('stateUpdate', cleanState);
    });
    
    socket.on('stopCapture', () => {
        stopServerCapture();
        const cleanState = {
            isCapturing: serverState.isCapturing,
            intervalSeconds: serverState.intervalSeconds,
            prompt: serverState.prompt,
            connectedClients: serverState.connectedClients
        };
        io.emit('stateUpdate', cleanState);
    });
    
    socket.on('updatePrompt', (prompt) => {
        serverState.prompt = prompt;
        const cleanState = {
            isCapturing: serverState.isCapturing,
            intervalSeconds: serverState.intervalSeconds,
            prompt: serverState.prompt,
            connectedClients: serverState.connectedClients
        };
        io.emit('stateUpdate', cleanState);
    });
    
    socket.on('clearHistory', () => {
        responses = [];
        io.emit('responsesHistory', responses);
        const cleanState = {
            isCapturing: serverState.isCapturing,
            intervalSeconds: serverState.intervalSeconds,
            prompt: serverState.prompt,
            connectedClients: serverState.connectedClients
        };
        io.emit('stateUpdate', cleanState);
    });
    
    socket.on('disconnect', () => {
        serverState.connectedClients = io.sockets.sockets.size;
        console.log(`Cliente desconectado. Total: ${serverState.connectedClients}`);
    });
});

// Funciones de control de captura
async function startServerCapture() {
    if (serverState.isCapturing) return;
    if (!camera) {
        console.error('No se puede iniciar captura: cámara no disponible');
        return;
    }
    
    serverState.isCapturing = true;
    console.log(`Iniciando captura automática cada ${serverState.intervalSeconds} segundos`);
    
    // Capturar inmediatamente
    await captureAndProcess();
    
    // Configurar intervalo
    captureInterval = setInterval(async () => {
        await captureAndProcess();
    }, serverState.intervalSeconds * 1000);
}

function stopServerCapture() {
    if (!serverState.isCapturing) return;
    
    serverState.isCapturing = false;
    if (captureInterval) {
        clearInterval(captureInterval);
        captureInterval = null;
    }
    console.log('Captura automática detenida');
}

async function captureAndProcess() {
    try {
        console.log('Capturando imagen de cámara USB...');
        
        // Capturar imagen de la cámara USB - ahora retorna objeto con datos
        const captureResult = await camera.captureImage672x672();
        const { base64: imageBase64, fileName, filePath } = captureResult;
        
        // VERIFICAR TAMAÑO de la imagen antes de enviar
        if (!imageBase64 || imageBase64.length > MAX_IMAGE_SIZE) {
            console.warn(`Imagen muy grande (${imageBase64?.length || 0} bytes), saltando envío`);
            safeEmit('error', 'Imagen muy grande para transmitir');
            return;
        }
        
        // Enviar imagen en vivo a todos los clientes (de forma segura)
        safeEmit('liveImage', imageBase64);
        
        // Procesar con LLaVA API usando el nombre real del archivo
        const response = await sendToLLaVAAPI(imageBase64, serverState.prompt, fileName);
        
        // Crear objeto de respuesta limpio
        const responseEntry = {
            id: responses.length + 1,
            timestamp: new Date().toLocaleString(),
            fileName: fileName, // Agregar nombre de archivo a la respuesta
            filePath: filePath, // Agregar ruta completa
            prompt: serverState.prompt.substring(0, 50) + 
                   (serverState.prompt.length > 50 ? '...' : ''),
            response: response,
            fullResponse: response
        };
        
        responses.push(responseEntry);
        
        // Notificar a todos los clientes de forma segura
        safeEmit('newResponse', responseEntry);
        safeEmit('responsesHistory', responses);
        
        console.log(`Imagen procesada y enviada a clientes. Archivo: ${fileName}`);
        
    } catch (error) {
        console.error('Error en captura y procesamiento:', error.message);
        safeEmit('error', `Error: ${error.message}`);
    }
}

// Función segura para emit que evita call stack exceeded
function safeEmit(event, data) {
    try {
        // Crear una copia limpia del objeto para evitar referencias circulares
        const cleanData = JSON.parse(JSON.stringify(data));
        io.emit(event, cleanData);
    } catch (error) {
        console.error(`Error enviando evento ${event}:`, error.message);
        // Como fallback, enviar un mensaje de error simple
        try {
            io.emit('error', `Error interno del servidor`);
        } catch (fallbackError) {
            console.error('Error crítico en comunicación:', fallbackError.message);
        }
    }
}

async function sendToLLaVAAPI(imageBase64, prompt, fileName) {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                file: fileName, // USAR EL NOMBRE REAL DEL ARCHIVO
                model: "llava:7b",
                prompt: prompt,
                images: [imageBase64]
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            return result.response || 'No response received';
        } else {
            const errorText = await response.text();
            return `Error ${response.status}: ${errorText}`;
        }
        
    } catch (error) {
        return `Error de conexión: ${error.message}`;
    }
}

// Iniciar servidor
async function startServer() {
    const cameraReady = await initializeCamera();
    
    server.listen(PORT, () => {
        console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
        console.log(`Cámara disponible: ${cameraReady ? 'Sí' : 'No'}`);
        console.log(`Clientes conectados: ${serverState.connectedClients}`);
    });
}

// Manejar cierre graceful
process.on('SIGINT', () => {
    console.log('\nCerrando servidor...');
    stopServerCapture();
    if (camera) {
        camera.cleanup();
    }
    process.exit(0);
});

// Iniciar
startServer();
